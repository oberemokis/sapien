use super::domain::{
    AWAY, Answer, Assembler, Chat, Context, Entry, Event, MAX_STEPS, MEETING, MeetingTask,
    ModelError, Oversight, Question, STOPPED, Tool, choice_result, meeting_message,
    meeting_request, meeting_schema, meeting_tasks, parse_model, permission_result, push_user,
    replace_once, request, search, touch, transcript, turns, undo_plan, user_blocks,
};
use super::ports::{ChatStore, Claude, Human, Model, Notes, Tracker};
use crate::error::AppError;
use crate::secrets::{SecretName, Secrets};
use serde_json::{Value, json};
use tokio::sync::Notify;

pub fn history(chat: &impl ChatStore) -> Result<Vec<Entry>, AppError> {
    let chat = chat.load()?;

    Ok(transcript(&chat.messages, &chat.changes))
}

pub fn clear(chat: &impl ChatStore) -> Result<(), AppError> {
    chat.clear()
}

/// «Откатить» у ответа на сообщение `turn`: этот ответ и более поздние,
/// которые трогали те же заметки (`undo_plan`). Заметки возвращаются
/// к тексту до них, созданные агентом уходят в корзину. Текущий текст
/// перед этим уходит в историю версий: правка человека поверх агента
/// не теряется, а откат сам обратим. Не вышло вернуть заметку, и ответы
/// остаются неоткаченными, откат можно повторить.
pub fn undo(chat: &impl ChatStore, notes: &impl Notes, turn: usize) -> Result<(), AppError> {
    let Chat {
        messages,
        mut changes,
    } = chat.load()?;
    let (turns, targets) = undo_plan(&changes, turn);

    for target in &targets {
        notes.revert(&target.path, target.before.as_deref())?;
    }

    for change in changes
        .iter_mut()
        .filter(|change| turns.contains(&change.turn))
    {
        change.undone = true;
    }

    chat.save(&messages, &changes)
}

/// Текст заметки до правки. Нет заметки, значит, правка её создаст.
fn before(notes: &impl Notes, path: &str) -> Result<Option<String>, AppError> {
    match notes.read(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.code == "note_missing" => Ok(None),
        Err(error) => Err(error),
    }
}

/// Сообщение человека. Пустой текст продолжает историю, которая кончается
/// его вопросом: так «Повторить» шлёт его снова после ошибки.
pub struct Turn<'a> {
    pub model: &'a str,
    pub text: &'a str,
    pub context: Context,
    pub oversight: Oversight,
}

/// Кому агент задаёт вопросы посреди ответа и спрашивать ли разрешения
/// на правку.
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

    /// Перед правкой заметки `path` человек у окна даёт разрешение, если
    /// просил спрашивать. Заметку из закрытой папки не спрашивает: правку
    /// всё равно отклонит хранилище.
    async fn allowed(
        &self,
        call: &Value,
        notes: &impl Notes,
        path: &str,
        events: &mut (impl FnMut(Event) + Send),
    ) -> Result<(), String> {
        if self.oversight != Oversight::Ask || !notes.open(path) {
            return Ok(());
        }

        let question = Question::Permission {
            id: call["id"].as_str().unwrap_or_default().to_owned(),
            tool: call["name"].as_str().unwrap_or_default().to_owned(),
            path: path.to_owned(),
        };

        permission_result(self.ask(question, events).await)
    }
}

/// Выполняет вызов инструмента. Ошибка уходит модели текстом, чтобы она
/// поправила вызов или сказала человеку, что не вышло. Заметку, которую
/// инструмент поменял, и её текст до правки получает `wrote`.
async fn run(
    call: &Value,
    assembler: &Assembler,
    notes: &impl Notes,
    tracker: &impl Tracker,
    asking: &Asking<'_, impl Human>,
    events: &mut (impl FnMut(Event) + Send),
    wrote: &mut (impl FnMut(&str, Option<String>) + Send),
) -> Result<String, String> {
    if let Some(raw) = call["id"]
        .as_str()
        .and_then(|id| assembler.invalid_input(id))
    {
        return Err(json!({ "INVALID_JSON": raw }).to_string());
    }

    let Some(tool) = Tool::parse(call) else {
        return Err("Неверные параметры вызова: сверь их со схемой инструмента.".to_owned());
    };
    let failed = |error: AppError| format!("Ошибка: {}", error.code);
    let done = match tool {
        Tool::AskUser { question, options } => {
            if asking.oversight == Oversight::Away {
                return Err(AWAY.to_owned());
            }

            let question = Question::Choice {
                id: call["id"].as_str().unwrap_or_default().to_owned(),
                question,
                options,
            };

            return choice_result(asking.ask(question, events).await);
        }
        Tool::ListNotes {} => notes.paths().map(|paths| paths.join("\n")),
        Tool::SearchNotes { query } => notes.texts().map(|texts| search(&texts, &query)),
        Tool::ReadNote { path } => notes.read(&path),
        Tool::WriteNote { path, text } => {
            asking.allowed(call, notes, &path, events).await?;

            let was = before(notes, &path).map_err(failed)?;

            notes.put(&path, &text).map(|()| {
                wrote(&path, was);
                "Записано.".to_owned()
            })
        }
        Tool::EditNote {
            path,
            old_text,
            new_text,
        } => {
            asking.allowed(call, notes, &path, events).await?;

            let text = notes.read(&path).map_err(failed)?;
            let edited = replace_once(&text, &old_text, &new_text).map_err(str::to_owned)?;

            notes.put(&path, &edited).map(|()| {
                wrote(&path, Some(text));
                "Заменено.".to_owned()
            })
        }
        Tool::YoutrackSearch { query } => tracker.search(&query).await,
        Tool::YoutrackIssue { id } => tracker.issue(&id).await,
        Tool::YoutrackEpicChanges { epic, since } => tracker.epic_changes(&epic, &since).await,
    };

    // Пустой результат API не примет, а модели нужен хоть какой-то ответ.
    done.map(|text| {
        if text.is_empty() {
            "(пусто)".to_owned()
        } else {
            text
        }
    })
    .map_err(failed)
}

