use sapien_agents::{ClaudeCode, ClaudeStatus, Integration, Integrations, hooks};
use sapien_kernel::AppError;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

fn unavailable<T>(_: T) -> AppError {
    AppError::unavailable("data_dir_unavailable")
}

fn home<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    app.path().home_dir().map_err(unavailable)
}

/// Интеграции агентов в их настройках.
#[tauri::command]
#[specta::specta]
pub fn agent_integrations(app: AppHandle) -> Result<Vec<Integration>, AppError> {
    Ok(Integrations::new(&home(&app)?).list())
}

#[tauri::command]
#[specta::specta]
pub fn agent_integration_install(app: AppHandle, agent: String) -> Result<(), AppError> {
    Integrations::new(&home(&app)?).install(&agent)
}

#[tauri::command]
#[specta::specta]
pub fn agent_integration_remove(app: AppHandle, agent: String) -> Result<(), AppError> {
    Integrations::new(&home(&app)?).remove(&agent)
}

/// Есть ли Claude Code, какой версии и как выполнен вход. Проверки он
/// проходит в папке данных приложения, поэтому она должна быть.
#[tauri::command]
#[specta::specta]
pub async fn agent_claude_status(app: AppHandle) -> Result<ClaudeStatus, AppError> {
    let data = app.path().app_data_dir().map_err(unavailable)?;

    std::fs::create_dir_all(&data).map_err(unavailable)?;

    Ok(ClaudeCode::new(&home(&app)?, &data).status().await)
}

/// Подкоманда `sapien hook <агент>`: хук агента в панели сообщает
/// приложению её разговор.
pub fn hook(agent: &str) {
    hooks::forward(
        agent,
        std::io::stdin(),
        std::env::var_os("SAPIEN_SOCKET"),
        std::env::var("SAPIEN_PANE").ok(),
        std::env::var("CODEX_THREAD_ID").ok(),
    );
}
