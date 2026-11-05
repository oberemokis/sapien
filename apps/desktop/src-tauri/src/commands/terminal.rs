// Команды терминала асинхронные: синхронная команда идёт в главном потоке,
// а через него же канал отдаёт вывод окну.

use crate::workspace::{ChannelSink, Workspace};
use sapien_kernel::AppError;
use tauri::State;
use tauri::ipc::Channel;

/// Терминал панели `pane` сессии `session` размером `cols` на `rows`.
/// Вывод идёт в `on_data`, первым сообщением уже написанное.
#[tauri::command]
pub async fn terminal_open(
    workspace: State<'_, Workspace>,
    session: String,
    pane: String,
    cols: u16,
    rows: u16,
    on_data: Channel,
) -> Result<(), AppError> {
    workspace.open(
        &session,
        &pane,
        Box::new(ChannelSink(on_data)),
        (cols, rows),
    )
}

/// Оболочка панели запускается без вкладки, идущую не трогает.
#[tauri::command]
pub async fn terminal_start(
    workspace: State<'_, Workspace>,
    session: String,
    pane: String,
) -> Result<(), AppError> {
    workspace.start(&session, &pane)
}

#[tauri::command]
pub async fn terminal_write(
    workspace: State<'_, Workspace>,
    pane: String,
    data: String,
) -> Result<(), AppError> {
    workspace.write(&pane, &data)
}

#[tauri::command]
pub async fn terminal_resize(
    workspace: State<'_, Workspace>,
    pane: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    workspace.resize(&pane, cols, rows);
    Ok(())
}

#[tauri::command]
pub async fn terminal_close(workspace: State<'_, Workspace>, pane: String) -> Result<(), AppError> {
    workspace.close(&pane);
    Ok(())
}
