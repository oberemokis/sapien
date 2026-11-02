use super::domain::{ClaudeState, ClaudeStatus, SessionInfo, Usage};
use super::infrastructure::claude_code::ClaudeCode;
use super::infrastructure::neighbours::ProjectFolders;
use super::infrastructure::sessions_dir::SessionsDir;
use super::use_case;
use crate::durable;
use crate::error::AppError;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

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

/// Claude Code устройства. Проверки он проходит в папке данных
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

/// Отвечает ли агент в сессии. Claude Code из sapien сейчас
/// не запускается, поэтому нет.
fn running(_session: &str) -> bool {
    false
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

#[tauri::command]
pub fn agent_session_delete(app: AppHandle, id: String) -> Result<(), AppError> {
    use_case::delete_session(&sessions(&app)?, running, &id)
}

/// Дверь для модуля projects: стирает сессии проекта, который убирают
/// из списка. Хоть в одной из них отвечает агент, значит, `agent_busy`,
/// и не стирается ни одна.
pub fn forget_project<R: Runtime>(app: &AppHandle<R>, project: &str) -> Result<(), AppError> {
    use_case::forget_project(&sessions(app)?, running, project)
}

/// Лимиты подписки Claude за пять часов и за неделю. Их спрашивает
/// Claude Code своим входом, токен sapien не видит.
#[tauri::command]
pub async fn agent_usage(app: AppHandle) -> Result<Usage, AppError> {
    if !CLAUDE_SUPPORTED {
        return Err(AppError::invalid("claude_unsupported"));
    }

    claude(&app)?.usage().await
}

/// Есть ли Claude Code, какой версии и как выполнен вход.
#[tauri::command]
pub async fn agent_claude_status(app: AppHandle) -> Result<ClaudeStatus, AppError> {
    if !CLAUDE_SUPPORTED {
        return Ok(ClaudeStatus::of_state(ClaudeState::Unsupported));
    }

    Ok(claude(&app)?.status().await)
}
