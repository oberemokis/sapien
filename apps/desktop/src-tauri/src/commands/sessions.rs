use crate::workspace::Workspace;
use sapien_kernel::AppError;
use sapien_sessions::SessionInfo;
use tauri::State;

/// Сессии всех проектов, свежие первыми.
#[tauri::command]
#[specta::specta]
pub fn agent_sessions(workspace: State<'_, Workspace>) -> Result<Vec<SessionInfo>, AppError> {
    workspace.sessions()
}

#[tauri::command]
#[specta::specta]
pub fn agent_session_new(
    workspace: State<'_, Workspace>,
    project: String,
) -> Result<SessionInfo, AppError> {
    workspace.new_session(&project)
}

#[tauri::command]
#[specta::specta]
pub fn agent_session_delete(workspace: State<'_, Workspace>, id: String) -> Result<(), AppError> {
    workspace.delete_session(&id)
}

/// Человек назвал сессию `id` сам, пустое имя отдаёт её агенту.
#[tauri::command]
#[specta::specta]
pub fn agent_session_rename(
    workspace: State<'_, Workspace>,
    id: String,
    title: String,
) -> Result<(), AppError> {
    workspace.rename_session(&id, &title)
}