/// Ответ агента на сообщение человека: запрос к модели, вызовы инструментов
/// и снова запрос, пока модель не ответит текстом. Текст ответа и сделанное
/// инструментами идут в окно по мере появления.
///
/// История пишется на диск после каждого шага в виде, который модель примет
/// обратно: «Стоп», обрыв сети и ошибка провайдера оставляют то, что уже
/// пришло, и вопрос человека. Ответ, который модель отказалась давать,
/// не сохраняется вовсе. «Стоп» посреди вызовов, например во время вопроса,
/// закрывает оставшиеся вызовы ошибкой, а сделанные правки остаются в откате.
#[expect(
    clippy::too_many_arguments,
    reason = "порты сценария и вход, без обёртки"
)]
pub async fn send(
    model: &impl Model,
    notes: &impl Notes,
    tracker: &impl Tracker,
    chat: &impl ChatStore,
    secrets: &Secrets,
    human: &impl Human,
    stop: &Notify,
    turn: Turn<'_>,
    events: &mut (impl FnMut(Event) + Send),
) -> Result<(), AppError> {
    let asking = Asking {
        human,
        oversight: turn.oversight,
    };
    let model_id = parse_model(turn.model).ok_or(AppError::invalid("agent_model_unknown"))?;
    let key = secrets
        .get(SecretName::ModelKey)
        .ok_or(AppError::not_found("agent_key_missing"))?;
    let Chat {
        mut messages,
        mut changes,
    } = chat.load()?;
    let mut context = turn.context;

    // Заметка из закрытой папки не уходит модели ни путём, ни выделением,
    // что бы ни прислало окно.
    if context
        .path
        .as_deref()
        .is_some_and(|path| !notes.open(path))
    {
        context = Context::default();
    }

    if !turn.text.trim().is_empty() {
        push_user(&mut messages, user_blocks(turn.text, &context));
        chat.save(&messages, &changes)?;
    }

    if messages.last().is_none_or(|last| last["role"] != "user") {
        return Ok(());
    }

    // Номер сообщения, на которое идёт ответ: «Повторить» продолжает его же.
    let asked = turns(&messages).saturating_sub(1);

    for _ in 0..MAX_STEPS {
        let body = request(model_id, &messages);
        let mut assembler = Assembler::default();
        let mut on_event = |event: Value| {
            if let Some(text) = assembler.apply(&event) {
                events(Event::Text { text });
            }
        };
        let streamed = tokio::select! {
            result = model.stream(&key, &body, &mut on_event) => Some(result),
            () = stop.notified() => None,
        };
        let reason = assembler.stop_reason().map(str::to_owned);
        let failure = match streamed {
            Some(Err(error)) => Some(error),
            _ => assembler.error(),
        };

        if reason.as_deref() == Some("refusal") {
            return Err(AppError::invalid("agent_refused"));
        }

        let finished = streamed.is_some()
            && failure.is_none()
            && reason
                .as_deref()
                .is_some_and(|reason| reason != "max_tokens");
        let message = assembler.message(finished);
        let calls: Vec<Value> = message
            .iter()
            .flat_map(|message| message["content"].as_array().into_iter().flatten())
            .filter(|block| block["type"] == "tool_use")
            .cloned()
            .collect();

        messages.extend(message);

        let outcome = match (streamed, failure, reason.as_deref()) {
            (None, ..) => Ok(false),
            (_, Some(error), _) => Err(error.into()),
            (_, _, Some("tool_use")) => Ok(!calls.is_empty()),
            (_, _, Some("max_tokens")) => Err(AppError::invalid("agent_too_long")),
            (_, _, Some(_)) => Ok(false),
            (_, _, None) => Err(ModelError::Unreachable.into()),
        };

        if !matches!(outcome, Ok(true)) {
            chat.save(&messages, &changes)?;
            return outcome.map(drop);
        }

        let mut results = vec![];
        let mut stopped = false;

        for call in &calls {
            let mut wrote = |path: &str, was| touch(&mut changes, asked, path, was);
            let result = if stopped {
                Err(STOPPED.to_owned())
            } else {
                tokio::select! {
                    result = run(call, &assembler, notes, tracker, &asking, events, &mut wrote) => result,
                    () = stop.notified() => {
                        stopped = true;
                        Err(STOPPED.to_owned())
                    }
                }
            };
            let ok = result.is_ok();
            let content = result.unwrap_or_else(|error| error);

            // Вопрос агента окно уже показало вопросом.
            if call["name"] != "ask_user" {
                events(Event::tool(call, ok));
            }

            results.push(json!({
                "type": "tool_result",
                "tool_use_id": call["id"],
                "content": content,
                "is_error": !ok,
            }));
        }

        push_user(&mut messages, results);
        chat.save(&messages, &changes)?;

        if stopped {
            return Ok(());
        }
    }

    Err(AppError::invalid("agent_too_many_steps"))
}

