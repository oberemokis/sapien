use crate::workspace::Workspace;
use sapien_kernel::{AppError, durable};
use sapien_projects::{Project, ProjectsFile};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
#[specta::specta]
pub fn projects_list(shelf: State<'_, ProjectsFile>) -> Result<Vec<Project>, AppError> {
    sapien_projects::list(&*shelf)
}

/// Системный выбор папки. Окно закрыли без выбора: `None`.
#[tauri::command]
#[specta::specta]
pub async fn projects_add(
    app: AppHandle,
    shelf: State<'_, ProjectsFile>,
) -> Result<Option<Project>, AppError> {
    let picked = app
        .dialog()
        .file()
        .set_can_create_directories(true)
        .blocking_pick_folder();

    let Some(picked) = picked else {
        return Ok(None);
    };
    // Путь не в UTF-8 не сравнить с прежними и не показать окну.
    let path = picked
        .into_path()
        .ok()
        .and_then(|path| path.into_os_string().into_string().ok())
        .ok_or(AppError::invalid(
            sapien_projects::ProjectsCode::PathInvalid,
        ))?;

    sapien_projects::add(&*shelf, path, durable::fresh_id()).map(Some)
}

/// Убирает проект из списка вместе с его сессиями: сначала сессии, потом
/// сам проект. Папка на диске остаётся как есть.
#[tauri::command]
#[specta::specta]
pub fn projects_remove(
    workspace: State<'_, Workspace>,
    shelf: State<'_, ProjectsFile>,
    id: String,
) -> Result<(), AppError> {
    workspace.forget_project(&id)?;
    sapien_projects::remove(&*shelf, &id)
}
