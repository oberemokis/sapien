use super::domain::Project;
use super::infrastructure::ProjectsFile;
use super::use_case;
use crate::modules::agent;
use sapien_kernel::{AppError, durable};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

fn shelf<R: Runtime>(app: &AppHandle<R>) -> Result<ProjectsFile, AppError> {
    app.path()
        .app_data_dir()
        .map(|dir| ProjectsFile::new(&dir))
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

#[tauri::command]
pub fn projects_list(app: AppHandle) -> Result<Vec<Project>, AppError> {
    use_case::list(&shelf(&app)?)
}

/// Системный выбор папки. Окно закрыли без выбора: `None`.
#[tauri::command]
pub async fn projects_add(app: AppHandle) -> Result<Option<Project>, AppError> {
    let shelf = shelf(&app)?;
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
        .ok_or(AppError::invalid("project_path_invalid"))?;

    use_case::add(&shelf, path, durable::fresh_id()).map(Some)
}

/// Убирает проект из списка вместе с его сессиями. Папка на диске
/// остаётся как есть.
#[tauri::command]
pub fn projects_remove(app: AppHandle, id: String) -> Result<(), AppError> {
    agent::transport::forget_project(&app, &id)?;
    use_case::remove(&shelf(&app)?, &id)
}

/// Дверь для агента: папка проекта `id`. Проекта нет в списке или папки
/// нет на диске: `None`.
pub fn folder<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<PathBuf> {
    use_case::folder(&shelf(app).ok()?, id)
}
