use sapien_forge::{AccountsFile, Forge, ForgeStatus, ForgeStatuses, Http, Secrets};
use sapien_kernel::AppError;
use tauri::State;

/// Подключения, как их сохранили, без сети.
#[tauri::command]
#[specta::specta]
pub fn forge_status(
    accounts: State<'_, AccountsFile>,
    secrets: State<'_, Secrets>,
) -> Result<ForgeStatuses, AppError> {
    sapien_forge::status(&*accounts, &secrets)
}

/// Токен приходит из окна один раз и обратно не возвращается.
#[tauri::command]
#[specta::specta]
pub async fn forge_connect(
    http: State<'_, Http>,
    accounts: State<'_, AccountsFile>,
    secrets: State<'_, Secrets>,
    forge: Forge,
    host: Option<String>,
    token: String,
) -> Result<ForgeStatus, AppError> {
    sapien_forge::connect(&*http, &*accounts, &secrets, forge, host.as_deref(), &token).await
}

#[tauri::command]
#[specta::specta]
pub fn forge_disconnect(
    accounts: State<'_, AccountsFile>,
    secrets: State<'_, Secrets>,
    forge: Forge,
) -> Result<(), AppError> {
    sapien_forge::disconnect(&*accounts, &secrets, forge)
}
