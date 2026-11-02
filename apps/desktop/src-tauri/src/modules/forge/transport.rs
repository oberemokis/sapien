use super::domain::{Forge, ForgeStatus, ForgeStatuses};
use super::infrastructure::{AccountsFile, Http};
use super::use_case;
use crate::error::AppError;
use crate::secrets::Secrets;
use tauri::{AppHandle, Manager, Runtime, State};

fn accounts<R: Runtime>(app: &AppHandle<R>) -> Result<AccountsFile, AppError> {
    app.path()
        .app_data_dir()
        .map(|dir| AccountsFile::new(&dir))
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

/// Подключения, как их сохранили, без сети.
#[tauri::command]
pub fn forge_status(
    app: AppHandle,
    secrets: State<'_, Secrets>,
) -> Result<ForgeStatuses, AppError> {
    use_case::status(&accounts(&app)?, &secrets)
}

/// Токен приходит из окна один раз и обратно не возвращается.
#[tauri::command]
pub async fn forge_connect(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    forge: Forge,
    host: Option<String>,
    token: String,
) -> Result<ForgeStatus, AppError> {
    use_case::connect(
        &*http,
        &accounts(&app)?,
        &secrets,
        forge,
        host.as_deref(),
        &token,
    )
    .await
}

#[tauri::command]
pub fn forge_disconnect(
    app: AppHandle,
    secrets: State<'_, Secrets>,
    forge: Forge,
) -> Result<(), AppError> {
    use_case::disconnect(&accounts(&app)?, &secrets, forge)
}
