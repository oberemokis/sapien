use super::domain::{
    ANSWER_WAIT, Answer, ClaudeState, ClaudeStatus, Context, Entry, Event, MeetingTask, Method,
    Oversight, Question,
};
use super::infrastructure::anthropic::Anthropic;
use super::infrastructure::chat_file::ChatFile;
use super::infrastructure::claude_code::ClaudeCode;
use super::infrastructure::neighbours::{VaultNotes, YoutrackIssues};
use super::ports::{Claude, Human};
use super::use_case::{self, Turn};
use crate::error::AppError;
use crate::modules::vault;
use crate::secrets::Secrets;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::{Notify, oneshot, watch};
use tokio::time::timeout;

/// История чата способа `method`: у подписки и ключа API она своя.
fn chat<R: Runtime>(app: &AppHandle<R>, method: Method) -> Result<ChatFile, AppError> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))?;
    let vault = vault::transport::vault_root(app).unwrap_or_default();

    Ok(match method {
        Method::Key => ChatFile::new(&data, &vault),
        Method::Subscription => ChatFile::claude(&data, &vault),
    })
}

/// Подписка Claude через Claude Code пока только на macOS.
const CLAUDE_SUPPORTED: bool = cfg!(target_os = "macos");

/// Claude Code устройства. Рабочая папка у него своя и пустая.
fn claude<R: Runtime>(app: &AppHandle<R>) -> Result<ClaudeCode, AppError> {
    let unavailable = |_| AppError::unavailable("data_dir_unavailable");
    let home = app.path().home_dir().map_err(unavailable)?;
    let work = app
        .path()
        .app_data_dir()
        .map_err(unavailable)?
        .join("claude");

    std::fs::create_dir_all(&work).map_err(|_| AppError::unavailable("data_dir_unavailable"))?;

    Ok(ClaudeCode::new(&home, &work))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Куда идут события ответа: канал окна.
type Sink = Box<dyn Fn(Event) + Send + Sync>;

fn sink(channel: Channel<Event>) -> Sink {
    // Окно закрыли посреди ответа: ответ всё равно дойдёт до истории.
    Box::new(move |event| {
        let _ = channel.send(event);
    })
}

/// Вопрос, который ждёт человека, и куда отдать ответ.
struct Open {
    question: Question,
    reply: oneshot::Sender<Answer>,
}

/// Идущий ответ агента или откат: «Стоп», окно, куда идут события,
/// и открытый вопрос. Окно, открытое заново, подключается к нему.
struct Live {
    stop: Notify,
    sink: Mutex<Option<Sink>>,
    open: Mutex<Option<Open>>,
    ended: watch::Sender<bool>,
}

impl Live {
    fn new(sink: Option<Sink>) -> Self {
        Self {
            stop: Notify::new(),
            sink: Mutex::new(sink),
            open: Mutex::default(),
            ended: watch::channel(false).0,
        }
    }

    fn emit(&self, event: Event) {
        if let Some(sink) = &*lock(&self.sink) {
            sink(event);
        }
    }
}

/// Снимает вопрос, как бы ни кончилось ожидание, в том числе «Стопом».
struct Closed<'a>(&'a Mutex<Option<Open>>);

impl Drop for Closed<'_> {
    fn drop(&mut self) {
        *lock(self.0) = None;
    }
}

impl Human for Live {
    async fn ask(&self, question: &Question) -> Option<Answer> {
        let (reply, answer) = oneshot::channel();

        *lock(&self.open) = Some(Open {
            question: question.clone(),
            reply,
        });

        let _closed = Closed(&self.open);

        timeout(ANSWER_WAIT, answer).await.ok()?.ok()
    }
}

/// Идущий ответ агента или откат. Он один на приложение: второй поверх
/// первого перемешал бы историю.
#[derive(Default)]
pub struct Running(Mutex<Option<Arc<Live>>>);