/// «Задачи из встречи»: агент читает заметку со встречи целиком и предлагает
/// черновики задач. Заметок он не меняет и в историю чата не пишет: черновики
/// из предложенного создаёт человек.
pub async fn meeting(
    model: &impl Model,
    notes: &impl Notes,
    secrets: &Secrets,
    model_name: &str,
    path: &str,
    today: &str,
) -> Result<Vec<MeetingTask>, AppError> {
    let model_id = parse_model(model_name).ok_or(AppError::invalid("agent_model_unknown"))?;
    let key = secrets
        .get(SecretName::ModelKey)
        .ok_or(AppError::not_found("agent_key_missing"))?;

    if !notes.open(path) {
        return Err(AppError::invalid("note_closed"));
    }

    let text = notes.read(path)?;
    let body = meeting_request(model_id, path, &text, today);
    let mut assembler = Assembler::default();
    let streamed = model
        .stream(&key, &body, &mut |event| {
            assembler.apply(&event);
        })
        .await;

    if let Some(error) = streamed.err().or(assembler.error()) {
        return Err(error.into());
    }

    match assembler.stop_reason() {
        Some("refusal") => return Err(AppError::invalid("agent_refused")),
        Some("max_tokens") => return Err(AppError::invalid("agent_too_long")),
        None => return Err(ModelError::Unreachable.into()),
        Some(_) => {}
    }

    let answer: String = assembler
        .message(true)
        .iter()
        .flat_map(|message| message["content"].as_array().into_iter().flatten())
        .filter_map(|block| block["text"].as_str())
        .collect();

    meeting_tasks(&answer).ok_or(AppError::invalid("agent_bad_answer"))
}

