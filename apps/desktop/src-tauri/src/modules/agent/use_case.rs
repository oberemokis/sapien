use super::domain::{
    Assembler, Context, Entry, Event, MAX_STEPS, ModelError, Tool, parse_model, push_user,
    replace_once, request, search, transcript, user_blocks,
};
use super::ports::{ChatStore, Model, Notes, Tracker};
use crate::error::AppError;
use crate::secrets::{SecretName, Secrets};
use serde_json::{Value, json};
use tokio::sync::Notify;

pub fn history(chat: &impl ChatStore) -> Result<Vec<Entry>, AppError> {
    Ok(transcript(&chat.load()?))
}

pub fn clear(chat: &impl ChatStore) -> Result<(), AppError> {
    chat.clear()
}

/// Сообщение человека. Пустой текст продолжает историю, которая кончается
/// его вопросом: так «Повторить» шлёт его снова после ошибки.
pub struct Turn<'a> {
    pub model: &'a str,
    pub text: &'a str,
    pub context: Context,
}

/// Выполняет вызов инструмента. Ошибка уходит модели текстом, чтобы она
/// поправила вызов или сказала человеку, что не вышло.
async fn run(
    call: &Value,
    assembler: &Assembler,
    notes: &impl Notes,
    tracker: &impl Tracker,
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
        Tool::ListNotes {} => notes.paths().map(|paths| paths.join("\n")),
        Tool::SearchNotes { query } => notes.texts().map(|texts| search(&texts, &query)),
        Tool::ReadNote { path } => notes.read(&path),
        Tool::WriteNote { path, text } => notes.put(&path, &text).map(|()| "Записано.".to_owned()),
        Tool::EditNote {
            path,
            old_text,
            new_text,
        } => {
            let text = notes.read(&path).map_err(failed)?;
            let edited = replace_once(&text, &old_text, &new_text).map_err(str::to_owned)?;

            notes.put(&path, &edited).map(|()| "Заменено.".to_owned())
        }
        Tool::YoutrackSearch { query } => tracker.search(&query).await,
        Tool::YoutrackIssue { id } => tracker.issue(&id).await,
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
/// не сохраняется вовсе.
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
    stop: &Notify,
    turn: Turn<'_>,
    events: &mut (impl FnMut(Event) + Send),
) -> Result<(), AppError> {
    let model_id = parse_model(turn.model).ok_or(AppError::invalid("agent_model_unknown"))?;
    let key = secrets
        .get(SecretName::ModelKey)
        .ok_or(AppError::not_found("agent_key_missing"))?;
    let mut messages = chat.load()?;
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
        chat.save(&messages)?;
    }

    if messages.last().is_none_or(|last| last["role"] != "user") {
        return Ok(());
    }

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
            chat.save(&messages)?;
            return outcome.map(drop);
        }

        let mut results = vec![];

        for call in &calls {
            let result = run(call, &assembler, notes, tracker).await;
            let ok = result.is_ok();
            let content = result.unwrap_or_else(|error| error);

            events(Event::tool(call, ok));
            results.push(json!({
                "type": "tool_result",
                "tool_use_id": call["id"],
                "content": content,
                "is_error": !ok,
            }));
        }

        push_user(&mut messages, results);
        chat.save(&messages)?;
    }

    Err(AppError::invalid("agent_too_many_steps"))
}

#[cfg(test)]
mod tests {
    use super::*;
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
    }

    #[derive(Default)]
    struct FakeChat(Mutex<Vec<Value>>);

    impl FakeChat {
        fn messages(&self) -> Vec<Value> {
            self.0.lock().unwrap().clone()
        }
    }

    impl ChatStore for FakeChat {
        fn load(&self) -> Result<Vec<Value>, AppError> {
            Ok(self.messages())
        }

        fn save(&self, messages: &[Value]) -> Result<(), AppError> {
            *self.0.lock().unwrap() = messages.to_vec();
            Ok(())
        }

        fn clear(&self) -> Result<(), AppError> {
            self.0.lock().unwrap().clear();
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

    fn send_with(
        model: &FakeModel,
        notes: &FakeNotes,
        chat: &FakeChat,
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
        };
        let result = block_on(send(
            model,
            notes,
            &NoTracker,
            chat,
            secrets,
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
        let unknown = block_on(send(
            &model,
            &FakeNotes::default(),
            &NoTracker,
            &chat,
            &keyed(),
            &Notify::new(),
            Turn {
                model: "gpt-5",
                text: "Вопрос",
                context: Context::default(),
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
        let result = block_on(send(
            &model,
            &FakeNotes::default(),
            &NoTracker,
            &chat,
            &keyed(),
            &Notify::new(),
            Turn {
                model: "claude-sonnet-5-5",
                text: "Что тут?",
                context: Context {
                    path: Some("Личное/дневник.md".into()),
                    selection: Some("сокровенное".into()),
                },
            },
            &mut |_| {},
        ));

        assert_eq!(result, Ok(()));

        let sent = model.bodies.lock().unwrap()[0].1["messages"].to_string();

        assert!(!sent.contains("Личное"));
        assert!(!sent.contains("сокровенное"));
        assert!(sent.contains("Что тут?"));
    }
}
