use super::domain::{
    Checked, Draft, FeedEvent, IssueDetail, IssueState, Person, Published, Similar, YoutrackStatus,
};
use super::infrastructure::host_file::HostFile;
use super::infrastructure::http::Http;
use super::infrastructure::sent_file::SentFile;
use super::use_case;
use crate::error::AppError;
use crate::modules::vault;
use crate::secrets::Secrets;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime, State};

fn place<R: Runtime>(app: &AppHandle<R>) -> Result<HostFile, AppError> {
    app.path()
        .app_config_dir()
        .map(|dir| HostFile::new(&dir))
        .map_err(|_| AppError::unavailable("config_dir_unavailable"))
}

fn ledger<R: Runtime>(app: &AppHandle<R>) -> Result<SentFile, AppError> {
    app.path()
        .app_data_dir()
        .map(|dir| SentFile::new(&dir))
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

/// Публикует черновик из заметки `path`: без `id` создаёт задачу, с ним
/// обновляет. Текст заметки перед этим уходит в её историю версий.
#[tauri::command]
#[expect(clippy::too_many_arguments, reason = "вход команды и состояния Tauri")]
pub async fn youtrack_publish(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    path: String,
    text: String,
    draft: Draft,
    id: Option<String>,
    force: bool,
) -> Result<Published, AppError> {
    vault::transport::keep_published(&app, &path, &text)?;

    use_case::publish(
        &*http,
        &place(&app)?,
        &secrets,
        &ledger(&app)?,
        &draft,
        id.as_deref(),
        force,
    )
    .await
}

#[tauri::command]
pub async fn youtrack_issue_state(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    id: String,
) -> Result<IssueState, AppError> {
    use_case::issue_state(&*http, &place(&app)?, &secrets, &id).await
}

#[tauri::command]
pub async fn youtrack_check(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    draft: Draft,
) -> Result<Checked, AppError> {
    use_case::check(&*http, &place(&app)?, &secrets, &draft).await
}

#[tauri::command]
pub async fn youtrack_similar(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    project: String,
    summary: String,
) -> Result<Vec<Similar>, AppError> {
    use_case::similar(&*http, &place(&app)?, &secrets, &project, &summary).await
}

#[tauri::command]
pub async fn youtrack_projects(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
) -> Result<Vec<String>, AppError> {
    use_case::projects(&*http, &place(&app)?, &secrets).await
}

#[tauri::command]
pub async fn youtrack_project_issues(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    project: String,
) -> Result<Vec<Similar>, AppError> {
    use_case::project_issues(&*http, &place(&app)?, &secrets, &project).await
}

#[tauri::command]
pub async fn youtrack_assignees(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    project: String,
) -> Result<Vec<Person>, AppError> {
    use_case::assignees(&*http, &place(&app)?, &secrets, &project).await
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

/// Изменения подзадач эпика с даты `since` для сводки агента, JSON.
pub async fn epic_changes<R: Runtime>(
    app: &AppHandle<R>,
    epic: &str,
    since: &str,
) -> Result<String, AppError> {
    let http = app.state::<Http>();
    let secrets = app.state::<Secrets>();
    let changes =
        use_case::epic_changes(&*http, &place(app)?, &secrets, epic, since, now_ms()).await?;

    Ok(serde_json::to_string(&changes).unwrap_or_default())
}

/// Сейчас в миллисекундах от начала эпохи, как время в YouTrack.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

/// События ленты по отслеживаемым задачам с момента `since`.
#[tauri::command]
pub async fn youtrack_feed(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    query: String,
    ids: Vec<String>,
    since: i64,
) -> Result<Vec<FeedEvent>, AppError> {
    use_case::feed(
        &*http,
        &place(&app)?,
        &secrets,
        &query,
        &ids,
        since,
        now_ms(),
    )
    .await
}

#[tauri::command]
pub async fn youtrack_issue_detail(
    app: AppHandle,
    http: State<'_, Http>,
    secrets: State<'_, Secrets>,
    id: String,
) -> Result<IssueDetail, AppError> {
    use_case::issue_detail(&*http, &place(&app)?, &secrets, &id).await
}
