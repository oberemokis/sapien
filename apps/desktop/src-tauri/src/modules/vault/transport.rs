use super::domain::{Entry, EntryKind, Unsaved};
use super::infrastructure::config_file::ConfigFile;
use super::infrastructure::disk::Disk;
use super::infrastructure::journal_dir::JournalDir;
use super::infrastructure::watcher::Watch;
use super::ports::VaultPlace;
use super::use_case::{self, NoteText, VaultStatus};
use crate::error::AppError;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

fn place<R: Runtime>(app: &AppHandle<R>) -> Result<ConfigFile, AppError> {
    app.path()
        .app_config_dir()
        .map(|dir| ConfigFile::new(&dir))
        .map_err(|_| AppError::unavailable("config_dir_unavailable"))
}

fn journal<R: Runtime>(app: &AppHandle<R>) -> Result<JournalDir, AppError> {
    app.path()
        .app_data_dir()
        .map(|dir| JournalDir::new(&dir))
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
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

#[tauri::command]
pub fn vault_read(app: AppHandle, path: String) -> Result<String, AppError> {
    use_case::read(&place(&app)?, &Disk, &path)
}

/// `base` это текст файла, от которого шла правка. Без него правка пишется
/// поверх того, что сейчас на диске: так человек выбирает свою версию
/// в споре с правкой снаружи.
#[tauri::command]
pub fn vault_write(
    app: AppHandle,
    path: String,
    text: String,
    base: Option<String>,
) -> Result<(), AppError> {
    let unsaved = Unsaved { path, base, text };

    use_case::write(&place(&app)?, &Disk, &journal(&app)?, &unsaved)
}

#[tauri::command]
pub fn vault_unsaved(app: AppHandle) -> Result<Vec<Unsaved>, AppError> {
    use_case::unsaved(&place(&app)?, &Disk, &journal(&app)?)
}

#[tauri::command]
pub fn vault_forget_unsaved(app: AppHandle, path: String) -> Result<(), AppError> {
    use_case::forget_unsaved(&place(&app)?, &Disk, &journal(&app)?, &path)
}

#[tauri::command]
pub fn vault_trash(app: AppHandle, path: String) -> Result<(), AppError> {
    use_case::trash(&place(&app)?, &Disk, &path)
}

/// Асинхронная: чтение всего хранилища не держит главный поток.
#[tauri::command]
pub async fn vault_texts(app: AppHandle) -> Result<Vec<NoteText>, AppError> {
    use_case::texts(&place(&app)?, &Disk)
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
