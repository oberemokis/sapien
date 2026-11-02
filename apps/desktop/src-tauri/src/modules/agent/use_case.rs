use super::domain::{
    APPEND, AWAY, Answer, Chat, ClaudeSession, Entry, Event, Oversight, Question, SILENCE, STOPPED,
    Session, SessionInfo, Tool, approval, choice_result, claude_blocks, claude_failure,
    claude_init_problem, claude_result, notice, parse_model, prompt, push_assistant, push_user,
    short_name, title, tool_target, transcript,
};
use super::ports::{Claude, Conversation, Human, Incoming, Projects, Run, Sessions};
use crate::error::AppError;
use serde_json::{Value, json};
use std::cmp::Reverse;
use tokio::sync::Notify;
use tokio::time::timeout;

/// Сессии всех проектов, свежие первыми.
pub fn sessions(store: &impl Sessions) -> Result<Vec<SessionInfo>, AppError> {
    let mut sessions = store.list()?;

    sessions.sort_by_key(|session| Reverse(session.updated));
    Ok(sessions)
}

/// Новая пустая сессия `id` в проекте `project`, заведённая в `now`.
pub fn new_session(
    store: &impl Sessions,
    projects: &impl Projects,
    project: &str,
    id: String,
    now: u64,
) -> Result<SessionInfo, AppError> {
    if projects.folder(project).is_none() {
        return Err(AppError::not_found("project_missing"));
    }

    let session = Session {
        id,
        project: project.to_owned(),
        title: String::new(),
        created: now,
        updated: now,
        chat: Chat::default(),
    };

    store.save(&session)?;
    Ok(session.info())
}

/// Удаляет сессию `id`. По ней идёт ответ (`running`), и она остаётся:
/// ответ записал бы её заново.
pub fn delete_session(
    store: &impl Sessions,
    running: impl Fn(&str) -> bool,
    id: &str,
) -> Result<(), AppError> {
    if running(id) {
        return Err(AppError::conflict("agent_busy"));
    }

    store.delete(id)
}

/// Удаляет сессии проекта, который убирают из списка. Идёт ответ
/// хоть по одной из них, и не удаляется ни одна.
pub fn forget_project(
    store: &impl Sessions,
    running: impl Fn(&str) -> bool,
    project: &str,
) -> Result<(), AppError> {
    let doomed: Vec<SessionInfo> = store
        .list()?
        .into_iter()
        .filter(|session| session.project == project)
        .collect();

    if doomed.iter().any(|session| running(&session.id)) {
        return Err(AppError::conflict("agent_busy"));
    }

    doomed
        .iter()
        .try_for_each(|session| store.delete(&session.id))
}

pub fn history(store: &impl Sessions, id: &str) -> Result<Vec<Entry>, AppError> {
    Ok(transcript(&store.load(id)?.chat.messages))
}

/// Сообщение человека в сессии `session`. Пустой текст продолжает историю,
/// которая кончается его вопросом: так «Повторить» шлёт его снова после
/// ошибки. `now` это время сообщения в миллисекундах Unix.
pub struct Turn<'a> {
    pub session: &'a str,
    pub model: &'a str,
    pub text: &'a str,
    pub oversight: Oversight,
    pub now: u64,
}

/// Кому агент задаёт вопросы посреди ответа и спрашивать ли разрешения
/// на вызовы.
struct Asking<'a, H> {
    human: &'a H,
    oversight: Oversight,
}

impl<H: Human> Asking<'_, H> {
    /// Показывает вопрос окну и ждёт ответа. Окно узнаёт и о том, что вопрос
    /// закрыт, вместе с ответом на вопрос агента.
    async fn ask(
        &self,
        question: Question,
        events: &mut (impl FnMut(Event) + Send),
    ) -> Option<Answer> {
        let id = question.id().to_owned();

        events(Event::Asked {
            question: question.clone(),
        });

        let answer = self.human.ask(&question).await;
        let shown = match question {
            Question::Choice { .. } => choice_result(answer.clone()).ok(),
            Question::Permission { .. } => None,
        };

        events(Event::Answered { id, answer: shown });
        answer
    }
}

/// Выполняет вызов инструмента sapien. Ошибка уходит Claude текстом,
/// чтобы он поправил вызов или решил сам.
async fn run(
    call: &Value,
    asking: &Asking<'_, impl Human>,
    events: &mut (impl FnMut(Event) + Send),
) -> Result<String, String> {
    let Some(tool) = Tool::parse(call) else {
        return Err("Неверные параметры вызова: сверь их со схемой инструмента.".to_owned());
    };
    let id = call["id"].as_str().unwrap_or_default().to_owned();

    match tool {
        Tool::AskUser { question, options } => {
            if asking.oversight == Oversight::Away {
                return Err(AWAY.to_owned());
            }

            let question = Question::Choice {
                id,
                question,
                options,
            };

            choice_result(asking.ask(question, events).await)
        }
        // Отказ это ответ Claude Code, а не ошибка вызова: разрешение он
        // читает из текста. Без проверки разрешений `approve` не зовут,
        // а позвали, человек и так всё разрешил.
        Tool::Approve {
            tool_name,
            input,
            tool_use_id,
        } => {
            if asking.oversight != Oversight::Ask {
                return Ok(approval(Some(Answer::Allow), &input));
            }

            let question = Question::Permission {
                id: tool_use_id.unwrap_or(id),
                tool: short_name(&tool_name).to_owned(),
                target: tool_target(&input),
            };

            Ok(approval(asking.ask(question, events).await, &input))
        }
    }
}

