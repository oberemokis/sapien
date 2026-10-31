use super::domain::{Entry, EntryKind};
use super::infrastructure::config_file::ConfigFile;
use super::infrastructure::disk::Disk;
use super::infrastructure::watcher::Watch;
use super::ports::VaultPlace;
use super::use_case::{self, VaultStatus};
use crate::error::AppError;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

fn place<R: Runtime>(app: &AppHandle<R>) -> Result<ConfigFile, AppError> {
    app.path()
        .app_config_dir()
        .map(|dir| ConfigFile::new(&dir))
        .map_err(|_| AppError::unavailable("config_dir_unavailable"))
}

/// Слежение идёт за той папкой, что сейчас на месте. Вернули пропавшую
/// папку, и следующий запрос статуса снова за ней следит.
fn follow<R: Runtime>(app: &AppHandle<R>, watch: &Watch, place: &ConfigFile) {
    let root = place.load().filter(|path| path.is_dir());

    watch.follow(app, root.as_deref());
}

pub fn start<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(place) = place(app) {
        follow(app, &app.state::<Watch>(), &place);
    }
}

#[tauri::command]
pub fn vault_status(app: AppHandle, watch: State<'_, Watch>) -> Result<VaultStatus, AppError> {
    let place = place(&app)?;

    follow(&app, &watch, &place);

    Ok(use_case::status(&place, &Disk))
}

#[tauri::command]
pub fn vault_tree(app: AppHandle) -> Result<Vec<Entry>, AppError> {
    use_case::tree(&place(&app)?, &Disk)
}

/// Путь папки и имя приходят из окна: их проверяет сценарий, а не команда.
#[tauri::command]
pub fn vault_create(
    app: AppHandle,
    parent: String,
    name: String,
    kind: EntryKind,
) -> Result<String, AppError> {
    use_case::create(&place(&app)?, &Disk, &parent, &name, kind)
}

/// Асинхронная, потому что диалог ждёт человека: синхронная команда держала
/// бы главный поток, и окно бы замерло.
#[tauri::command]
pub async fn vault_choose(
    app: AppHandle,
    watch: State<'_, Watch>,
) -> Result<VaultStatus, AppError> {
    let place = place(&app)?;
    let picked = app
        .dialog()
        .file()
        .set_can_create_directories(true)
        .blocking_pick_folder();

    // Диалог закрыли без выбора: всё остаётся как было.
    let Some(picked) = picked else {
        return Ok(use_case::status(&place, &Disk));
    };
    let picked = picked
        .into_path()
        .map_err(|_| AppError::unavailable("vault_path_invalid"))?;
    let status = use_case::choose(&place, &Disk, &picked)?;

    follow(&app, &watch, &place);

    Ok(status)
}
