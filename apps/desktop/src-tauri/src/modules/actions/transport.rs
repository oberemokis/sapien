use super::domain::ActionFile;
use super::infrastructure::ActionsDir;
use super::use_case;
use crate::error::AppError;
use tauri::{AppHandle, Manager, Runtime};

fn folder<R: Runtime>(app: &AppHandle<R>) -> Result<ActionsDir, AppError> {
    app.path()
        .app_data_dir()
        .map(|dir| ActionsDir::new(&dir))
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

#[tauri::command]
pub fn actions_list(app: AppHandle) -> Result<Vec<ActionFile>, AppError> {
    use_case::list(&folder(&app)?)
}

/// Новое действие `name` без `.md`. Отдаёт имя его файла.
#[tauri::command]
pub fn actions_create(app: AppHandle, name: String, text: String) -> Result<String, AppError> {
    use_case::create(&folder(&app)?, &name, &text)
}

#[tauri::command]
pub fn actions_write(app: AppHandle, path: String, text: String) -> Result<(), AppError> {
    use_case::write(&folder(&app)?, &path, &text)
}

#[tauri::command]
pub fn actions_delete(app: AppHandle, path: String) -> Result<(), AppError> {
    use_case::delete(&folder(&app)?, &path)
}