/// Чем кончился один запуск Claude Code. У отказа по лимиту подписки
/// время сброса, в секундах Unix.
enum Outcome {
    Done,
    Stopped,
    Failed(AppError, Option<u64>),
}

/// Ответ агента в сессии: сообщение уходит в сессию Claude Code, который
/// работает в папке проекта своими инструментами. Вопросы и разрешения
/// он шлёт через сервер MCP sapien. История здесь это копия показанного,
/// а сам разговор держит Claude Code. Первое сообщение даёт сессии
/// заголовок.
///
/// Сессию, которую меняли снаружи, Claude Code продолжает в копии.
/// Пропавшую сессию sapien начинает заново с отметкой в истории. Отказ
/// остаётся в истории отметкой с кодом, у лимита со временем сброса.
pub async fn send(
    claude: &impl Claude,
    projects: &impl Projects,
    store: &impl Sessions,
    human: &impl Human,
    stop: &Notify,
    turn: Turn<'_>,
    events: &mut (impl FnMut(Event) + Send),
) -> Result<(), AppError> {
    let model = parse_model(turn.model).ok_or(AppError::invalid("agent_model_unknown"))?;
    let mut session = store.load(turn.session)?;
    let dir = projects
        .folder(&session.project)
        .ok_or(AppError::not_found("project_missing"))?;

    session.updated = turn.now;

    if !turn.text.trim().is_empty() {
        push_user(
            &mut session.chat.messages,
            vec![json!({ "type": "text", "text": turn.text })],
        );

        if session.title.is_empty() {
            session.title = title(turn.text);
        }

        store.save(&session)?;
    }

    if session
        .chat
        .messages
        .last()
        .is_none_or(|last| last["role"] != "user")
    {
        return Ok(());
    }

    let asking = Asking {
        human,
        oversight: turn.oversight,
    };
    let prompt = prompt(&session.chat.messages);
    let mut resume = session.chat.session.clone();

    loop {
        let fork = resume
            .as_ref()
            .is_some_and(|resumed| claude.stamp(&dir, &resumed.id) != resumed.seen);
        let run = Run {
            dir: &dir,
            model,
            append: APPEND,
            prompt: &prompt,
            oversight: turn.oversight,
            resume: resume.as_ref().map(|resumed| resumed.id.as_str()),
            fork,
        };
        let outcome = match claude.converse(&run).await {
            Ok(mut talk) => listen(&mut talk, &mut session, store, &asking, stop, events).await,
            Err(error) => Outcome::Failed(error, None),
        };

        // Claude Code не нашёл сессию, например, она устарела: разговор
        // начинается заново, а история говорит об этом.
        if let Outcome::Failed(error, _) = &outcome
            && error.code == "claude_session_missing"
            && resume.is_some()
        {
            notice(&mut session.chat.messages, "claude_session_new", None);
            session.chat.session = None;
            resume = None;
            continue;
        }

        if let Some(resumed) = &mut session.chat.session {
            resumed.seen = claude.stamp(&dir, &resumed.id);
        }

        if let Outcome::Failed(error, resets) = &outcome {
            notice(&mut session.chat.messages, error.code, *resets);
        }

        store.save(&session)?;

        return match outcome {
            Outcome::Failed(error, _) => Err(error),
            Outcome::Done | Outcome::Stopped => Ok(()),
        };
    }
}

/// Пишет историю посреди ответа. Не вышло, и ответ прерывается: окно потом
/// не увидело бы, что агент сделал в проекте.
fn keep(
    store: &impl Sessions,
    session: &Session,
    failure: &mut Option<AppError>,
    talk: &mut impl Conversation,
) {
    if let Err(error) = store.save(session) {
        failure.get_or_insert(error);
        talk.interrupt();
    }
}

