use super::domain::{Entry, EntryKind, Unsaved, Version, parse_note_path};
use super::infrastructure::config_file::ConfigFile;
use super::infrastructure::disk::Disk;
use super::infrastructure::history_dir::HistoryDir;
use super::infrastructure::journal_dir::JournalDir;
use super::infrastructure::watcher::Watch;
use super::ports::VaultPlace;
use super::use_case::{self, NoteText, VaultStatus};
use crate::error::AppError;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url};
use tauri_plugin_deep_link::DeepLinkExt;
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

fn history<R: Runtime>(app: &AppHandle<R>) -> Result<HistoryDir, AppError> {
    app.path()
        .app_data_dir()
        .map(|dir| HistoryDir::new(&dir))
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

/// Слежение идёт за той папкой, что сейчас на месте. Вернули пропавшую
/// папку, и следующий запрос статуса снова за ней следит.
fn follow<R: Runtime>(app: &AppHandle<R>, watch: &Watch, place: &ConfigFile) {
    let root = place.load().filter(|path| path.is_dir());

    watch.follow(app, root.as_deref());
}

/// Событие для интерфейса: система открыла приложение ссылкой на заметку.
const OPEN: &str = "vault://open";

/// Заметки, которые система попросила открыть ссылкой, пока окно их не
/// забрало. Ссылка, которой приложение запустили, приходит раньше, чем окно
/// начинает слушать события, поэтому окно забирает их само при запуске
/// и по событию.
#[derive(Default)]
pub struct Opened(Mutex<Vec<String>>);

/// Ссылка `sapien://open?path=<путь заметки>` только открывает заметку
/// внутри хранилища. Другая ссылка и путь наружу молча пропускаются.
fn linked_note(url: &Url) -> Option<String> {
    if url.scheme() != "sapien" || url.host_str() != Some("open") {
        return None;
    }

    let (_, path) = url.query_pairs().find(|(key, _)| key == "path")?;

    parse_note_path(&path).map(String::from)
}

fn open_links<R: Runtime>(app: &AppHandle<R>, urls: &[Url]) {
    let notes: Vec<_> = urls.iter().filter_map(linked_note).collect();

    if notes.is_empty() {
        return;
    }

    if let Ok(mut opened) = app.state::<Opened>().0.lock() {
        opened.extend(notes);
    }

    let _ = app.emit(OPEN, ());
}

pub fn start<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(place) = place(app) {
        follow(app, &app.state::<Watch>(), &place);

        if let Ok(history) = history(app) {
            use_case::prune_history(&place, &Disk, &history);
        }
    }

    let links = app.clone();
    app.deep_link()
        .on_open_url(move |event| open_links(&links, &event.urls()));

    if let Ok(Some(urls)) = app.deep_link().get_current() {
        open_links(app, &urls);
    }

    // macOS знает схему из бандла, Windows и Linux записывают её
    // в систему при запуске.
    #[cfg(any(windows, target_os = "linux"))]
    let _ = app.deep_link().register_all();
}

/// Заметки из ссылок, которые ещё не открыты. Забранные уходят из очереди.
#[tauri::command]
pub fn vault_opened(opened: State<'_, Opened>) -> Vec<String> {
    opened
        .0
        .lock()
        .map(|mut paths| std::mem::take(&mut *paths))
        .unwrap_or_default()
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
pub fn vault_close_for_agent(app: AppHandle, path: String, closed: bool) -> Result<(), AppError> {
    use_case::close_for_agent(&place(&app)?, &Disk, &path, closed)
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

    use_case::write(
        &place(&app)?,
        &Disk,
        &journal(&app)?,
        &history(&app)?,
        &unsaved,
    )
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
    use_case::trash(&place(&app)?, &Disk, &history(&app)?, &path)
}

#[tauri::command]
pub fn vault_versions(app: AppHandle, path: String) -> Result<Vec<Version>, AppError> {
    use_case::versions(&place(&app)?, &Disk, &history(&app)?, &path)
}

#[tauri::command]
pub fn vault_version(app: AppHandle, path: String, id: u64) -> Result<String, AppError> {
    use_case::version(&place(&app)?, &Disk, &history(&app)?, &path, id)
}

#[tauri::command]
pub fn vault_restore(app: AppHandle, path: String, id: u64) -> Result<(), AppError> {
    use_case::restore(&place(&app)?, &Disk, &history(&app)?, &path, id)
}

#[tauri::command]
pub fn vault_deleted(app: AppHandle) -> Result<Vec<String>, AppError> {
    use_case::deleted(&place(&app)?, &Disk, &history(&app)?)
}

/// Асинхронная: чтение всего хранилища не держит главный поток.
#[tauri::command]
pub async fn vault_texts(app: AppHandle) -> Result<Vec<NoteText>, AppError> {
    use_case::texts(&place(&app)?, &Disk)
}

/// Хранилище, которое сейчас нельзя сменить: по нему идёт ответ агента
/// или откат, и правки ушли бы в другую папку.
#[derive(Default)]
pub struct Pinned(AtomicBool);

/// Держит хранилище на месте, пока жив.
pub struct Pin<'a>(&'a Pinned);