impl Running {
    fn slot(&self) -> MutexGuard<'_, Option<Arc<Live>>> {
        lock(&self.0)
    }

    /// Занимает место, пока жив `Busy`. Занято, значит, `agent_busy`.
    fn claim(&self, live: Arc<Live>) -> Result<Busy<'_>, AppError> {
        let mut slot = self.slot();

        if slot.is_some() {
            return Err(AppError::conflict("agent_busy"));
        }

        *slot = Some(live);
        Ok(Busy(self))
    }

    /// Окно открылось заново: события идущего ответа теперь идут в `sink`,
    /// открытый вопрос показывается снова. Ответа нет, значит, `None`,
    /// а иначе то, чем дождаться его конца.
    fn attach(&self, sink: Sink) -> Option<watch::Receiver<bool>> {
        let slot = self.slot();
        let live = slot.as_ref()?;

        if let Some(open) = &*lock(&live.open) {
            sink(Event::Asked {
                question: open.question.clone(),
            });
        }

        *lock(&live.sink) = Some(sink);
        Some(live.ended.subscribe())
    }

    /// Ответ человека на открытый вопрос `id`. Вопрос уже закрыт ответом,
    /// сроком или «Стопом», значит, `agent_question_closed`.
    fn answer(&self, id: &str, answer: Answer) -> Result<(), AppError> {
        let open = self
            .slot()
            .as_ref()
            .and_then(|live| lock(&live.open).take_if(|open| open.question.id() == id))
            .ok_or(AppError::conflict("agent_question_closed"))?;

        // Ожидание кончилось в тот же миг: ответ уже никто не ждёт.
        let _ = open.reply.send(answer);
        Ok(())
    }
}

/// Освобождает место ответа, как бы он ни кончился, и отпускает окна,
/// которые ждут его конца.
struct Busy<'a>(&'a Running);

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        if let Some(live) = self.0.slot().take() {
            live.ended.send_replace(true);
        }
    }
}

#[tauri::command]
pub fn agent_history(app: AppHandle, method: Method) -> Result<Vec<Entry>, AppError> {
    use_case::history(&chat(&app, method)?)
}

/// «Очистить»: у подписки это и новая сессия Claude Code.
#[tauri::command]
pub fn agent_clear(
    app: AppHandle,
    running: State<'_, Running>,
    method: Method,
) -> Result<(), AppError> {
    if running.slot().is_some() {
        return Err(AppError::conflict("agent_busy"));
    }

    use_case::clear(&chat(&app, method)?)
}

/// «Откатить» у ответа на сообщение `turn`, вместе с более поздними,
/// которые трогали те же заметки.
#[tauri::command]
pub fn agent_undo(
    app: AppHandle,
    running: State<'_, Running>,
    pinned: State<'_, vault::Pinned>,
    method: Method,
    turn: usize,
) -> Result<(), AppError> {
    let _busy = running.claim(Arc::new(Live::new(None)))?;
    let _pin = pinned.pin();

    use_case::undo(&chat(&app, method)?, &VaultNotes(app.clone()), turn)
}

/// Ответ агента способом `method`. Ключ берётся в Rust из системного
/// хранилища паролей, а подписку держит Claude Code: окно не присылает
/// и не получает ни того, ни другого. Ответ идёт в окно через канал
/// по мере появления, а команда кончается вместе с ответом. Пока он идёт,
/// хранилище не меняется.
#[tauri::command]
#[expect(clippy::too_many_arguments, reason = "вход команды и состояния Tauri")]
pub async fn agent_send(
    app: AppHandle,
    model_api: State<'_, Anthropic>,
    secrets: State<'_, Secrets>,
    running: State<'_, Running>,
    pinned: State<'_, vault::Pinned>,
    method: Method,
    model: String,
    text: String,
    context: Context,
    oversight: Oversight,
    on_event: Channel<Event>,
) -> Result<(), AppError> {
    if method == Method::Subscription && !CLAUDE_SUPPORTED {
        return Err(AppError::invalid("claude_unsupported"));
    }

    let chat = chat(&app, method)?;
    let live = Arc::new(Live::new(Some(sink(on_event))));
    let _busy = running.claim(live.clone())?;
    let _pin = pinned.pin();
    let notes = VaultNotes(app.clone());
    let tracker = YoutrackIssues(app.clone());
    let mut events = |event| live.emit(event);
    let turn = Turn {
        model: &model,
        text: &text,
        context,
        oversight,
    };

    match method {
        Method::Key => {
            use_case::send(
                &*model_api,
                &notes,
                &tracker,
                &chat,
                &secrets,
                &*live,
                &live.stop,
                turn,
                &mut events,
            )
            .await
        }
        Method::Subscription => {
            use_case::send_via_claude(
                &claude(&app)?,
                &notes,
                &tracker,
                &chat,
                &*live,
                &live.stop,
                turn,
                &mut events,
            )
            .await
        }
    }
}

/// Сессия Claude Code чата, чтобы продолжить разговор в терминале
/// командой `claude --resume`. Разговора ещё не было, значит, `None`.
#[tauri::command]
pub fn agent_claude_session(app: AppHandle) -> Result<Option<String>, AppError> {
    use_case::session(&chat(&app, Method::Subscription)?)
}

