use super::domain::{ClaudeState, ClaudeStatus, Context, Entry, Event, MeetingTask, Method};
use super::infrastructure::anthropic::Anthropic;
use super::infrastructure::chat_file::ChatFile;
use super::infrastructure::claude_code::ClaudeCode;
use super::infrastructure::neighbours::{VaultNotes, YoutrackIssues};
use super::ports::Claude;
use super::use_case::{self, Turn};
use crate::error::AppError;
use crate::modules::vault;
use crate::secrets::Secrets;
use std::sync::{Arc, Mutex, PoisonError};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::Notify;

fn chat<R: Runtime>(app: &AppHandle<R>) -> Result<ChatFile, AppError> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))?;
    let vault = vault::transport::vault_root(app).unwrap_or_default();

    Ok(ChatFile::new(&data, &vault))
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

/// Идущий ответ агента или откат. Он один на приложение: второй поверх
/// первого перемешал бы историю. Через `Notify` ответ останавливает «Стоп».
#[derive(Default)]
pub struct Running(Mutex<Option<Arc<Notify>>>);

impl Running {
    fn slot(&self) -> std::sync::MutexGuard<'_, Option<Arc<Notify>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Занимает место, пока жив `Busy`. Занято, значит, `agent_busy`.
    fn claim(&self, stop: Arc<Notify>) -> Result<Busy<'_>, AppError> {
        let mut slot = self.slot();

        if slot.is_some() {
            return Err(AppError::conflict("agent_busy"));
        }

        *slot = Some(stop);
        Ok(Busy(self))
    }
}

/// Освобождает место ответа, как бы он ни кончился.
struct Busy<'a>(&'a Running);

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        *self.0.slot() = None;
    }
}

#[tauri::command]
pub fn agent_history(app: AppHandle) -> Result<Vec<Entry>, AppError> {
    use_case::history(&chat(&app)?)
}

#[tauri::command]
pub fn agent_clear(app: AppHandle, running: State<'_, Running>) -> Result<(), AppError> {
    if running.slot().is_some() {
        return Err(AppError::conflict("agent_busy"));
    }

    use_case::clear(&chat(&app)?)
}

/// «Откатить» у ответа на сообщение `turn`, вместе с более поздними,
/// которые трогали те же заметки.
#[tauri::command]
pub fn agent_undo(
    app: AppHandle,
    running: State<'_, Running>,
    turn: usize,
) -> Result<(), AppError> {
    let _busy = running.claim(Arc::new(Notify::new()))?;

    use_case::undo(&chat(&app)?, &VaultNotes(app.clone()), turn)
}

/// Ключ берётся в Rust из системного хранилища паролей: окно его
/// не присылает и не получает. Ответ идёт в окно через канал по мере
/// появления, а команда кончается вместе с ответом.
#[tauri::command]
#[expect(clippy::too_many_arguments, reason = "вход команды и состояния Tauri")]
pub async fn agent_send(
    app: AppHandle,
    model_api: State<'_, Anthropic>,
    secrets: State<'_, Secrets>,
    running: State<'_, Running>,
    model: String,
    text: String,
    context: Context,
    on_event: Channel<Event>,
) -> Result<(), AppError> {
    let chat = chat(&app)?;
    let stop = Arc::new(Notify::new());
    let _busy = running.claim(stop.clone())?;
    let turn = Turn {
        model: &model,
        text: &text,
        context,
    };

    use_case::send(
        &*model_api,
        &VaultNotes(app.clone()),
        &YoutrackIssues(app.clone()),
        &chat,
        &secrets,
        &stop,
        turn,
        &mut |event| {
            // Окно закрыли посреди ответа: ответ всё равно дойдёт до истории.
            let _ = on_event.send(event);
        },
    )
    .await
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
    if let Some(stop) = &*running.slot() {
        stop.notify_one();
    }
}