impl Pinned {
    pub fn pin(&self) -> Pin<'_> {
        self.0.store(true, Ordering::SeqCst);
        Pin(self)
    }

    fn check(&self) -> Result<(), AppError> {
        if self.0.load(Ordering::SeqCst) {
            return Err(AppError::conflict("agent_busy"));
        }

        Ok(())
    }
}

impl Drop for Pin<'_> {
    fn drop(&mut self) {
        self.0.0.store(false, Ordering::SeqCst);
    }
}

/// Асинхронная, потому что диалог ждёт человека: синхронная команда держала
/// бы главный поток, и окно бы замерло. Пока отвечает агент, хранилище
/// не меняется: ни до диалога, ни после него.
#[tauri::command]
pub async fn vault_choose(
    app: AppHandle,
    watch: State<'_, Watch>,
    pinned: State<'_, Pinned>,
) -> Result<VaultStatus, AppError> {
    pinned.check()?;

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

    pinned.check()?;

    let status = use_case::choose(&place, &Disk, &picked)?;

    follow(&app, &watch, &place);

    Ok(status)
}

// Заметки для агента: сценарии без папок, закрытых для него, путь заметки
// проверяется так же, как у команд окна. Удаления среди них нет: агент
// не удаляет вовсе.

/// Папка хранилища: по ней агент держит свой чат у каждого хранилища.
pub fn vault_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    place(app).ok()?.load()
}

pub fn note_paths<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<String>, AppError> {
    use_case::agent_paths(&place(app)?, &Disk)
}

pub fn note_texts<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<NoteText>, AppError> {
    use_case::agent_texts(&place(app)?, &Disk)
}

pub fn read_note<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<String, AppError> {
    use_case::agent_read(&place(app)?, &Disk, path)
}

pub fn put_note<R: Runtime>(app: &AppHandle<R>, path: &str, text: &str) -> Result<(), AppError> {
    use_case::agent_put(&place(app)?, &Disk, &history(app)?, path, text)
}

/// Для YouTrack: текст заметки, который уходит в задачу, ложится в её
/// историю версий.
pub fn keep_published<R: Runtime>(
    app: &AppHandle<R>,
    path: &str,
    text: &str,
) -> Result<(), AppError> {
    use_case::keep_published(&place(app)?, &Disk, &history(app)?, path, text)
}

/// Откат правки агента по просьбе человека, поэтому без проверки закрытых
/// папок.
pub fn revert_note<R: Runtime>(
    app: &AppHandle<R>,
    path: &str,
    before: Option<&str>,
) -> Result<(), AppError> {
    use_case::revert(&place(app)?, &Disk, &history(app)?, path, before)
}

/// Можно ли показать агенту путь заметки, например открытой у человека.
/// Не вышло проверить, значит, нельзя.
pub fn open_to_agent<R: Runtime>(app: &AppHandle<R>, path: &str) -> bool {
    place(app).is_ok_and(|place| use_case::open_to_agent(&place, &Disk, path).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(link: &str) -> Option<String> {
        linked_note(&Url::parse(link).unwrap())
    }

    #[test]
    fn ссылка_открывает_только_заметку_внутри_хранилища() {
        assert_eq!(
            note(
                "sapien://open?path=%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/%D0%BF%D0%BB%D0%B0%D0%BD.md"
            ),
            Some("Проекты/план.md".into())
        );
        assert_eq!(note("sapien://open?path=../../.ssh/id_rsa"), None);
        assert_eq!(note("sapien://open?path=/etc/hosts.md"), None);
        assert_eq!(note("sapien://open?path=.obsidian/app.md"), None);
        assert_eq!(note("sapien://delete?path=план.md"), None);
        assert_eq!(note("sapien://open"), None);
        assert_eq!(note("https://open?path=план.md"), None);
    }
}