/// Идёт за одним запуском Claude Code до конца: текст и вызовы инструментов
/// в окно, сообщения в историю, вопросы и разрешения через `run`. «Стоп»
/// и сторож прерывают процесс, а вызовы sapien после этого отклоняются:
/// ходом владеет sapien.
async fn listen(
    talk: &mut impl Conversation,
    session: &mut Session,
    store: &impl Sessions,
    asking: &Asking<'_, impl Human>,
    stop: &Notify,
    events: &mut (impl FnMut(Event) + Send),
) -> Outcome {
    let mut stopped = false;
    let mut failure: Option<AppError> = None;
    let mut result = None;
    let mut resets = None;
    // Текст, который окно уже видит, а Claude Code ещё не прислал целым
    // блоком. Оборвался ответ, и в историю идёт он.
    let mut shown = String::new();

    loop {
        let next = tokio::select! {
            next = timeout(SILENCE, talk.next()) => next,
            () = stop.notified(), if !stopped => {
                stopped = true;
                talk.interrupt();
                continue;
            }
        };

        // Сторож: событий долго нет, а вопроса не открыто, иначе ждал бы
        // вызов, а не поток.
        let Ok(next) = next else {
            failure.get_or_insert(AppError::unavailable("claude_failed"));
            talk.interrupt();
            continue;
        };

        let line = match next {
            None => break,
            Some(Incoming::Line(line)) => line,
            // Вопрос и разрешение окно видит вопросом, а не строкой
            // инструмента.
            Some(Incoming::Call { id, name, input }) => {
                let call = json!({ "id": format!("call-{id}"), "name": name, "input": input });
                let result = if stopped || failure.is_some() {
                    Err(STOPPED.to_owned())
                } else {
                    tokio::select! {
                        result = run(&call, asking, events) => result,
                        () = stop.notified() => {
                            stopped = true;
                            talk.interrupt();
                            Err(STOPPED.to_owned())
                        }
                    }
                };

                talk.reply(id, result).await;
                continue;
            }
        };

        // Строки субагентов окну не нужны: их работу видно строкой
        // инструмента, который их запустил.
        if !line["parent_tool_use_id"].is_null() {
            continue;
        }

        match line["type"].as_str().unwrap_or_default() {
            "system" if line["subtype"] == "init" => {
                if let Some(problem) = claude_init_problem(&line) {
                    failure.get_or_insert(problem);
                    talk.interrupt();
                } else if let Some(id) = line["session_id"].as_str() {
                    session.chat.session = Some(ClaudeSession {
                        id: id.to_owned(),
                        seen: None,
                    });
                    keep(store, session, &mut failure, talk);
                }
            }
            "stream_event" => {
                let delta = &line["event"]["delta"];

                if delta["type"] == "text_delta"
                    && let Some(text) = delta["text"].as_str()
                {
                    shown.push_str(text);
                    events(Event::Text {
                        text: text.to_owned(),
                    });
                }
            }
            "assistant" => {
                let blocks = claude_blocks(&line["message"]);

                if blocks.iter().any(|block| block["type"] == "text") {
                    shown.clear();
                }

                // Вызов виден окну, как только Claude его начал. Вопрос
                // агента окно увидит вопросом.
                for block in &blocks {
                    if block["type"] == "tool_use" && block["name"] != "ask_user" {
                        events(Event::tool(block, true));
                    }
                }

                push_assistant(&mut session.chat.messages, blocks);
                keep(store, session, &mut failure, talk);
            }
            "user" => {
                let results: Vec<Value> = claude_blocks(&line["message"])
                    .into_iter()
                    .filter(|block| block["type"] == "tool_result")
                    .collect();

                if !results.is_empty() {
                    push_user(&mut session.chat.messages, results);
                    keep(store, session, &mut failure, talk);
                }
            }
            "rate_limit_event" if line["rate_limit_info"]["status"] == "rejected" => {
                resets = line["rate_limit_info"]["resetsAt"].as_u64();
            }
            "result" => result = Some(claude_result(&line)),
            _ => {}
        }
    }

    if !shown.is_empty() {
        push_assistant(
            &mut session.chat.messages,
            vec![json!({ "type": "text", "text": shown })],
        );
    }

    if stopped {
        return Outcome::Stopped;
    }

    let failure = match (failure, result) {
        (Some(error), _) => Some(error),
        (None, Some(result)) => result.err(),
        (None, None) => Some(claude_failure(talk.errors())),
    };

    match failure {
        None => Outcome::Done,
        // Лимит подписки Claude Code сообщает событием до отказа, и там же
        // время сброса.
        Some(_) if resets.is_some() => {
            Outcome::Failed(AppError::unavailable("claude_limit"), resets)
        }
        Some(error) => Outcome::Failed(error, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::agent::domain::{ClaudeState, ClaudeStatus, Stamp};
    use std::collections::{BTreeMap, HashMap, VecDeque};
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use tauri::async_runtime::block_on;

    /// Человек, который отвечает по очереди и помнит вопросы. `None` значит,
    /// что ответа не дождались. Кончились ответы, и он жмёт «Стоп» вместо
    /// ответа.
    struct FakeHuman {
        answers: Mutex<VecDeque<Option<Answer>>>,
        asked: Mutex<Vec<Question>>,
        stop: Arc<Notify>,
    }

    impl FakeHuman {
        fn with(answers: Vec<Option<Answer>>, stop: &Arc<Notify>) -> Self {
            Self {
                answers: Mutex::new(answers.into()),
                asked: Mutex::default(),
                stop: stop.clone(),
            }
        }

        fn asked(&self) -> Vec<Question> {
            self.asked.lock().unwrap().clone()
        }
    }

    impl Human for FakeHuman {
        async fn ask(&self, question: &Question) -> Option<Answer> {
            self.asked.lock().unwrap().push(question.clone());

            let answer = self.answers.lock().unwrap().pop_front();

            match answer {
                Some(answer) => answer,
                None => {
                    self.stop.notify_one();
                    std::future::pending().await
                }
            }
        }
    }

    /// Проекты, у которых папка на месте. Остальных для агента нет.
    struct FakeProjects(HashMap<&'static str, PathBuf>);

    impl Default for FakeProjects {
        fn default() -> Self {
            Self(HashMap::from([
                ("p1", PathBuf::from("/код/sapien")),
                ("p2", PathBuf::from("/код/сайт")),
            ]))
        }
    }

    impl Projects for FakeProjects {
        fn folder(&self, id: &str) -> Option<PathBuf> {
            self.0.get(id).cloned()
        }
    }

    #[derive(Default)]
    struct FakeSessions(Mutex<BTreeMap<String, Session>>);

    impl FakeSessions {
        /// Сессии `s1` в проекте `p1`, заведённой в 1.
        fn one() -> Self {
            let sessions = Self::default();

            new_session(&sessions, &FakeProjects::default(), "p1", "s1".into(), 1).unwrap();
            sessions
        }

        fn get(&self, id: &str) -> Session {
            self.0.lock().unwrap()[id].clone()
        }

        fn ids(&self) -> Vec<String> {
            self.0.lock().unwrap().keys().cloned().collect()
        }
    }

    impl Sessions for FakeSessions {
        fn list(&self) -> Result<Vec<SessionInfo>, AppError> {
            Ok(self.0.lock().unwrap().values().map(Session::info).collect())
        }

        fn load(&self, id: &str) -> Result<Session, AppError> {
            self.0
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or(AppError::not_found("session_missing"))
        }

        fn save(&self, session: &Session) -> Result<(), AppError> {
            self.0
                .lock()
                .unwrap()
                .insert(session.id.clone(), session.clone());
            Ok(())
        }

        fn delete(&self, id: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
    }

    /// Шаг поддельного ответа Claude Code.
    enum Step {
        Line(Value),
        /// Вызов инструмента sapien по MCP.
        Call(&'static str, Value),
        /// Claude Code молчит, а человек жмёт «Стоп».
        Hang(Arc<Notify>),
    }

    /// Запуск, как его увидел поддельный Claude Code.
    #[derive(Debug, PartialEq)]
    struct Started {
        dir: PathBuf,
        resume: Option<String>,
        fork: bool,
        prompt: String,
        oversight: Oversight,
    }

    /// Что видел поддельный Claude Code: запуски, ответы на вызовы
    /// и сколько раз его прерывали.
    #[derive(Default)]
    struct Seen {
        runs: Vec<Started>,
        replies: Vec<Result<String, String>>,
        interrupts: usize,
    }

    struct FakeTalk {
        steps: VecDeque<Step>,
        errors: String,
        calls: u64,
        seen: Arc<Mutex<Seen>>,
    }

    impl Conversation for FakeTalk {
        async fn next(&mut self) -> Option<Incoming> {
            match self.steps.pop_front()? {
                Step::Line(line) => Some(Incoming::Line(line)),
                Step::Call(name, input) => {
                    self.calls += 1;
                    Some(Incoming::Call {
                        id: json!(self.calls),
                        name: name.into(),
                        input,
                    })
                }
                Step::Hang(stop) => {
                    stop.notify_one();
                    std::future::pending().await
                }
            }
        }

        async fn reply(&mut self, _id: Value, result: Result<String, String>) {
            self.seen.lock().unwrap().replies.push(result);
        }

        fn interrupt(&mut self) {
            self.seen.lock().unwrap().interrupts += 1;
        }

        fn errors(&self) -> &str {
            &self.errors
        }
    }

    /// Claude Code, который отвечает в сессии по сценарию `talks`: шаги
    /// и что он пишет в stderr. Файл сессии лежит таким, как `stamp`.
    #[derive(Default)]
    struct FakeClaude {
        talks: Mutex<VecDeque<(Vec<Step>, &'static str)>>,
        seen: Arc<Mutex<Seen>>,
        stamp: Mutex<Option<Stamp>>,
    }

    impl FakeClaude {
        fn talking(talks: Vec<(Vec<Step>, &'static str)>) -> Self {
            Self {
                talks: Mutex::new(talks.into()),
                ..Self::default()
            }
        }

        fn runs(&self) -> usize {
            self.seen.lock().unwrap().runs.len()
        }

        fn replies(&self) -> Vec<Result<String, String>> {
            self.seen.lock().unwrap().replies.clone()
        }
    }

    impl Claude for FakeClaude {
        type Talk = FakeTalk;

        async fn status(&self) -> ClaudeStatus {
            ClaudeStatus::of_state(ClaudeState::Ready)
        }

        async fn converse(&self, run: &Run<'_>) -> Result<FakeTalk, AppError> {
            let (steps, errors) = self
                .talks
                .lock()
                .unwrap()
                .pop_front()
                .expect("лишний запуск Claude Code");

            self.seen.lock().unwrap().runs.push(Started {
                dir: run.dir.to_owned(),
                resume: run.resume.map(str::to_owned),
                fork: run.fork,
                prompt: run.prompt.to_owned(),
                oversight: run.oversight,
            });

            Ok(FakeTalk {
                steps: steps.into(),
                errors: errors.into(),
                calls: 0,
                seen: self.seen.clone(),
            })
        }

        fn stamp(&self, dir: &Path, _id: &str) -> Option<Stamp> {
            assert_eq!(dir, Path::new("/код/sapien"));
            *self.stamp.lock().unwrap()
        }
    }

    fn init(session: &str) -> Step {
        Step::Line(json!({
            "type": "system",
            "subtype": "init",
            "session_id": session,
            "apiKeySource": "none",
            "mcp_servers": [{ "name": "sapien", "status": "connected" }],
            "tools": ["Bash", "Edit", "Read", "mcp__sapien__ask_user"],
        }))
    }

    fn delta(text: &str) -> Step {
        Step::Line(json!({
            "type": "stream_event",
            "parent_tool_use_id": null,
            "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": text } },
        }))
    }

    fn said(blocks: Value) -> Step {
        Step::Line(json!({
            "type": "assistant",
            "parent_tool_use_id": null,
            "message": { "role": "assistant", "content": blocks },
        }))
    }

    fn tool_result(id: &str, text: &str, error: bool) -> Step {
        Step::Line(json!({
            "type": "user",
            "parent_tool_use_id": null,
            "message": { "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": id, "content": [{ "type": "text", "text": text }], "is_error": error },
            ] },
        }))
    }

    fn done() -> Step {
        Step::Line(
            json!({ "type": "result", "subtype": "success", "is_error": false, "result": "" }),
        )
    }

    struct Sent {
        result: Result<(), AppError>,
        events: Vec<Event>,
    }

    fn send_in(
        claude: &FakeClaude,
        sessions: &FakeSessions,
        (human, oversight): (&FakeHuman, Oversight),
        stop: &Notify,
        (session, text): (&str, &str),
    ) -> Sent {
        let mut events = vec![];
        let turn = Turn {
            session,
            model: "claude-opus-5-5",
            text,
            oversight,
            now: 7,
        };
        let result = block_on(send(
            claude,
            &FakeProjects::default(),
            sessions,
            human,
            stop,
            turn,
            &mut |event| events.push(event),
        ));

        Sent { result, events }
    }

    fn nobody() -> FakeHuman {
        FakeHuman::with(vec![], &Arc::new(Notify::new()))
    }

    /// Ответ в сессии `s1`, когда человек правок не проверяет.
    fn trusting(claude: &FakeClaude, sessions: &FakeSessions, text: &str) -> Sent {
        send_in(
            claude,
            sessions,
            (&nobody(), Oversight::Trust),
            &Notify::new(),
            ("s1", text),
        )
    }

    #[test]
    fn сессия_заводится_в_проекте_и_берёт_заголовок_из_первого_сообщения() {
        let claude = FakeClaude::talking(vec![
            (vec![init("c1"), done()], ""),
            (vec![init("c1"), done()], ""),
        ]);
        let sessions = FakeSessions::one();

        assert_eq!(
            new_session(&sessions, &FakeProjects::default(), "p9", "s2".into(), 1),
            Err(AppError::not_found("project_missing"))
        );
        assert_eq!(
            sessions.get("s1").info(),
            SessionInfo {
                id: "s1".into(),
                project: "p1".into(),
                title: String::new(),
                updated: 1,
            }
        );

        assert_eq!(
            trusting(&claude, &sessions, "  Почини сборку\nпадает на CI").result,
            Ok(())
        );
        assert_eq!(trusting(&claude, &sessions, "И тесты").result, Ok(()));

        let session = sessions.get("s1");

        assert_eq!(session.title, "Почини сборку");
        assert_eq!((session.created, session.updated), (1, 7));
        assert_eq!(
            sessions_list(&sessions),
            [("s1".to_owned(), "Почини сборку".to_owned())]
        );
    }

    fn sessions_list(store: &FakeSessions) -> Vec<(String, String)> {
        sessions(store)
            .unwrap()
            .into_iter()
            .map(|session| (session.id, session.title))
            .collect()
    }

    #[test]
    fn список_сессий_от_свежих_к_старым() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();

        new_session(&store, &projects, "p1", "a".into(), 5).unwrap();
        new_session(&store, &projects, "p2", "b".into(), 9).unwrap();
        new_session(&store, &projects, "p1", "c".into(), 1).unwrap();

        let ids: Vec<String> = sessions(&store)
            .unwrap()
            .into_iter()
            .map(|session| session.id)
            .collect();

        assert_eq!(ids, ["b", "a", "c"]);
    }

    #[test]
    fn занятую_сессию_и_проект_с_ней_не_удалить() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();

        for (id, project) in [("a", "p1"), ("b", "p1"), ("c", "p2")] {
            new_session(&store, &projects, project, id.into(), 1).unwrap();
        }

        let busy = Err(AppError::conflict("agent_busy"));
        // Ответы идут в двух сессиях сразу.
        let running = |id: &str| ["b", "c"].contains(&id);

        assert_eq!(delete_session(&store, running, "b"), busy);
        assert_eq!(delete_session(&store, running, "c"), busy);
        assert_eq!(forget_project(&store, running, "p1"), busy);
        assert_eq!(store.ids(), ["a", "b", "c"]);

        // Свободная сессия рядом с занятыми удаляется.
        delete_session(&store, running, "a").unwrap();
        assert_eq!(store.ids(), ["b", "c"]);

        // Ответ идёт только в другом проекте: этот убирается целиком.
        forget_project(&store, |id| id == "c", "p1").unwrap();
        assert_eq!(store.ids(), ["c"]);

        delete_session(&store, |id| id == "a", "c").unwrap();
        assert!(store.ids().is_empty());
        assert_eq!(
            history(&store, "c"),
            Err(AppError::not_found("session_missing"))
        );
    }

    #[test]
    fn без_папки_проекта_и_с_чужой_моделью_ответа_нет() {
        let claude = FakeClaude::default();
        let sessions = FakeSessions::default();

        sessions
            .save(&Session {
                id: "s1".into(),
                project: "убран".into(),
                title: String::new(),
                created: 1,
                updated: 1,
                chat: Chat::default(),
            })
            .unwrap();

        assert_eq!(
            trusting(&claude, &sessions, "Привет").result,
            Err(AppError::not_found("project_missing"))
        );
        assert_eq!(
            trusting(&claude, &FakeSessions::default(), "Привет").result,
            Err(AppError::not_found("session_missing"))
        );

        let fable = block_on(send(
            &claude,
            &FakeProjects::default(),
            &FakeSessions::one(),
            &nobody(),
            &Notify::new(),
            Turn {
                session: "s1",
                model: "claude-fable-5-1",
                text: "Привет",
                oversight: Oversight::Trust,
                now: 1,
            },
            &mut |_| {},
        ));

        assert_eq!(fable, Err(AppError::invalid("agent_model_unknown")));
        // Сообщение не легло в историю, а Claude Code не запускался.
        assert!(sessions.get("s1").chat.messages.is_empty());
        assert_eq!(claude.runs(), 0);
    }

    #[test]
    fn агент_работает_в_папке_проекта_своими_инструментами() {
        let edit = json!({ "file_path": "/код/sapien/README.md", "old_string": "черновик", "new_string": "готово" });
        let claude = FakeClaude::talking(vec![(
            vec![
                init("c1"),
                delta("Сейчас "),
                delta("поправлю."),
                said(json!([
                    { "type": "thinking", "thinking": "…" },
                    { "type": "text", "text": "Сейчас поправлю." },
                ])),
                said(
                    json!([{ "type": "tool_use", "id": "toolu_1", "name": "Edit", "input": edit }]),
                ),
                tool_result("toolu_1", "Файл изменён", false),
                said(
                    json!([{ "type": "tool_use", "id": "toolu_2", "name": "Bash", "input": { "command": "cargo test\n--quiet" } }]),
                ),
                tool_result("toolu_2", "error: 1 failed", true),
                delta("Готово."),
                said(json!([{ "type": "text", "text": "Готово." }])),
                done(),
            ],
            "",
        )]);
        let sessions = FakeSessions::one();
        let stamp = Stamp {
            len: 1,
            modified: 2,
        };

        *claude.stamp.lock().unwrap() = Some(stamp);

        let sent = trusting(&claude, &sessions, "Поправь README");

        assert_eq!(sent.result, Ok(()));
        assert_eq!(
            sent.events,
            [
                Event::Text {
                    text: "Сейчас ".into()
                },
                Event::Text {
                    text: "поправлю.".into()
                },
                Event::Tool {
                    name: "Edit".into(),
                    target: "/код/sapien/README.md".into(),
                    ok: true,
                },
                Event::Tool {
                    name: "Bash".into(),
                    target: "cargo test".into(),
                    ok: true,
                },
                Event::Text {
                    text: "Готово.".into()
                },
            ]
        );
        assert_eq!(
            claude.seen.lock().unwrap().runs,
            [Started {
                dir: "/код/sapien".into(),
                resume: None,
                fork: false,
                prompt: "Поправь README".into(),
                oversight: Oversight::Trust,
            }]
        );
        assert_eq!(
            history(&sessions, "s1").unwrap(),
            [
                Entry::User {
                    text: "Поправь README".into()
                },
                Entry::Assistant {
                    text: "Сейчас поправлю.".into()
                },
                Entry::Tool {
                    name: "Edit".into(),
                    target: "/код/sapien/README.md".into(),
                    ok: true,
                },
                // Окно видело вызов удачным, история знает, чем он кончился.
                Entry::Tool {
                    name: "Bash".into(),
                    target: "cargo test".into(),
                    ok: false,
                },
                Entry::Assistant {
                    text: "Готово.".into()
                },
            ]
        );
        assert_eq!(
            sessions.get("s1").chat.session,
            Some(ClaudeSession {
                id: "c1".into(),
                seen: Some(stamp),
            })
        );
    }

    #[test]
    fn разрешение_на_вызов_спрашивает_человека_а_решение_уходит_claude_code() {
        let approve = |id: &str, command: &str| {
            Step::Call(
                "approve",
                json!({ "tool_name": "Bash", "input": { "command": command }, "tool_use_id": id }),
            )
        };
        let claude = FakeClaude::talking(vec![(
            vec![
                init("c1"),
                said(
                    json!([{ "type": "tool_use", "id": "toolu_1", "name": "Bash", "input": { "command": "rm -rf build" } }]),
                ),
                approve("toolu_1", "rm -rf build"),
                approve("toolu_2", "git push"),
                approve("toolu_3", "git push --force"),
                Step::Call(
                    "approve",
                    json!({ "tool_name": "mcp__github__merge", "input": { "number": 1 } }),
                ),
                done(),
            ],
            "",
        )]);
        let stop = Arc::new(Notify::new());
        let human = FakeHuman::with(
            vec![
                Some(Answer::Allow),
                Some(Answer::Deny),
                Some(Answer::Text {
                    text: "не сейчас".into(),
                }),
                None,
            ],
            &stop,
        );

        let sent = send_in(
            &claude,
            &FakeSessions::one(),
            (&human, Oversight::Ask),
            &stop,
            ("s1", "Почисти и запушь"),
        );

        assert_eq!(sent.result, Ok(()));
        assert_eq!(
            claude.seen.lock().unwrap().runs[0].oversight,
            Oversight::Ask
        );
        assert_eq!(
            human.asked(),
            [
                Question::Permission {
                    id: "toolu_1".into(),
                    tool: "Bash".into(),
                    target: "rm -rf build".into(),
                },
                Question::Permission {
                    id: "toolu_2".into(),
                    tool: "Bash".into(),
                    target: "git push".into(),
                },
                Question::Permission {
                    id: "toolu_3".into(),
                    tool: "Bash".into(),
                    target: "git push --force".into(),
                },
                // Без номера вызова Claude вопрос берёт номер вызова MCP.
                Question::Permission {
                    id: "call-4".into(),
                    tool: "mcp__github__merge".into(),
                    target: String::new(),
                },
            ]
        );

        let decisions: Vec<Value> = claude
            .replies()
            .into_iter()
            .map(|reply| serde_json::from_str(&reply.unwrap()).unwrap())
            .collect();

        assert_eq!(
            decisions[0],
            json!({ "behavior": "allow", "updatedInput": { "command": "rm -rf build" } })
        );
        assert!(
            decisions[1..]
                .iter()
                .all(|decision| decision["behavior"] == "deny")
        );
        assert!(
            decisions[2]["message"]
                .as_str()
                .unwrap()
                .contains("не сейчас")
        );

        // Разрешение в окне только вопросом: строка инструмента одна,
        // от самого вызова.
        let tools: Vec<&Event> = sent
            .events
            .iter()
            .filter(|event| matches!(event, Event::Tool { .. }))
            .collect();

        assert_eq!(tools.len(), 1);
        assert!(sent.events.contains(&Event::Answered {
            id: "toolu_2".into(),
            answer: None
        }));
    }

    #[test]
    fn без_проверки_разрешения_даются_без_вопроса() {
        let claude = FakeClaude::talking(vec![(
            vec![
                init("c1"),
                Step::Call(
                    "approve",
                    json!({ "tool_name": "Write", "input": { "file_path": "a.md" } }),
                ),
                done(),
            ],
            "",
        )]);
        let sessions = FakeSessions::one();

        assert_eq!(trusting(&claude, &sessions, "Запиши").result, Ok(()));
        assert_eq!(
            serde_json::from_str::<Value>(&claude.replies()[0].clone().unwrap()).unwrap()["behavior"],
            "allow"
        );
    }

    #[test]
    fn сессия_продолжается_снаружи_в_копии_а_пропавшая_начинается_заново() {
        let claude = FakeClaude::talking(vec![
            (vec![init("c1"), done()], ""),
            (vec![init("c1"), done()], ""),
            (vec![init("c2"), done()], ""),
            (vec![], "No conversation found with session ID: c2"),
            (
                vec![
                    init("c3"),
                    said(json!([{ "type": "text", "text": "Начнём." }])),
                    done(),
                ],
                "",
            ),
        ]);
        let sessions = FakeSessions::one();
        let send = |text: &str| trusting(&claude, &sessions, text).result;
        let ours = Some(Stamp {
            len: 1,
            modified: 1,
        });

        *claude.stamp.lock().unwrap() = ours;
        assert_eq!(send("Привет"), Ok(()));
        assert_eq!(send("Как дела"), Ok(()));

        // Разговор продолжили в терминале: файл сессии уже не тот.
        *claude.stamp.lock().unwrap() = Some(Stamp {
            len: 9,
            modified: 9,
        });
        assert_eq!(send("Ещё"), Ok(()));

        // Сессию удалили по сроку хранения.
        assert_eq!(send("Снова"), Ok(()));

        let runs: Vec<(Option<String>, bool, String)> = claude
            .seen
            .lock()
            .unwrap()
            .runs
            .iter()
            .map(|run| (run.resume.clone(), run.fork, run.prompt.clone()))
            .collect();
        let resumed = |id: &str, fork, text: &str| (Some(id.to_owned()), fork, text.to_owned());

        assert_eq!(
            runs,
            [
                (None, false, "Привет".to_owned()),
                resumed("c1", false, "Как дела"),
                resumed("c1", true, "Ещё"),
                resumed("c2", false, "Снова"),
                (None, false, "Снова".to_owned()),
            ]
        );
        assert_eq!(
            history(&sessions, "s1").unwrap()[3..],
            [
                Entry::User {
                    text: "Снова".into()
                },
                Entry::Notice {
                    code: "claude_session_new".into(),
                    resets: None,
                },
                Entry::Assistant {
                    text: "Начнём.".into()
                },
            ]
        );
        assert_eq!(
            sessions.get("s1").chat.session.map(|session| session.id),
            Some("c3".into())
        );
    }

    #[test]
    fn стоп_прерывает_claude_code_а_поздний_вызов_отклонён() {
        let stop = Arc::new(Notify::new());
        let claude = FakeClaude::talking(vec![(
            vec![
                init("c1"),
                delta("Дальше пишу"),
                Step::Hang(stop.clone()),
                // Claude Code успел позвать инструмент, пока выходил.
                Step::Call(
                    "ask_user",
                    json!({ "question": "Продолжать?", "options": ["да"] }),
                ),
            ],
            "",
        )]);
        let sessions = FakeSessions::one();
        let human = nobody();

        let sent = send_in(
            &claude,
            &sessions,
            (&human, Oversight::Ask),
            &stop,
            ("s1", "Допиши план"),
        );

        assert_eq!(sent.result, Ok(()));
        assert!(human.asked().is_empty());
        assert_eq!(claude.seen.lock().unwrap().interrupts, 1);
        assert_eq!(claude.replies(), [Err(STOPPED.to_owned())]);
        // Показанный текст остался, хотя целым блоком он не пришёл.
        assert!(
            history(&sessions, "s1")
                .unwrap()
                .contains(&Entry::Assistant {
                    text: "Дальше пишу".into()
                })
        );
    }

    #[test]
    fn отказ_остаётся_в_истории_и_не_затирается_следующим() {
        let claude = FakeClaude::talking(vec![
            (
                vec![
                    init("c1"),
                    Step::Line(json!({
                        "type": "rate_limit_event",
                        "rate_limit_info": { "status": "rejected", "resetsAt": 1_793_000_000 },
                    })),
                    Step::Line(json!({
                        "type": "result",
                        "subtype": "success",
                        "is_error": true,
                        "result": "You've hit your limit · resets 3pm",
                    })),
                ],
                "",
            ),
            (vec![], "Unable to connect to API (ECONNREFUSED)"),
            (
                vec![
                    Step::Line(json!({
                        "type": "system",
                        "subtype": "init",
                        "session_id": "c9",
                        "apiKeySource": "ANTHROPIC_API_KEY",
                        "mcp_servers": [{ "name": "sapien", "status": "connected" }],
                    })),
                    Step::Call(
                        "approve",
                        json!({ "tool_name": "Bash", "input": { "command": "ls" } }),
                    ),
                ],
                "",
            ),
        ]);
        let sessions = FakeSessions::one();
        let send = |text: &str| {
            trusting(&claude, &sessions, text)
                .result
                .map_err(|error| error.code)
        };

        assert_eq!(send("Раз"), Err("claude_limit"));
        assert_eq!(send(""), Err("agent_unreachable"));
        assert_eq!(send("Два"), Err("claude_not_subscription"));
        // Ответ шёл бы с ключа API: вызов отклонён, Claude Code прерван.
        assert_eq!(claude.replies(), [Err(STOPPED.to_owned())]);
        assert_eq!(claude.seen.lock().unwrap().interrupts, 1);

        let notices: Vec<Entry> = history(&sessions, "s1")
            .unwrap()
            .into_iter()
            .filter(|entry| matches!(entry, Entry::Notice { .. }))
            .collect();

        assert_eq!(
            notices,
            [
                Entry::Notice {
                    code: "claude_limit".into(),
                    resets: Some(1_793_000_000),
                },
                Entry::Notice {
                    code: "agent_unreachable".into(),
                    resets: None,
                },
                Entry::Notice {
                    code: "claude_not_subscription".into(),
                    resets: None,
                },
            ]
        );

        // «Повторить» шлёт то же сообщение снова.
        let seen = claude.seen.lock().unwrap();

        assert_eq!(seen.runs[1].prompt, seen.runs[0].prompt);
    }

    #[test]
    fn вопрос_claude_уходит_человеку_через_инструмент_sapien() {
        let stop = Arc::new(Notify::new());
        let ask = json!({ "question": "Какой срок?", "options": ["пятница", "понедельник"] });
        let claude = FakeClaude::talking(vec![(
            vec![
                init("c1"),
                said(
                    json!([{ "type": "tool_use", "id": "toolu_1", "name": "mcp__sapien__ask_user", "input": ask }]),
                ),
                Step::Call("ask_user", ask.clone()),
                tool_result("toolu_1", "пятница", false),
                done(),
            ],
            "",
        )]);
        let human = FakeHuman::with(
            vec![Some(Answer::Text {
                text: "пятница".into(),
            })],
            &stop,
        );
        let sessions = FakeSessions::one();

        let sent = send_in(
            &claude,
            &sessions,
            (&human, Oversight::Ask),
            &stop,
            ("s1", "Поставь срок"),
        );

        assert_eq!(sent.result, Ok(()));
        assert_eq!(
            human.asked(),
            [Question::Choice {
                id: "call-1".into(),
                question: "Какой срок?".into(),
                options: vec!["пятница".into(), "понедельник".into()],
            }]
        );
        assert_eq!(claude.replies(), [Ok("пятница".to_owned())]);
        assert!(
            !sent
                .events
                .iter()
                .any(|event| matches!(event, Event::Tool { .. }))
        );
        assert_eq!(
            history(&sessions, "s1").unwrap()[1],
            Entry::Question {
                id: "toolu_1".into(),
                question: "Какой срок?".into(),
                options: vec!["пятница".into(), "понедельник".into()],
                answer: Some("пятница".into()),
            }
        );

        // По расписанию человека нет: агент решает сам.
        let claude = FakeClaude::talking(vec![(
            vec![init("c1"), Step::Call("ask_user", ask), done()],
            "",
        )]);

        send_in(
            &claude,
            &FakeSessions::one(),
            (&nobody(), Oversight::Away),
            &Notify::new(),
            ("s1", "Поставь срок"),
        );
        assert_eq!(claude.replies(), [Err(AWAY.to_owned())]);
    }
}