/// «Задачи из встречи» через подписку Claude: то же, что `meeting`, только
/// запрос идёт через Claude Code на устройстве, а не с ключом API.
pub async fn meeting_via_claude(
    claude: &impl Claude,
    notes: &impl Notes,
    model_name: &str,
    path: &str,
    today: &str,
) -> Result<Vec<MeetingTask>, AppError> {
    let model_id = parse_model(model_name).ok_or(AppError::invalid("agent_model_unknown"))?;

    if !notes.open(path) {
        return Err(AppError::invalid("note_closed"));
    }

    if let Some(problem) = claude.status().await.state.problem() {
        return Err(problem);
    }

    let text = notes.read(path)?;
    let answer = claude
        .structured(
            model_id,
            MEETING,
            &meeting_schema(),
            &meeting_message(path, &text, today),
        )
        .await?;

    meeting_tasks(&answer.to_string()).ok_or(AppError::invalid("agent_bad_answer"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::agent::domain::{Change, ClaudeState, ClaudeStatus};
    use std::collections::{BTreeMap, VecDeque};
    use std::sync::{Arc, Mutex};
    use tauri::async_runtime::block_on;

    enum Script {
        Answer(Vec<Value>),
        Fail(ModelError),
        /// Шлёт события и дальше молчит, будто модель думает. Пока молчит,
        /// человек жмёт «Стоп».
        Hang(Vec<Value>, Arc<Notify>),
    }

    /// Провайдер, который отвечает по сценарию и помнит запросы.
    #[derive(Default)]
    struct FakeModel {
        scripts: Mutex<VecDeque<Script>>,
        bodies: Mutex<Vec<(String, Value)>>,
    }

    impl FakeModel {
        fn with(scripts: Vec<Script>) -> Self {
            Self {
                scripts: Mutex::new(scripts.into()),
                bodies: Mutex::default(),
            }
        }
    }

    impl Model for FakeModel {
        async fn stream(
            &self,
            key: &str,
            body: &Value,
            on_event: &mut (impl FnMut(Value) + Send),
        ) -> Result<(), ModelError> {
            self.bodies
                .lock()
                .unwrap()
                .push((key.to_owned(), body.clone()));

            let script = self.scripts.lock().unwrap().pop_front();

            match script.expect("лишний запрос к модели") {
                Script::Answer(events) => {
                    events.into_iter().for_each(on_event);
                    Ok(())
                }
                Script::Fail(error) => Err(error),
                Script::Hang(events, stop) => {
                    events.into_iter().for_each(&mut *on_event);
                    stop.notify_one();
                    std::future::pending().await
                }
            }
        }
    }

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

    #[derive(Default)]
    struct FakeNotes(Mutex<BTreeMap<String, String>>);

    impl FakeNotes {
        fn with(notes: &[(&str, &str)]) -> Self {
            Self(Mutex::new(
                notes
                    .iter()
                    .map(|(path, text)| ((*path).into(), (*text).into()))
                    .collect(),
            ))
        }

        fn text(&self, path: &str) -> Option<String> {
            self.0.lock().unwrap().get(path).cloned()
        }
    }

    /// Папка «Личное» закрыта для агента.
    impl Notes for FakeNotes {
        fn open(&self, path: &str) -> bool {
            !path.starts_with("Личное/")
        }

        fn paths(&self) -> Result<Vec<String>, AppError> {
            Ok(self.0.lock().unwrap().keys().cloned().collect())
        }

        fn texts(&self) -> Result<Vec<(String, String)>, AppError> {
            Ok(self.0.lock().unwrap().clone().into_iter().collect())
        }

        fn read(&self, path: &str) -> Result<String, AppError> {
            self.text(path).ok_or(AppError::not_found("note_missing"))
        }

        fn put(&self, path: &str, text: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(path.into(), text.into());
            Ok(())
        }

        fn revert(&self, path: &str, before: Option<&str>) -> Result<(), AppError> {
            let mut notes = self.0.lock().unwrap();

            match before {
                Some(text) => notes.insert(path.into(), text.into()),
                None => notes.remove(path),
            };

            Ok(())
        }
    }

    /// YouTrack не подключён.
    struct NoTracker;

    impl Tracker for NoTracker {
        async fn search(&self, _query: &str) -> Result<String, AppError> {
            Err(AppError::not_found("youtrack_not_connected"))
        }

        async fn issue(&self, _id: &str) -> Result<String, AppError> {
            Err(AppError::not_found("youtrack_not_connected"))
        }

        async fn epic_changes(&self, _epic: &str, _since: &str) -> Result<String, AppError> {
            Err(AppError::not_found("youtrack_not_connected"))
        }
    }

    #[derive(Default)]
    struct FakeChat(Mutex<Chat>);

    impl FakeChat {
        fn messages(&self) -> Vec<Value> {
            self.0.lock().unwrap().messages.clone()
        }
    }

    impl ChatStore for FakeChat {
        fn load(&self) -> Result<Chat, AppError> {
            Ok(self.0.lock().unwrap().clone())
        }

        fn save(&self, messages: &[Value], changes: &[Change]) -> Result<(), AppError> {
            *self.0.lock().unwrap() = Chat {
                messages: messages.to_vec(),
                changes: changes.to_vec(),
            };
            Ok(())
        }

        fn clear(&self) -> Result<(), AppError> {
            *self.0.lock().unwrap() = Chat::default();
            Ok(())
        }
    }

    const KEY: &str = "sk-ant-ключ";

    fn keyed() -> Secrets {
        let secrets = Secrets::in_memory();

        secrets.set(SecretName::ModelKey, KEY).unwrap();
        secrets
    }

    fn text(text: &str) -> Vec<Value> {
        vec![
            json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }),
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": text } }),
            json!({ "type": "content_block_stop", "index": 0 }),
            json!({ "type": "message_delta", "delta": { "stop_reason": "end_turn" } }),
        ]
    }

    fn call(id: &str, name: &str, input: &Value) -> Vec<Value> {
        let tool = json!({ "type": "tool_use", "id": id, "name": name, "input": {} });

        vec![
            json!({ "type": "content_block_start", "index": 0, "content_block": tool }),
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "input_json_delta", "partial_json": input.to_string() } }),
            json!({ "type": "content_block_stop", "index": 0 }),
            json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" } }),
        ]
    }

    struct Run {
        result: Result<(), AppError>,
        events: Vec<Event>,
    }

    /// Ответ, при котором человек правок не проверяет и вопросов агент
    /// не задаёт.
    fn send_with(
        model: &FakeModel,
        notes: &FakeNotes,
        chat: &FakeChat,
        secrets: &Secrets,
        stop: &Notify,
        text: &str,
    ) -> Run {
        let nobody = FakeHuman::with(vec![], &Arc::new(Notify::new()));

        send_asking(
            model,
            notes,
            chat,
            (&nobody, Oversight::Trust),
            secrets,
            stop,
            text,
        )
    }

    fn send_asking(
        model: &FakeModel,
        notes: &FakeNotes,
        chat: &FakeChat,
        (human, oversight): (&FakeHuman, Oversight),
        secrets: &Secrets,
        stop: &Notify,
        text: &str,
    ) -> Run {
        let mut events = vec![];
        let turn = Turn {
            model: "claude-sonnet-5-5",
            text,
            context: Context {
                path: Some("план.md".into()),
                selection: None,
            },
            oversight,
        };
        let result = block_on(send(
            model,
            notes,
            &NoTracker,
            chat,
            secrets,
            human,
            stop,
            turn,
            &mut |event| events.push(event),
        ));

        Run { result, events }
    }

    #[test]
    fn агент_правит_заметку_инструментом_и_отвечает() {
        let model = FakeModel::with(vec![
            Script::Answer(call(
                "t1",
                "edit_note",
                &json!({ "path": "план.md", "old_text": "- [ ] релиз", "new_text": "- [x] релиз" }),
            )),
            Script::Answer(text("Отметил релиз.")),
        ]);
        let notes = FakeNotes::with(&[("план.md", "# План\n- [ ] релиз\n")]);
        let chat = FakeChat::default();

        let run = send_with(
            &model,
            &notes,
            &chat,
            &keyed(),
            &Notify::new(),
            "Отметь релиз",
        );

        assert_eq!(run.result, Ok(()));
        assert_eq!(
            notes.text("план.md").as_deref(),
            Some("# План\n- [x] релиз\n")
        );
        assert_eq!(
            run.events,
            [
                Event::Tool {
                    name: "edit_note".into(),
                    target: "план.md".into(),
                    ok: true
                },
                Event::Text {
                    text: "Отметил релиз.".into()
                },
            ]
        );
        assert_eq!(
            history(&chat).unwrap(),
            [
                Entry::User {
                    text: "Отметь релиз".into()
                },
                Entry::Tool {
                    name: "edit_note".into(),
                    target: "план.md".into(),
                    ok: true
                },
                Entry::Assistant {
                    text: "Отметил релиз.".into()
                },
                Entry::Changed {
                    turn: 0,
                    paths: vec!["план.md".into()],
                    undone: false,
                    with: vec![],
                },
            ]
        );

        let bodies = model.bodies.lock().unwrap();
        let (key, second) = &bodies[1];

        assert_eq!(key, KEY);
        assert_eq!(second["messages"][2]["content"][0]["content"], "Заменено.");
        assert!(
            second["messages"][0]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("Открыта заметка: план.md")
        );
    }

    #[test]
    fn отказ_инструмента_уходит_модели_ошибкой() {
        let model = FakeModel::with(vec![
            Script::Answer(call(
                "t1",
                "youtrack_search",
                &json!({ "query": "for: me" }),
            )),
            Script::Answer(text("YouTrack не подключён.")),
        ]);
        let chat = FakeChat::default();

        let run = send_with(
            &model,
            &FakeNotes::default(),
            &chat,
            &keyed(),
            &Notify::new(),
            "Мои задачи?",
        );

        assert_eq!(run.result, Ok(()));
        let bodies = model.bodies.lock().unwrap();
        assert_eq!(
            bodies[1].1["messages"][2]["content"][0],
            json!({
                "type": "tool_result",
                "tool_use_id": "t1",
                "content": "Ошибка: youtrack_not_connected",
                "is_error": true,
            })
        );
    }

    #[test]
    fn стоп_оставляет_пришедший_текст() {
        let stop = Arc::new(Notify::new());
        let mut partial = text("Начало ответа");
        partial.truncate(2);
        let model = FakeModel::with(vec![Script::Hang(partial, stop.clone())]);
        let chat = FakeChat::default();

        let run = send_with(
            &model,
            &FakeNotes::default(),
            &chat,
            &keyed(),
            &stop,
            "Расскажи",
        );

        assert_eq!(run.result, Ok(()));
        assert_eq!(
            history(&chat).unwrap(),
            [
                Entry::User {
                    text: "Расскажи".into()
                },
                Entry::Assistant {
                    text: "Начало ответа".into()
                },
            ]
        );
    }

    #[test]
    fn вопрос_после_ошибки_остаётся_и_уходит_снова() {
        let model = FakeModel::with(vec![
            Script::Fail(ModelError::RateLimited),
            Script::Answer(text("Ответ.")),
        ]);
        let chat = FakeChat::default();
        let secrets = keyed();

        let failed = send_with(
            &model,
            &FakeNotes::default(),
            &chat,
            &secrets,
            &Notify::new(),
            "Вопрос",
        );
        let retried = send_with(
            &model,
            &FakeNotes::default(),
            &chat,
            &secrets,
            &Notify::new(),
            "",
        );

        assert_eq!(
            failed.result,
            Err(AppError::unavailable("agent_rate_limited"))
        );
        assert_eq!(retried.result, Ok(()));
        assert_eq!(
            history(&chat).unwrap(),
            [
                Entry::User {
                    text: "Вопрос".into()
                },
                Entry::Assistant {
                    text: "Ответ.".into()
                },
            ]
        );
    }

    #[test]
    fn отказ_модели_не_сохраняет_ответ() {
        let mut refused = text("Не буду");
        refused[3] = json!({ "type": "message_delta", "delta": { "stop_reason": "refusal" } });
        let model = FakeModel::with(vec![Script::Answer(refused)]);
        let chat = FakeChat::default();

        let run = send_with(
            &model,
            &FakeNotes::default(),
            &chat,
            &keyed(),
            &Notify::new(),
            "Вопрос",
        );

        assert_eq!(run.result, Err(AppError::invalid("agent_refused")));
        assert_eq!(chat.messages().len(), 1);
    }

    #[test]
    fn без_ключа_и_с_чужой_моделью_запроса_нет() {
        let model = FakeModel::default();
        let chat = FakeChat::default();
        let no_key = send_with(
            &model,
            &FakeNotes::default(),
            &chat,
            &Secrets::in_memory(),
            &Notify::new(),
            "Вопрос",
        );
        let stop = Arc::new(Notify::new());
        let unknown = block_on(send(
            &model,
            &FakeNotes::default(),
            &NoTracker,
            &chat,
            &keyed(),
            &FakeHuman::with(vec![], &stop),
            &stop,
            Turn {
                model: "gpt-5",
                text: "Вопрос",
                context: Context::default(),
                oversight: Oversight::Ask,
            },
            &mut |_| {},
        ));

        assert_eq!(no_key.result, Err(AppError::not_found("agent_key_missing")));
        assert_eq!(unknown, Err(AppError::invalid("agent_model_unknown")));
        assert!(model.bodies.lock().unwrap().is_empty());
    }

    #[test]
    fn заметка_из_закрытой_папки_не_уходит_модели_ни_путём_ни_выделением() {
        let model = FakeModel::with(vec![Script::Answer(text("Не вижу заметки."))]);
        let chat = FakeChat::default();
        let stop = Arc::new(Notify::new());
        let result = block_on(send(
            &model,
            &FakeNotes::default(),
            &NoTracker,
            &chat,
            &keyed(),
            &FakeHuman::with(vec![], &stop),
            &stop,
            Turn {
                model: "claude-sonnet-5-5",
                text: "Что тут?",
                context: Context {
                    path: Some("Личное/дневник.md".into()),
                    selection: Some("сокровенное".into()),
                },
                oversight: Oversight::Ask,
            },
            &mut |_| {},
        ));

        assert_eq!(result, Ok(()));

        let sent = model.bodies.lock().unwrap()[0].1["messages"].to_string();

        assert!(!sent.contains("Личное"));
        assert!(!sent.contains("сокровенное"));
        assert!(sent.contains("Что тут?"));
    }

    #[test]
    fn откат_возвращает_все_заметки_ответа_а_созданную_убирает() {
        let model = FakeModel::with(vec![
            Script::Answer(call(
                "t1",
                "edit_note",
                &json!({ "path": "план.md", "old_text": "- [ ] релиз", "new_text": "- [x] релиз" }),
            )),
            Script::Answer(call(
                "t2",
                "write_note",
                &json!({ "path": "итоги.md", "text": "Релиз вышел." }),
            )),
            Script::Answer(call(
                "t3",
                "write_note",
                &json!({ "path": "Релизы/1.0.md", "text": "# 1.0" }),
            )),
            Script::Answer(call(
                "t4",
                "edit_note",
                &json!({ "path": "план.md", "old_text": "- [x] релиз", "new_text": "- [x] релиз 1.0" }),
            )),
            Script::Answer(text("Готово.")),
        ]);
        let notes = FakeNotes::with(&[("план.md", "- [ ] релиз\n"), ("итоги.md", "Пока пусто.")]);
        let chat = FakeChat::default();

        let run = send_with(
            &model,
            &notes,
            &chat,
            &keyed(),
            &Notify::new(),
            "Отметь релиз",
        );

        assert_eq!(run.result, Ok(()));
        assert_eq!(
            history(&chat).unwrap().last(),
            Some(&Entry::Changed {
                turn: 0,
                paths: vec!["план.md".into(), "итоги.md".into(), "Релизы/1.0.md".into()],
                undone: false,
                with: vec![],
            })
        );

        undo(&chat, &notes, 0).unwrap();

        assert_eq!(notes.text("план.md").as_deref(), Some("- [ ] релиз\n"));
        assert_eq!(notes.text("итоги.md").as_deref(), Some("Пока пусто."));
        assert_eq!(notes.text("Релизы/1.0.md"), None);
        assert!(matches!(
            history(&chat).unwrap().last(),
            Some(Entry::Changed { undone: true, .. })
        ));
    }

    #[test]
    fn откат_раннего_ответа_забирает_поздний_по_той_же_заметке() {
        let write = |id: &str, text: &str| {
            Script::Answer(call(
                id,
                "write_note",
                &json!({ "path": "план.md", "text": text }),
            ))
        };
        let model = FakeModel::with(vec![
            write("t1", "один"),
            Script::Answer(text("Записал.")),
            Script::Answer(text("Привет.")),
            write("t2", "три"),
            Script::Answer(text("Переписал.")),
        ]);
        let notes = FakeNotes::with(&[("план.md", "ноль")]);
        let chat = FakeChat::default();
        let secrets = keyed();

        for question in ["Запиши", "Привет", "Перепиши"] {
            let run = send_with(&model, &notes, &chat, &secrets, &Notify::new(), question);

            assert_eq!(run.result, Ok(()));
        }

        assert!(history(&chat).unwrap().contains(&Entry::Changed {
            turn: 0,
            paths: vec!["план.md".into()],
            undone: false,
            with: vec![2],
        }));

        undo(&chat, &notes, 1).unwrap();
        assert_eq!(notes.text("план.md").as_deref(), Some("три"));

        undo(&chat, &notes, 0).unwrap();
        assert_eq!(notes.text("план.md").as_deref(), Some("ноль"));
        assert!(
            chat.0
                .lock()
                .unwrap()
                .changes
                .iter()
                .all(|change| change.undone)
        );
    }

    /// Несколько вызовов инструментов одним сообщением модели.
    fn calls(list: &[(&str, &str, Value)]) -> Vec<Value> {
        let mut events: Vec<Value> = list
            .iter()
            .enumerate()
            .flat_map(|(index, (id, name, input))| {
                let tool = json!({ "type": "tool_use", "id": id, "name": name, "input": {} });

                [
                    json!({ "type": "content_block_start", "index": index, "content_block": tool }),
                    json!({ "type": "content_block_delta", "index": index, "delta": { "type": "input_json_delta", "partial_json": input.to_string() } }),
                    json!({ "type": "content_block_stop", "index": index }),
                ]
            })
            .collect();

        events.push(json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" } }));
        events
    }

    /// Результаты инструментов, с которыми модель получила запрос `index`.
    fn results(model: &FakeModel, index: usize) -> Vec<Value> {
        let bodies = model.bodies.lock().unwrap();
        let last = bodies[index].1["messages"]
            .as_array()
            .unwrap()
            .last()
            .unwrap();

        last["content"].as_array().unwrap().clone()
    }

    #[test]
    fn вопрос_агента_уходит_человеку_а_ответ_агенту() {
        let stop = Arc::new(Notify::new());
        let ask = json!({ "question": "Куда записать?", "options": ["Идеи", "План"] });
        let model = FakeModel::with(vec![
            Script::Answer(call("q1", "ask_user", &ask)),
            Script::Answer(text("Записал в идеи.")),
        ]);
        let human = FakeHuman::with(
            vec![Some(Answer::Text {
                text: "В идеи".into(),
            })],
            &stop,
        );
        let chat = FakeChat::default();

        let run = send_asking(
            &model,
            &FakeNotes::default(),
            &chat,
            (&human, Oversight::Ask),
            &keyed(),
            &stop,
            "Запиши мысль",
        );

        let options = vec!["Идеи".to_owned(), "План".to_owned()];
        let question = Question::Choice {
            id: "q1".into(),
            question: "Куда записать?".into(),
            options: options.clone(),
        };

        assert_eq!(run.result, Ok(()));
        assert_eq!(human.asked(), [question.clone()]);
        assert_eq!(
            run.events[..2],
            [
                Event::Asked { question },
                Event::Answered {
                    id: "q1".into(),
                    answer: Some("В идеи".into()),
                },
            ]
        );
        assert_eq!(results(&model, 1)[0]["content"], "В идеи");
        assert_eq!(
            history(&chat).unwrap()[1],
            Entry::Question {
                id: "q1".into(),
                question: "Куда записать?".into(),
                options,
                answer: Some("В идеи".into()),
            }
        );
    }

    #[test]
    fn правка_ждёт_разрешения_человека_а_отказ_агент_принимает() {
        let edit = json!({ "path": "план.md", "old_text": "было", "new_text": "стало" });
        let attempt = |answer: Answer| {
            let stop = Arc::new(Notify::new());
            let model = FakeModel::with(vec![
                Script::Answer(call("e1", "edit_note", &edit)),
                Script::Answer(text("Готово.")),
            ]);
            let notes = FakeNotes::with(&[("план.md", "было")]);
            let human = FakeHuman::with(vec![Some(answer)], &stop);

            let run = send_asking(
                &model,
                &notes,
                &FakeChat::default(),
                (&human, Oversight::Ask),
                &keyed(),
                &stop,
                "Поправь",
            );

            assert_eq!(run.result, Ok(()));
            assert_eq!(
                human.asked(),
                [Question::Permission {
                    id: "e1".into(),
                    tool: "edit_note".into(),
                    path: "план.md".into(),
                }]
            );

            (
                notes.text("план.md").unwrap(),
                results(&model, 1)[0].clone(),
            )
        };

        let (text, result) = attempt(Answer::Allow);
        assert_eq!(text, "стало");
        assert_eq!(result["is_error"], false);

        let (text, result) = attempt(Answer::Deny);
        assert_eq!(text, "было");
        assert_eq!(result["is_error"], true);
        assert_eq!(
            result["content"],
            permission_result(Some(Answer::Deny)).unwrap_err()
        );

        // Написанное вместо кнопки это отказ со словами человека.
        let (text, result) = attempt(Answer::Text {
            text: "лучше завтра".into(),
        });
        assert_eq!(text, "было");
        assert!(
            result["content"]
                .as_str()
                .unwrap()
                .contains("«лучше завтра»")
        );
    }

    #[test]
    fn без_ответа_правки_нет_а_на_вопрос_агент_решает_сам() {
        let stop = Arc::new(Notify::new());
        let model = FakeModel::with(vec![
            Script::Answer(call(
                "q1",
                "ask_user",
                &json!({ "question": "Куда?", "options": ["Сюда", "Туда"] }),
            )),
            Script::Answer(call(
                "w1",
                "write_note",
                &json!({ "path": "новая.md", "text": "текст" }),
            )),
            Script::Answer(text("Выбрал «Сюда», заметку не создал.")),
        ]);
        let notes = FakeNotes::default();
        let human = FakeHuman::with(vec![None, None], &stop);
        let chat = FakeChat::default();

        let run = send_asking(
            &model,
            &notes,
            &chat,
            (&human, Oversight::Ask),
            &keyed(),
            &stop,
            "Сделай",
        );

        assert_eq!(run.result, Ok(()));
        assert_eq!(notes.text("новая.md"), None);
        assert_eq!(results(&model, 1)[0]["is_error"], true);
        assert!(
            results(&model, 1)[0]["content"]
                .as_str()
                .unwrap()
                .contains("Реши сам")
        );
        assert_eq!(results(&model, 2)[0]["is_error"], true);
        assert!(run.events.contains(&Event::Answered {
            id: "q1".into(),
            answer: None,
        }));
        assert!(matches!(
            history(&chat).unwrap()[1],
            Entry::Question { answer: None, .. }
        ));
    }

    #[test]
    fn без_проверки_и_по_расписанию_правки_идут_без_вопросов() {
        for oversight in [Oversight::Trust, Oversight::Away] {
            let stop = Arc::new(Notify::new());
            let model = FakeModel::with(vec![
                Script::Answer(calls(&[
                    (
                        "q1",
                        "ask_user",
                        json!({ "question": "Какой эпик?", "options": ["SAP-1", "SAP-2"] }),
                    ),
                    (
                        "w1",
                        "write_note",
                        json!({ "path": "сводка.md", "text": "итоги" }),
                    ),
                ])),
                Script::Answer(text("Готово.")),
            ]);
            let notes = FakeNotes::default();
            let human = FakeHuman::with(
                vec![Some(Answer::Text {
                    text: "SAP-1".into(),
                })],
                &stop,
            );

            let run = send_asking(
                &model,
                &notes,
                &FakeChat::default(),
                (&human, oversight),
                &keyed(),
                &stop,
                "Сводка",
            );
            let results = results(&model, 1);

            assert_eq!(run.result, Ok(()));
            assert_eq!(notes.text("сводка.md").as_deref(), Some("итоги"));
            assert_eq!(results[1]["is_error"], false);

            if oversight == Oversight::Away {
                // Человека нет: агент решает сам, а окно вопроса не видит.
                assert!(human.asked().is_empty());
                assert_eq!(results[0]["content"], AWAY);
            } else {
                assert_eq!(human.asked().len(), 1);
                assert_eq!(results[0]["content"], "SAP-1");
            }
        }
    }

    #[test]
    fn стоп_на_втором_разрешении_оставляет_первую_правку_в_откате() {
        let stop = Arc::new(Notify::new());
        let model = FakeModel::with(vec![
            Script::Answer(calls(&[
                (
                    "e1",
                    "edit_note",
                    json!({ "path": "план.md", "old_text": "было", "new_text": "стало" }),
                ),
                (
                    "e2",
                    "edit_note",
                    json!({ "path": "идеи.md", "old_text": "мысль", "new_text": "идея" }),
                ),
            ])),
            Script::Answer(text("Слушаю.")),
        ]);
        let notes = FakeNotes::with(&[("план.md", "было"), ("идеи.md", "мысль")]);
        let human = FakeHuman::with(vec![Some(Answer::Allow)], &stop);
        let chat = FakeChat::default();

        let run = send_asking(
            &model,
            &notes,
            &chat,
            (&human, Oversight::Ask),
            &keyed(),
            &stop,
            "Поправь обе",
        );

        assert_eq!(run.result, Ok(()));
        assert_eq!(human.asked().len(), 2);
        assert_eq!(notes.text("план.md").as_deref(), Some("стало"));
        assert_eq!(notes.text("идеи.md").as_deref(), Some("мысль"));
        // После «Стопа» модель больше не спрашивали.
        assert_eq!(model.bodies.lock().unwrap().len(), 1);
        assert_eq!(
            chat.messages().last().unwrap()["content"][1]["content"],
            STOPPED
        );

        undo(&chat, &notes, 0).unwrap();
        assert_eq!(notes.text("план.md").as_deref(), Some("было"));

        // История годится модели: следующее сообщение идёт как обычно.
        let next = send_with(&model, &notes, &chat, &keyed(), &stop, "Ещё раз");
        assert_eq!(next.result, Ok(()));
    }

    fn meeting_with(
        model: &FakeModel,
        notes: &FakeNotes,
        path: &str,
    ) -> Result<Vec<MeetingTask>, AppError> {
        block_on(meeting(
            model,
            notes,
            &keyed(),
            "claude-sonnet-5-5",
            path,
            "2026-10-31",
        ))
    }

    fn task(summary: &str, assignee: &str) -> Value {
        json!({
            "summary": summary,
            "description": "",
            "assignee": assignee,
            "due": "",
            "issues": [],
            "quote": "",
        })
    }

    #[test]
    fn задачи_из_встречи_без_повторов_и_с_записью_целиком() {
        let record = format!(
            "# Планёрка\n\n{}\nИлья пишет письмо.",
            "Обсуждение.\n".repeat(5_000)
        );
        let answer = json!({
            "tasks": [
                task("Написать письмо", "Илья"),
                task("Обновить план", ""),
                task("написать письмо ", "Илья"),
            ],
        });
        let model = FakeModel::with(vec![Script::Answer(text(&answer.to_string()))]);
        let notes = FakeNotes::with(&[("Встречи/планёрка.md", record.as_str())]);

        let tasks = meeting_with(&model, &notes, "Встречи/планёрка.md").unwrap();

        assert_eq!(
            tasks
                .iter()
                .map(|task| task.summary.as_str())
                .collect::<Vec<_>>(),
            ["Написать письмо", "Обновить план"],
        );

        let (key, body) = model.bodies.lock().unwrap()[0].clone();
        let asked = body["messages"][0]["content"][0]["text"].as_str().unwrap();

        assert_eq!(key, KEY);
        assert!(asked.starts_with("Сегодня 2026-10-31. Заметка «Встречи/планёрка.md»"));
        assert!(asked.contains(&record));
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn встреча_без_действий_закрытая_и_непонятный_ответ() {
        let notes = FakeNotes::with(&[
            ("Встречи/кофе.md", "Поболтали."),
            ("Личное/встреча.md", "Секрет."),
        ]);
        let model = FakeModel::with(vec![
            Script::Answer(text(r#"{"tasks":[]}"#)),
            Script::Answer(text("Действий нет.")),
        ]);

        assert_eq!(meeting_with(&model, &notes, "Встречи/кофе.md"), Ok(vec![]));
        assert_eq!(
            meeting_with(&model, &notes, "Встречи/кофе.md"),
            Err(AppError::invalid("agent_bad_answer")),
        );
        // Закрытая заметка не уходит модели: лишний запрос уронил бы фейк.
        assert_eq!(
            meeting_with(&model, &notes, "Личное/встреча.md"),
            Err(AppError::invalid("note_closed")),
        );
    }

    /// Claude Code в заданном состоянии, который отвечает одно и то же
    /// и помнит запросы: модель, системный промпт и сообщение.
    struct FakeClaude {
        state: ClaudeState,
        answer: Value,
        asked: Mutex<Vec<(String, String, String)>>,
    }

    impl FakeClaude {
        fn with(state: ClaudeState, answer: Value) -> Self {
            Self {
                state,
                answer,
                asked: Mutex::default(),
            }
        }

        fn asked(&self) -> Vec<(String, String, String)> {
            self.asked.lock().unwrap().clone()
        }
    }

    impl Claude for FakeClaude {
        async fn status(&self) -> ClaudeStatus {
            ClaudeStatus::of_state(self.state)
        }

        async fn structured(
            &self,
            model: &str,
            system: &str,
            _schema: &Value,
            message: &str,
        ) -> Result<Value, AppError> {
            self.asked
                .lock()
                .unwrap()
                .push((model.into(), system.into(), message.into()));

            Ok(self.answer.clone())
        }
    }

    fn via_claude(
        claude: &FakeClaude,
        notes: &FakeNotes,
        path: &str,
    ) -> Result<Vec<MeetingTask>, AppError> {
        block_on(meeting_via_claude(
            claude,
            notes,
            "claude-sonnet-5-5",
            path,
            "2026-10-31",
        ))
    }

    #[test]
    fn задачи_из_встречи_через_подписку() {
        let notes = FakeNotes::with(&[
            ("Встречи/планёрка.md", "Илья пишет письмо."),
            ("Личное/встреча.md", "Секрет."),
        ]);
        let claude = FakeClaude::with(
            ClaudeState::Ready,
            json!({ "tasks": [task("Написать письмо", "Илья")] }),
        );

        let tasks = via_claude(&claude, &notes, "Встречи/планёрка.md").unwrap();

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].assignee, "Илья");

        let (model, system, message) = claude.asked()[0].clone();

        assert_eq!(model, "claude-sonnet-5-5");
        assert_eq!(system, MEETING);
        assert!(message.starts_with("Сегодня 2026-10-31. Заметка «Встречи/планёрка.md»"));
        assert!(message.contains("Илья пишет письмо."));

        assert_eq!(
            via_claude(&claude, &notes, "Личное/встреча.md"),
            Err(AppError::invalid("note_closed")),
        );
        assert_eq!(claude.asked().len(), 1);
    }

    #[test]
    fn без_входа_по_подписке_запроса_нет() {
        let notes = FakeNotes::with(&[("Встречи/кофе.md", "Поболтали.")]);

        for (state, code) in [
            (ClaudeState::Missing, "claude_missing"),
            (ClaudeState::Outdated, "claude_outdated"),
            (ClaudeState::LoggedOut, "claude_logged_out"),
            (ClaudeState::NotSubscription, "claude_not_subscription"),
        ] {
            let claude = FakeClaude::with(state, json!({ "tasks": [] }));

            assert_eq!(
                via_claude(&claude, &notes, "Встречи/кофе.md").map_err(|error| error.code),
                Err(code),
            );
            assert!(claude.asked().is_empty());
        }
    }
}
