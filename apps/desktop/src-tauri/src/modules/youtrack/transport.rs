use super::domain::YoutrackStatus;
use super::infrastructure::host_file::HostFile;
use super::infrastructure::http::Http;
use super::use_case;
use crate::error::AppError;
use crate::secrets::Secrets;
use tauri::{AppHandle, Manager, Runtime, State};

fn place<R: Runtime>(app: &AppHandle<R>) -> Result<HostFile, AppError> {
    app.path()
        .app_config_dir()
        .map(|dir| HostFile::new(&dir))
        .map_err(|_| AppError::unavailable("config_dir_unavailable"))
}

#[tauri::command]
pub async fn youtrack_status(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
) -> Result<YoutrackStatus, AppError> {
    Ok(use_case::status(&*http, &place(&app)?, &secrets).await)
}

/// Токен приходит из окна один раз и обратно не возвращается.
#[tauri::command]
pub async fn youtrack_connect(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    host: String,
    token: String,
) -> Result<YoutrackStatus, AppError> {
    use_case::connect(&*http, &place(&app)?, &secrets, &host, &token).await
}

#[tauri::command]
pub fn youtrack_disconnect(app: AppHandle, secrets: State<'_, Secrets>) -> Result<(), AppError> {
    use_case::disconnect(&place(&app)?, &secrets)
}

// Задачи для агента, только чтение: создаёт и меняет задачи человек
// через черновик и публикацию.

pub async fn search_issues<R: Runtime>(
    app: &AppHandle<R>,
    query: &str,
) -> Result<String, AppError> {
    let http = app.state::<Http>();
    let secrets = app.state::<Secrets>();

    use_case::search_issues(&*http, &place(app)?, &secrets, query).await
}

pub async fn issue<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<String, AppError> {
    let http = app.state::<Http>();
    let secrets = app.state::<Secrets>();

    use_case::issue(&*http, &place(app)?, &secrets, id).await
}
