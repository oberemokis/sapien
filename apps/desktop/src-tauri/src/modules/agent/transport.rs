use super::domain::{Context, Entry, Event};
use super::infrastructure::anthropic::Anthropic;
use super::infrastructure::chat_file::ChatFile;
use super::infrastructure::neighbours::{VaultNotes, YoutrackIssues};
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

/// Идущий ответ агента. Он один на приложение: второй ответ поверх первого
/// перемешал бы историю. Через `Notify` его останавливает «Стоп».
#[derive(Default)]
pub struct Running(Mutex<Option<Arc<Notify>>>);

impl Running {
    fn slot(&self) -> std::sync::MutexGuard<'_, Option<Arc<Notify>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
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

    {
        let mut slot = running.slot();

        if slot.is_some() {
            return Err(AppError::conflict("agent_busy"));
        }

        *slot = Some(stop.clone());
    }

    let _busy = Busy(&running);
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

#[tauri::command]
pub fn agent_stop(running: State<'_, Running>) {
    if let Some(stop) = &*running.slot() {
        stop.notify_one();
    }
}
