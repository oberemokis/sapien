use super::domain::{
    ANSWER_WAIT, Answer, ClaudeState, ClaudeStatus, Entry, Event, Oversight, Question, SessionInfo,
};
use super::infrastructure::claude_code::ClaudeCode;
use super::infrastructure::neighbours::ProjectFolders;
use super::infrastructure::sessions_dir::SessionsDir;
use super::ports::{Claude, Human};
use super::use_case::{self, Turn};
use crate::durable;
use crate::error::AppError;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::{Notify, oneshot, watch};
use tokio::time::timeout;

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

fn sessions<R: Runtime>(app: &AppHandle<R>) -> Result<SessionsDir, AppError> {
    Ok(SessionsDir::new(&data_dir(app)?))
}

/// Подписка Claude через Claude Code пока только на macOS.
const CLAUDE_SUPPORTED: bool = cfg!(target_os = "macos");

/// Claude Code устройства. Сокет его сервера MCP лежит в папке данных
/// приложения, поэтому она должна быть.
fn claude<R: Runtime>(app: &AppHandle<R>) -> Result<ClaudeCode, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))?;
    let data = data_dir(app)?;

    std::fs::create_dir_all(&data).map_err(|_| AppError::unavailable("data_dir_unavailable"))?;

    Ok(ClaudeCode::new(&home, &data))
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

/// Идущий ответ агента в сессии `session`: «Стоп», окно, куда идут
/// события, и открытый вопрос. Окно, открытое заново, подключается к нему.
struct Live {
    session: String,
    stop: Notify,
    sink: Mutex<Sink>,
    open: Mutex<Option<Open>>,
    ended: watch::Sender<bool>,
}

impl Live {
    fn new(session: String, sink: Sink) -> Self {
        Self {
            session,
            stop: Notify::new(),
            sink: Mutex::new(sink),
            open: Mutex::default(),
            ended: watch::channel(false).0,
        }
    }

    fn emit(&self, event: Event) {
        (lock(&self.sink))(event);
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

/// Идущий ответ агента. Он один на приложение: Claude Code по подписке
/// отвечает по одному, а «Стоп» и вопрос в окне относятся к одному ответу.
#[derive(Default)]
pub struct Running(Mutex<Option<Arc<Live>>>);

/// Сессия, по которой идёт ответ.
fn running_session(slot: &Option<Arc<Live>>) -> Option<&str> {
    slot.as_ref().map(|live| live.session.as_str())
}

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

        *lock(&live.sink) = sink;
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

/// Сессии всех проектов, свежие первыми.
#[tauri::command]
pub fn agent_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, AppError> {
    use_case::sessions(&sessions(&app)?)
}

#[tauri::command]
pub fn agent_session_new(app: AppHandle, project: String) -> Result<SessionInfo, AppError> {
    use_case::new_session(
        &sessions(&app)?,
        &ProjectFolders(app.clone()),
        &project,
        durable::fresh_id(),
        durable::now(),
    )
}

/// Пока сессия стирается, место ответа держится: ответ по ней не начнётся
/// посреди удаления и не запишет её заново.
#[tauri::command]
pub fn agent_session_delete(
    app: AppHandle,
    running: State<'_, Running>,
    id: String,
) -> Result<(), AppError> {
    let slot = running.slot();

    use_case::delete_session(&sessions(&app)?, running_session(&slot), &id)
}

/// Дверь для модуля projects: стирает сессии проекта, который убирают
/// из списка. По одной из них идёт ответ, значит, `agent_busy`, и не
/// стирается ни одна.
pub fn forget_project<R: Runtime>(app: &AppHandle<R>, project: &str) -> Result<(), AppError> {
    let running = app.state::<Running>();
    let slot = running.slot();

    use_case::forget_project(&sessions(app)?, running_session(&slot), project)
}

#[tauri::command]
pub fn agent_history(app: AppHandle, session: String) -> Result<Vec<Entry>, AppError> {
    use_case::history(&sessions(&app)?, &session)
}

/// Ответ агента в сессии `session`. Подписку держит Claude Code: окно
/// не присылает и не получает ни ключей, ни токенов. Ответ идёт в окно
/// через канал по мере появления, а команда кончается вместе с ответом.
#[tauri::command]
pub async fn agent_send(
    app: AppHandle,
    running: State<'_, Running>,
    session: String,
    model: String,
    text: String,
    oversight: Oversight,
    on_event: Channel<Event>,
) -> Result<(), AppError> {
    if !CLAUDE_SUPPORTED {
        return Err(AppError::invalid("claude_unsupported"));
    }

    let live = Arc::new(Live::new(session.clone(), sink(on_event)));
    // Место занимается до чтения сессии: удаление сессии или проекта,
    // которое уже идёт, ответ дожидается, и удалённая сессия остаётся
    // удалённой.
    let _busy = running.claim(live.clone())?;
    let mut events = |event| live.emit(event);
    let turn = Turn {
        session: &session,
        model: &model,
        text: &text,
        oversight,
        now: durable::now(),
    };

    use_case::send(
        &claude(&app)?,
        &ProjectFolders(app.clone()),
        &sessions(&app)?,
        &*live,
        &live.stop,
        turn,
        &mut events,
    )
    .await
}

/// Сессия, по которой сейчас идёт ответ. Ответа нет, значит, `None`.
#[tauri::command]
pub fn agent_running(running: State<'_, Running>) -> Option<String> {
    running_session(&running.slot()).map(str::to_owned)
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

/// Ответ человека на вопрос агента или на просьбу разрешить вызов.
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
        let live = Arc::new(Live::new("s1".into(), first));
        let busy = running.claim(live.clone()).unwrap();
        let question = Question::Permission {
            id: "toolu_1".into(),
            tool: "Bash".into(),
            target: "cargo test".into(),
        };

        assert_eq!(running_session(&running.slot()), Some("s1"));
        assert_eq!(
            running
                .claim(Arc::new(Live::new("s2".into(), window().1)))
                .err(),
            Some(AppError::conflict("agent_busy"))
        );

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
        assert_eq!(running_session(&running.slot()), None);
    }
}