/// Окно открылось заново, например после перезагрузки: события идущего
/// ответа идут в новый канал, открытый вопрос виден снова. Кончается вместе
/// с ответом. `true`, если ответ шёл и окну пора перечитать историю.
#[tauri::command]
pub async fn agent_attach(
    running: State<'_, Running>,
    on_event: Channel<Event>,
) -> Result<bool, AppError> {
    let Some(mut ended) = running.attach(sink(on_event)) else {
        return Ok(false);
    };

    // Ошибка значит, что ответ уже кончился и место освободили.
    let _ = ended.wait_for(|ended| *ended).await;
    Ok(true)
}

/// Ответ человека на вопрос агента или на просьбу разрешить правку.
#[tauri::command]
pub fn agent_answer(
    running: State<'_, Running>,
    id: String,
    answer: Answer,
) -> Result<(), AppError> {
    running.answer(&id, answer)
}

/// Есть ли Claude Code, какой версии и как выполнен вход.
#[tauri::command]
pub async fn agent_claude_status(app: AppHandle) -> Result<ClaudeStatus, AppError> {
    if !CLAUDE_SUPPORTED {
        return Ok(ClaudeStatus::of_state(ClaudeState::Unsupported));
    }

    Ok(claude(&app)?.status().await)
}

/// «Задачи из встречи» по заметке `path` способом `method`. Ключ берётся
/// в Rust, как у чата, а чат при этом свободен: ответ не идёт в его историю.
#[tauri::command]
pub async fn agent_meeting_tasks(
    app: AppHandle,
    model_api: State<'_, Anthropic>,
    secrets: State<'_, Secrets>,
    method: Method,
    model: String,
    path: String,
    today: String,
) -> Result<Vec<MeetingTask>, AppError> {
    if method == Method::Key {
        return use_case::meeting(
            &*model_api,
            &VaultNotes(app),
            &secrets,
            &model,
            &path,
            &today,
        )
        .await;
    }

    if !CLAUDE_SUPPORTED {
        return Err(AppError::invalid("claude_unsupported"));
    }

    let claude = claude(&app)?;

    use_case::meeting_via_claude(&claude, &VaultNotes(app), &model, &path, &today).await
}

#[tauri::command]
pub fn agent_stop(running: State<'_, Running>) {
    if let Some(live) = &*running.slot() {
        live.stop.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::pin::pin;
    use std::task::Poll;
    use tauri::async_runtime::block_on;

    /// Окно, которое запоминает, что ему пришло.
    fn window() -> (Arc<Mutex<Vec<Event>>>, Sink) {
        let seen = Arc::new(Mutex::new(vec![]));
        let into = seen.clone();

        (seen, Box::new(move |event| lock(&into).push(event)))
    }

    fn text(text: &str) -> Event {
        Event::Text { text: text.into() }
    }

    #[test]
    fn окно_открытое_заново_видит_вопрос_ответ_и_конец_ответа() {
        let running = Running::default();
        let (old, first) = window();
        let live = Arc::new(Live::new(Some(first)));
        let busy = running.claim(live.clone()).unwrap();
        let question = Question::Permission {
            id: "toolu_1".into(),
            tool: "edit_note".into(),
            path: "план.md".into(),
        };

        let (answer, new, mut ended) = block_on(async {
            let mut asked = pin!(live.ask(&question));

            // Вопрос открылся: агент ждёт ответа.
            std::future::poll_fn(|context| {
                assert!(asked.as_mut().poll(context).is_pending());
                Poll::Ready(())
            })
            .await;

            let (new, second) = window();
            let ended = running.attach(second).unwrap();

            assert_eq!(
                running.answer("toolu_2", Answer::Allow),
                Err(AppError::conflict("agent_question_closed"))
            );
            running.answer("toolu_1", Answer::Allow).unwrap();

            (asked.await, new, ended)
        });

        assert_eq!(answer, Some(Answer::Allow));
        assert_eq!(
            running.answer("toolu_1", Answer::Deny),
            Err(AppError::conflict("agent_question_closed"))
        );

        live.emit(text("дальше"));
        assert!(lock(&old).is_empty());
        assert_eq!(*lock(&new), [Event::Asked { question }, text("дальше")]);

        drop(busy);
        assert!(*ended.borrow_and_update());
        assert!(running.attach(window().1).is_none());
    }
}
