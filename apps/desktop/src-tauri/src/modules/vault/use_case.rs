use super::domain::{
    Entry, EntryKind, HISTORY_EVERY, HISTORY_KEEP, JOURNAL_KEEP, Source, Unsaved, Version,
    check_name, closed_folders, is_closed, is_within, note_file_name, note_paths,
    parse_folder_path, parse_note_path,
};
use super::ports::{History, Journal, VaultDisk, VaultPlace};
use crate::error::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Что с хранилищем. Путь уходит в интерфейс строкой: он только
/// показывается человеку, обратно в Rust его никто не присылает.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VaultStatus {
    /// Первый запуск: папку ещё не выбирали.
    None,
    /// Папку выбирали, но её больше нет на месте. Выбор не забывается:
    /// вернут папку на место, и хранилище откроется само.
    Missing {
        path: String,
    },
    Ready {
        path: String,
    },
}

pub fn status(place: &impl VaultPlace, disk: &impl VaultDisk) -> VaultStatus {
    let Some(path) = place.load() else {
        return VaultStatus::None;
    };
    let shown = path.display().to_string();

    if disk.is_dir(&path) {
        VaultStatus::Ready { path: shown }
    } else {
        VaultStatus::Missing { path: shown }
    }
}

fn open_root(place: &impl VaultPlace, disk: &impl VaultDisk) -> Result<PathBuf, AppError> {
    let root = place
        .load()
        .ok_or(AppError::not_found("vault_not_chosen"))?;

    if !disk.is_dir(&root) {
        return Err(AppError::not_found("vault_missing"));
    }

    Ok(root)
}

pub fn tree(place: &impl VaultPlace, disk: &impl VaultDisk) -> Result<Vec<Entry>, AppError> {
    disk.list(&open_root(place, disk)?)
}

/// Создаёт заметку или папку в папке `parent` и отдаёт путь нового элемента
/// в виде, как в дереве. Занятое имя не перезаписывается.
pub fn create(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    parent: &str,
    name: &str,
    kind: EntryKind,
) -> Result<String, AppError> {
    let root = open_root(place, disk)?;
    let parent = parse_folder_path(parent).ok_or(AppError::invalid("path_invalid"))?;
    let name = name.trim();

    check_name(name).map_err(AppError::invalid)?;

    let file_name = match kind {
        EntryKind::Note => note_file_name(name),
        EntryKind::Folder => name.to_owned(),
    };
    let path = match parent {
        "" => file_name,
        _ => format!("{parent}/{file_name}"),
    };

    disk.create(&root.join(&path), kind)?;

    Ok(path)
}

/// Закрывает папку для агента или открывает снова. Корень не закрывается:
/// агенту без единой заметки делать нечего.
pub fn close_for_agent(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    folder: &str,
    closed: bool,
) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let folder = parse_folder_path(folder)
        .filter(|folder| !folder.is_empty())
        .ok_or(AppError::invalid("path_invalid"))?;
    let path = root.join(folder);

    if !disk.is_dir(&path) {
        return Err(AppError::not_found("folder_missing"));
    }

    disk.mark(&path, closed)
}

// Заметки глазами агента: всё, кроме папок, закрытых для него. Закрытое
// агент не получает ни списком, ни поиском, ни по пути.

/// Заметку из закрытой папки агент не читает и не пишет, новую в ней
/// не создаёт. Метку ищет диск по каждой папке над заметкой: путь
/// в другом регистре или в другой нормализации Unicode ведёт в ту же папку.
pub fn open_to_agent(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    path: &str,
) -> Result<(), AppError> {
    let mut folder = open_root(place, disk)?;
    let path = parse_note_path(path).ok_or(AppError::invalid("path_invalid"))?;
    let folders = path.rsplit_once('/').map_or("", |(folders, _)| folders);

    for part in folders.split('/').filter(|part| !part.is_empty()) {
        folder.push(part);

        if disk.marked(&folder) {
            return Err(AppError::invalid("note_closed"));
        }
    }

    Ok(())
}

pub fn agent_paths(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
) -> Result<Vec<String>, AppError> {
    let entries = tree(place, disk)?;
    let closed = closed_folders(&entries);

    Ok(note_paths(&entries)
        .into_iter()
        .filter(|path| !is_closed(path, &closed))
        .collect())
}

pub fn agent_texts(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
) -> Result<Vec<NoteText>, AppError> {
    let root = open_root(place, disk)?;

    Ok(read_all(disk, &root, agent_paths(place, disk)?))
}

pub fn agent_read(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    path: &str,
) -> Result<String, AppError> {
    open_to_agent(place, disk, path)?;
    read(place, disk, path)
}

pub fn agent_put(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
    path: &str,
    text: &str,
) -> Result<(), AppError> {
    open_to_agent(place, disk, path)?;
    put(place, disk, history, path, text)
}

/// Текст заметки, который уходит в задачу YouTrack, ложится в её историю:
/// что опубликовано, видно рядом с заметкой, даже когда задачу правят там.
pub fn keep_published(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
    path: &str,
    text: &str,
) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let path = parse_note_path(path).ok_or(AppError::invalid("path_invalid"))?;

    snapshot(history, &root, path, text, Source::Youtrack);
    Ok(())
}

fn note_at(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    path: &str,
) -> Result<PathBuf, AppError> {
    let root = open_root(place, disk)?;
    let path = parse_note_path(path).ok_or(AppError::invalid("path_invalid"))?;

    Ok(root.join(path))
}

pub fn read(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    path: &str,
) -> Result<String, AppError> {
    disk.read(&note_at(place, disk, path)?)
}

/// Снимает текст заметки перед тем, как его заменят. Правка человека
/// снимается не чаще раза в `HISTORY_EVERY`, остальное всегда. Пустой текст
/// и тот, что уже лежит последней версией, не снимаются. История запись
/// не держит: не вышло снять версию, заметка всё равно пишется.
fn snapshot(history: &impl History, root: &Path, path: &str, text: &str, source: Source) {
    let last = history.list(root, path).into_iter().next();
    let recent = last.is_some_and(|(_, age)| age < HISTORY_EVERY);
    let same = last.is_some_and(|(version, _)| {
        history
            .read(root, path, version.id)
            .is_ok_and(|kept| kept == text)
    });

    if text.is_empty() || same || (source == Source::Edit && recent) {
        return;
    }

    let _ = history.put(root, path, source, text);
}

/// Правка сначала ложится в журнал восстановления, потом в файл, и только
/// после записи файла уходит из журнала. Упало приложение посреди записи,
/// отказал диск, файл изменили снаружи: правка остаётся в журнале.
/// Журнал запись не держит: не вышло записать в него, файл всё равно пишется.
/// Текст, который правка заменит, уходит в историю версий.
pub fn write(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    journal: &impl Journal,
    history: &impl History,
    unsaved: &Unsaved,
) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let file = note_at(place, disk, &unsaved.path)?;
    let _ = journal.put(&root, unsaved);

    // Правка без base пишется поверх правки снаружи: та уходит в историю
    // всегда. Со спором запись не пройдёт, и снимать нечего.
    if let Ok(current) = disk.read(&file) {
        match unsaved.base.as_deref() {
            None => snapshot(history, &root, &unsaved.path, &current, Source::Outside),
            Some(base) if base == current => {
                snapshot(history, &root, &unsaved.path, &current, Source::Edit);
            }
            Some(_) => {}
        }
    }

    disk.write(&file, &unsaved.text, unsaved.base.as_deref())?;
    journal.remove(&root, &unsaved.path);

    Ok(())
}

/// Правка агента: заметка пишется целиком, новая создаётся вместе с папками.
/// Прежний текст уходит в историю всегда, а не раз в пять минут: каждую
/// правку агента можно откатить. Правку человека, которая ещё не дошла
/// до файла, она не затирает: запись окна потом увидит спор.
pub fn put(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
    path: &str,
    text: &str,
) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let file = note_at(place, disk, path)?;

    match disk.read(&file) {
        Ok(current) => snapshot(history, &root, path, &current, Source::Agent),
        Err(error) if error.code == "note_missing" => {
            let mut folder = root.clone();
            let folders = path.rsplit_once('/').map_or("", |(folders, _)| folders);

            for part in folders.split('/').filter(|part| !part.is_empty()) {
                folder.push(part);

                match disk.create(&folder, EntryKind::Folder) {
                    Err(error) if error.code != "name_taken" => return Err(error),
                    _ => {}
                }
            }

            disk.create(&file, EntryKind::Note)?;
        }
        Err(error) => return Err(error),
    }

    disk.write(&file, text, None)
}

/// Правки из журнала, которые можно вернуть. Те, что старше недели,
/// журнал забывает.
pub fn unsaved(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    journal: &impl Journal,
) -> Result<Vec<Unsaved>, AppError> {
    let root = open_root(place, disk)?;

    Ok(journal
        .list(&root)
        .into_iter()
        .filter_map(|(unsaved, age)| {
            if age > JOURNAL_KEEP {
                journal.remove(&root, &unsaved.path);
                return None;
            }

            Some(unsaved)
        })
        .collect())
}

/// Человек отказался от правки заметки: не стал её возвращать или взял
/// версию с диска.
pub fn forget_unsaved(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    journal: &impl Journal,
    path: &str,
) -> Result<(), AppError> {
    journal.remove(&open_root(place, disk)?, path);

    Ok(())
}

/// Убирает заметку или папку в системную корзину. Корень хранилища
/// и путь наружу до диска не доходят. Заметки внутри удалённого остаются
/// в истории версий: их можно восстановить и после очистки корзины.
pub fn trash(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
    path: &str,
) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let path = parse_note_path(path)
        .or_else(|| parse_folder_path(path).filter(|folder| !folder.is_empty()))
        .ok_or(AppError::invalid("path_invalid"))?;
    let notes = disk
        .list(&root)
        .map(|tree| note_paths(&tree))
        .unwrap_or_default();

    for note in notes.iter().filter(|note| is_within(note, path)) {
        if let Ok(text) = disk.read(&root.join(note)) {
            snapshot(history, &root, note, &text, Source::Trash);
        }
    }

    disk.trash(&root.join(path))
}

/// Версии заметки, свежие первыми. Версии старше срока уже не показываются,
/// а с диска их убирает `prune_history`.
pub fn versions(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
    path: &str,
) -> Result<Vec<Version>, AppError> {
    let root = open_root(place, disk)?;
    let path = parse_note_path(path).ok_or(AppError::invalid("path_invalid"))?;

    Ok(history
        .list(&root, path)
        .into_iter()
        .filter(|(_, age)| *age <= HISTORY_KEEP)
        .map(|(version, _)| version)
        .collect())
}

pub fn version(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
    path: &str,
    id: u64,
) -> Result<String, AppError> {
    let root = open_root(place, disk)?;
    let path = parse_note_path(path).ok_or(AppError::invalid("path_invalid"))?;

    history.read(&root, path, id)
}

/// Возвращает заметке прежнюю версию. Текущий текст перед этим уходит
/// в историю, и восстановление само обратимо. Удалённую заметку
/// восстановление создаёт заново, вместе с папками над ней.
pub fn restore(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
    path: &str,
    id: u64,
) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let path = parse_note_path(path).ok_or(AppError::invalid("path_invalid"))?;
    let text = history.read(&root, path, id)?;

    put_back(disk, history, &root, path, &text)
}

/// Откат правки агента: заметка получает текст до неё, а созданная агентом
/// (`before` пуст) уходит в корзину. Откат просит человек, поэтому папки,
/// закрытые для агента, ему не мешают. Текущий текст сначала уходит
/// в историю: правка человека поверх агента не теряется, и откат обратим.
pub fn revert(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
    path: &str,
    before: Option<&str>,
) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let path = parse_note_path(path).ok_or(AppError::invalid("path_invalid"))?;

    let Some(text) = before else {
        return match disk.read(&root.join(path)) {
            Err(error) if error == AppError::not_found("note_missing") => Ok(()),
            _ => trash(place, disk, history, path),
        };
    };

    put_back(disk, history, &root, path, text)
}

/// Пишет заметке текст, а текущий сначала снимает в историю. Удалённую
/// заметку создаёт заново, вместе с папками над ней.
fn put_back(
    disk: &impl VaultDisk,
    history: &impl History,
    root: &Path,
    path: &str,
    text: &str,
) -> Result<(), AppError> {
    let file = root.join(path);

    match disk.read(&file) {
        Ok(current) => snapshot(history, root, path, &current, Source::Restore),
        Err(error) if error == AppError::not_found("note_missing") => {
            recreate(disk, root, path)?;
        }
        Err(error) => return Err(error),
    }

    disk.write(&file, text, None)
}

fn recreate(disk: &impl VaultDisk, root: &Path, path: &str) -> Result<(), AppError> {
    let (folders, _) = path.rsplit_once('/').unwrap_or(("", path));
    let mut folder = root.to_path_buf();

    for part in folders.split('/').filter(|part| !part.is_empty()) {
        folder.push(part);

        match disk.create(&folder, EntryKind::Folder) {
            Err(error) if error != AppError::conflict("name_taken") => return Err(error),
            _ => {}
        }
    }

    disk.create(&root.join(path), EntryKind::Note)
}

/// Удалённые заметки, у которых остались версии, по алфавиту.
pub fn deleted(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    history: &impl History,
) -> Result<Vec<String>, AppError> {
    let root = open_root(place, disk)?;
    let existing = note_paths(&disk.list(&root)?);
    let mut paths: Vec<_> = history
        .notes(&root)
        .into_iter()
        .filter(|path| !existing.contains(path))
        .collect();

    paths.sort();
    Ok(paths)
}

/// Убирает с диска версии старше срока. Зовётся при запуске: заметку,
/// которую месяц не открывали, иначе никто бы не почистил.
pub fn prune_history(place: &impl VaultPlace, disk: &impl VaultDisk, history: &impl History) {
    if let Ok(root) = open_root(place, disk) {
        history.prune(&root, HISTORY_KEEP);
    }
}

/// Текст заметки для разбора в интерфейсе: теги и всё, что ищется по тексту.
#[derive(Debug, PartialEq, Serialize)]
pub struct NoteText {
    pub path: String,
    pub text: String,
}

/// Тексты всех заметок хранилища разом. Заметку, которую не прочитать
/// (её удалили между списком и чтением, на неё нет прав), пропускаем:
/// список без неё полезнее ошибки на всё хранилище.
pub fn texts(place: &impl VaultPlace, disk: &impl VaultDisk) -> Result<Vec<NoteText>, AppError> {
    let root = open_root(place, disk)?;

    Ok(read_all(disk, &root, note_paths(&disk.list(&root)?)))
}

/// Тексты заметок по путям. Нечитаемую заметку пропускает.
fn read_all(disk: &impl VaultDisk, root: &Path, paths: Vec<String>) -> Vec<NoteText> {
    paths
        .into_iter()
        .filter_map(|path| {
            let text = disk.read(&root.join(&path)).ok()?;

            Some(NoteText { path, text })
        })
        .collect()
}

/// Папку дал системный диалог, то есть её выбрал человек. Путь из интерфейса
/// сюда не попадает: окно не может подсунуть хранилищем чужую папку.
pub fn choose(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    picked: &Path,
) -> Result<VaultStatus, AppError> {
    if !disk.is_dir(picked) {
        return Err(AppError::not_found("vault_missing"));
    }

    place.save(picked)?;

    Ok(status(place, disk))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::time::Duration;

    #[derive(Default)]
    struct Place(RefCell<Option<PathBuf>>);

    impl VaultPlace for Place {
        fn load(&self) -> Option<PathBuf> {
            self.0.borrow().clone()
        }

        fn save(&self, path: &Path) -> Result<(), AppError> {
            *self.0.borrow_mut() = Some(path.to_path_buf());
            Ok(())
        }
    }

    struct Disk(Vec<&'static str>);

    impl VaultDisk for Disk {
        fn is_dir(&self, path: &Path) -> bool {
            self.0.iter().any(|dir| Path::new(dir) == path)
        }

        fn list(&self, _root: &Path) -> Result<Vec<Entry>, AppError> {
            Ok(vec![Entry::Note {
                name: "план.md".into(),
                path: "план.md".into(),
            }])
        }

        fn create(&self, _path: &Path, _kind: EntryKind) -> Result<(), AppError> {
            Ok(())
        }

        fn read(&self, _path: &Path) -> Result<String, AppError> {
            Ok(String::new())
        }

        fn write(&self, _path: &Path, _text: &str, _base: Option<&str>) -> Result<(), AppError> {
            Ok(())
        }

        fn trash(&self, _path: &Path) -> Result<(), AppError> {
            Ok(())
        }

        fn mark(&self, _folder: &Path, _closed: bool) -> Result<(), AppError> {
            Ok(())
        }

        fn marked(&self, _folder: &Path) -> bool {
            false
        }
    }

    /// Журнал в памяти: запись по пути заметки и её возраст.
    #[derive(Default)]
    struct Memo(RefCell<Vec<(Unsaved, Duration)>>);

    impl Journal for Memo {
        fn put(&self, vault: &Path, unsaved: &Unsaved) -> Result<(), AppError> {
            self.remove(vault, &unsaved.path);
            self.0.borrow_mut().push((unsaved.clone(), Duration::ZERO));
            Ok(())
        }

        fn remove(&self, _vault: &Path, path: &str) {
            self.0
                .borrow_mut()
                .retain(|(unsaved, _)| unsaved.path != path);
        }

        fn list(&self, _vault: &Path) -> Vec<(Unsaved, Duration)> {
            self.0.borrow().clone()
        }
    }

    fn edit(path: &str, text: &str) -> Unsaved {
        Unsaved {
            path: path.into(),
            base: Some("было".into()),
            text: text.into(),
        }
    }

    /// Хранилище `/notes`, где файл изменили снаружи: запись отказывает,
    /// а убранное в корзину записывается.
    #[derive(Default)]
    struct Changed(RefCell<Vec<PathBuf>>);

    impl VaultDisk for Changed {
        fn is_dir(&self, path: &Path) -> bool {
            path == Path::new("/notes")
        }

        fn list(&self, _root: &Path) -> Result<Vec<Entry>, AppError> {
            Ok(vec![])
        }

        fn create(&self, _path: &Path, _kind: EntryKind) -> Result<(), AppError> {
            Ok(())
        }

        fn read(&self, _path: &Path) -> Result<String, AppError> {
            Ok("снаружи".into())
        }

        fn write(&self, _path: &Path, _text: &str, _base: Option<&str>) -> Result<(), AppError> {
            Err(AppError::conflict("note_conflict"))
        }

        fn trash(&self, path: &Path) -> Result<(), AppError> {
            self.0.borrow_mut().push(path.to_path_buf());
            Ok(())
        }

        fn mark(&self, _folder: &Path, _closed: bool) -> Result<(), AppError> {
            Ok(())
        }

        fn marked(&self, _folder: &Path) -> bool {
            false
        }
    }

    /// Диск, на котором хранилище `/notes` на месте, а созданное записывается.
    #[derive(Default)]
    struct Recorder(RefCell<Vec<(PathBuf, EntryKind)>>);

    impl VaultDisk for Recorder {
        fn is_dir(&self, path: &Path) -> bool {
            path == Path::new("/notes")
        }

        fn list(&self, _root: &Path) -> Result<Vec<Entry>, AppError> {
            Ok(vec![])
        }

        fn create(&self, path: &Path, kind: EntryKind) -> Result<(), AppError> {
            self.0.borrow_mut().push((path.to_path_buf(), kind));
            Ok(())
        }

        /// Отвечает полным путём, который у него спросили.
        fn read(&self, path: &Path) -> Result<String, AppError> {
            Ok(path.display().to_string())
        }

        fn write(&self, path: &Path, _text: &str, _base: Option<&str>) -> Result<(), AppError> {
            self.0
                .borrow_mut()
                .push((path.to_path_buf(), EntryKind::Note));
            Ok(())
        }

        fn trash(&self, _path: &Path) -> Result<(), AppError> {
            Ok(())
        }

        fn mark(&self, _folder: &Path, _closed: bool) -> Result<(), AppError> {
            Ok(())
        }

        fn marked(&self, _folder: &Path) -> bool {
            false
        }
    }

    fn chosen(path: &str) -> Place {
        Place(RefCell::new(Some(path.into())))
    }

    /// Хранилище `/notes` в памяти: текст заметок по пути от корня. Папки
    /// здесь подразумеваются путями заметок.
    #[derive(Default)]
    struct Files(RefCell<BTreeMap<String, String>>);

    impl Files {
        fn with(notes: &[(&str, &str)]) -> Self {
            Self(RefCell::new(
                notes
                    .iter()
                    .map(|(path, text)| ((*path).into(), (*text).into()))
                    .collect(),
            ))
        }

        fn text(&self, path: &str) -> Option<String> {
            self.0.borrow().get(path).cloned()
        }

        fn change(&self, path: &str, text: &str) {
            self.0.borrow_mut().insert(path.into(), text.into());
        }
    }

    fn inside(path: &Path) -> String {
        path.strip_prefix("/notes")
            .unwrap()
            .to_string_lossy()
            .into()
    }

    impl VaultDisk for Files {
        fn is_dir(&self, path: &Path) -> bool {
            path == Path::new("/notes")
        }

        fn list(&self, _root: &Path) -> Result<Vec<Entry>, AppError> {
            Ok(self
                .0
                .borrow()
                .keys()
                .map(|path| Entry::Note {
                    name: path.rsplit('/').next().unwrap_or(path).into(),
                    path: path.clone(),
                })
                .collect())
        }

        fn create(&self, path: &Path, kind: EntryKind) -> Result<(), AppError> {
            if kind == EntryKind::Note {
                self.0.borrow_mut().entry(inside(path)).or_default();
            }

            Ok(())
        }

        fn read(&self, path: &Path) -> Result<String, AppError> {
            self.text(&inside(path))
                .ok_or(AppError::not_found("note_missing"))
        }

        fn write(&self, path: &Path, text: &str, base: Option<&str>) -> Result<(), AppError> {
            let current = self.read(path)?;

            if base.is_some_and(|base| base != current) {
                return Err(AppError::conflict("note_conflict"));
            }

            self.change(&inside(path), text);
            Ok(())
        }

        fn trash(&self, path: &Path) -> Result<(), AppError> {
            let entry = inside(path);

            self.0
                .borrow_mut()
                .retain(|path, _| !is_within(path, &entry));
            Ok(())
        }

        fn mark(&self, _folder: &Path, _closed: bool) -> Result<(), AppError> {
            Ok(())
        }

        fn marked(&self, _folder: &Path) -> bool {
            false
        }
    }

    /// История в памяти: путь, версия, возраст и текст. Номера идут
    /// по порядку снимков.
    #[derive(Default)]
    struct Album(RefCell<Vec<(String, Version, Duration, String)>>);

    impl Album {
        /// Время прошло для всех версий разом.
        fn wait(&self, time: Duration) {
            for (_, _, age, _) in self.0.borrow_mut().iter_mut() {
                *age += time;
            }
        }

        fn texts(&self, path: &str) -> Vec<(Source, String)> {
            self.list(Path::new("/notes"), path)
                .into_iter()
                .map(|(version, _)| {
                    let text = self.read(Path::new("/notes"), path, version.id).unwrap();

                    (version.source, text)
                })
                .collect()
        }
    }

    impl History for Album {
        fn put(
            &self,
            _vault: &Path,
            path: &str,
            source: Source,
            text: &str,
        ) -> Result<(), AppError> {
            let id = self.0.borrow().len() as u64 + 1;

            self.0.borrow_mut().push((
                path.into(),
                Version { id, source },
                Duration::ZERO,
                text.into(),
            ));
            Ok(())
        }

        fn list(&self, _vault: &Path, path: &str) -> Vec<(Version, Duration)> {
            let mut versions: Vec<_> = self
                .0
                .borrow()
                .iter()
                .filter(|(note, ..)| note == path)
                .map(|(_, version, age, _)| (*version, *age))
                .collect();

            versions.reverse();
            versions
        }

        fn read(&self, _vault: &Path, path: &str, id: u64) -> Result<String, AppError> {
            self.0
                .borrow()
                .iter()
                .find(|(note, version, ..)| note == path && version.id == id)
                .map(|(.., text)| text.clone())
                .ok_or(AppError::not_found("version_missing"))
        }

        fn notes(&self, _vault: &Path) -> Vec<String> {
            let mut paths: Vec<_> = self
                .0
                .borrow()
                .iter()
                .map(|(path, ..)| path.clone())
                .collect();

            paths.dedup();
            paths
        }

        fn prune(&self, _vault: &Path, keep: Duration) {
            self.0.borrow_mut().retain(|(_, _, age, _)| *age <= keep);
        }
    }

    fn based(path: &str, base: Option<&str>, text: &str) -> Unsaved {
        Unsaved {
            path: path.into(),
            base: base.map(Into::into),
            text: text.into(),
        }
    }

    #[test]
    fn правка_снимает_прежний_текст_не_чаще_раза_в_пять_минут() {
        let place = chosen("/notes");
        let disk = Files::with(&[("план.md", "было")]);
        let history = Album::default();
        let save = |base: &str, text: &str| {
            write(
                &place,
                &disk,
                &Memo::default(),
                &history,
                &based("план.md", Some(base), text),
            )
        };

        save("было", "раз").unwrap();
        save("раз", "два").unwrap();
        history.wait(HISTORY_EVERY);
        save("два", "три").unwrap();

        assert_eq!(
            history.texts("план.md"),
            [(Source::Edit, "два".into()), (Source::Edit, "было".into())]
        );
        assert_eq!(disk.text("план.md"), Some("три".into()));
    }

    #[test]
    fn правка_снаружи_уходит_в_историю_когда_её_перекрывают() {
        let place = chosen("/notes");
        let disk = Files::with(&[("план.md", "было")]);
        let history = Album::default();
        let journal = Memo::default();

        write(
            &place,
            &disk,
            &journal,
            &history,
            &based("план.md", Some("было"), "раз"),
        )
        .unwrap();
        disk.change("план.md", "снаружи");

        // Спор: файл не тронут, снимать нечего.
        assert_eq!(
            write(
                &place,
                &disk,
                &journal,
                &history,
                &based("план.md", Some("раз"), "два")
            ),
            Err(AppError::conflict("note_conflict"))
        );
        assert_eq!(history.texts("план.md").len(), 1);

        // Человек оставил свою: правка снаружи снимается, хоть пять минут
        // и не прошли. Тот же текст второй раз не снимается.
        write(
            &place,
            &disk,
            &journal,
            &history,
            &based("план.md", None, "два"),
        )
        .unwrap();
        disk.change("план.md", "снаружи");
        write(
            &place,
            &disk,
            &journal,
            &history,
            &based("план.md", None, "два"),
        )
        .unwrap();

        assert_eq!(
            history.texts("план.md"),
            [
                (Source::Outside, "снаружи".into()),
                (Source::Edit, "было".into())
            ]
        );
    }

    #[test]
    fn пустая_заметка_не_снимается() {
        let place = chosen("/notes");
        let disk = Files::with(&[("план.md", "")]);
        let history = Album::default();

        write(
            &place,
            &disk,
            &Memo::default(),
            &history,
            &based("план.md", None, "шаблон"),
        )
        .unwrap();

        assert!(history.texts("план.md").is_empty());
    }

    #[test]
    fn откат_агента_хранит_правку_человека_и_убирает_созданное() {
        let place = chosen("/notes");
        let disk = Files::with(&[("план.md", "было")]);
        let history = Album::default();

        put(&place, &disk, &history, "план.md", "агент").unwrap();
        put(&place, &disk, &history, "Новое/итоги.md", "итоги агента").unwrap();
        write(
            &place,
            &disk,
            &Memo::default(),
            &history,
            &based("план.md", Some("агент"), "агент и человек"),
        )
        .unwrap();

        revert(&place, &disk, &history, "план.md", Some("было")).unwrap();
        revert(&place, &disk, &history, "Новое/итоги.md", None).unwrap();
        revert(&place, &disk, &history, "Новое/итоги.md", None).unwrap();
        revert(&place, &disk, &history, "удалённое.md", Some("текст")).unwrap();

        assert_eq!(disk.text("план.md"), Some("было".into()));
        assert_eq!(
            history.texts("план.md")[0],
            (Source::Restore, "агент и человек".into())
        );
        assert_eq!(disk.text("Новое/итоги.md"), None);
        assert_eq!(
            history.texts("Новое/итоги.md"),
            [(Source::Trash, "итоги агента".into())]
        );
        assert_eq!(disk.text("удалённое.md"), Some("текст".into()));
    }

    #[test]
    fn восстановление_обратимо_и_возвращает_удалённую_заметку() {
        let place = chosen("/notes");
        let disk = Files::with(&[("Проекты/план.md", "было"), ("идеи.md", "идеи")]);
        let history = Album::default();
        let restore_first = || {
            let first = versions(&place, &disk, &history, "Проекты/план.md").unwrap();

            restore(
                &place,
                &disk,
                &history,
                "Проекты/план.md",
                first.last().unwrap().id,
            )
        };

        write(
            &place,
            &disk,
            &Memo::default(),
            &history,
            &based("Проекты/план.md", Some("было"), "стало"),
        )
        .unwrap();
        restore_first().unwrap();

        assert_eq!(disk.text("Проекты/план.md"), Some("было".into()));
        assert_eq!(
            history.texts("Проекты/план.md")[0],
            (Source::Restore, "стало".into())
        );

        trash(&place, &disk, &history, "Проекты").unwrap();

        assert_eq!(disk.text("Проекты/план.md"), None);
        assert_eq!(
            history.texts("Проекты/план.md")[0],
            (Source::Trash, "было".into())
        );
        assert_eq!(
            deleted(&place, &disk, &history),
            Ok(vec!["Проекты/план.md".into()])
        );

        restore_first().unwrap();

        assert_eq!(disk.text("Проекты/план.md"), Some("было".into()));
        assert_eq!(deleted(&place, &disk, &history), Ok(vec![]));
        assert_eq!(
            restore(&place, &disk, &history, "../план.md", 1),
            Err(AppError::invalid("path_invalid"))
        );
        assert_eq!(
            restore(&place, &disk, &history, "идеи.md", 1),
            Err(AppError::not_found("version_missing"))
        );
    }

    #[test]
    fn версии_старше_месяца_не_видны_и_убираются() {
        let place = chosen("/notes");
        let disk = Files::with(&[("план.md", "было")]);
        let history = Album::default();

        write(
            &place,
            &disk,
            &Memo::default(),
            &history,
            &based("план.md", None, "стало"),
        )
        .unwrap();
        history.wait(HISTORY_KEEP + Duration::from_secs(1));

        assert_eq!(versions(&place, &disk, &history, "план.md"), Ok(vec![]));

        prune_history(&place, &disk, &history);
        assert!(history.0.borrow().is_empty());
    }

    /// Хранилище `/notes`: заметка в папке и заметка в корне, которую
    /// не прочитать.
    struct Shelf;

    impl VaultDisk for Shelf {
        fn is_dir(&self, path: &Path) -> bool {
            path == Path::new("/notes")
        }

        fn list(&self, _root: &Path) -> Result<Vec<Entry>, AppError> {
            Ok(vec![
                Entry::Folder {
                    name: "Проекты".into(),
                    path: "Проекты".into(),
                    closed: false,
                    children: vec![Entry::Note {
                        name: "план.md".into(),
                        path: "Проекты/план.md".into(),
                    }],
                },
                Entry::Note {
                    name: "сломан.md".into(),
                    path: "сломан.md".into(),
                },
            ])
        }

        fn create(&self, _path: &Path, _kind: EntryKind) -> Result<(), AppError> {
            Ok(())
        }

        fn read(&self, path: &Path) -> Result<String, AppError> {
            if path == Path::new("/notes/сломан.md") {
                return Err(AppError::not_found("note_missing"));
            }

            Ok(format!("текст {}", path.display()))
        }

        fn write(&self, _path: &Path, _text: &str, _base: Option<&str>) -> Result<(), AppError> {
            Ok(())
        }

        fn trash(&self, _path: &Path) -> Result<(), AppError> {
            Ok(())
        }

        fn mark(&self, _folder: &Path, _closed: bool) -> Result<(), AppError> {
            Ok(())
        }

        fn marked(&self, _folder: &Path) -> bool {
            false
        }
    }

    #[test]
    fn тексты_всех_заметок_кроме_непрочитанных() {
        assert_eq!(
            texts(&chosen("/notes"), &Shelf),
            Ok(vec![NoteText {
                path: "Проекты/план.md".into(),
                text: "текст /notes/Проекты/план.md".into(),
            }])
        );
    }

    /// Хранилище `/notes` с папкой «Личное», закрытой для агента. Диск
    /// не различает регистр, как на macOS. Метки ставятся в память.
    #[derive(Default)]
    struct Private(RefCell<Vec<(PathBuf, bool)>>);

    impl VaultDisk for Private {
        fn is_dir(&self, path: &Path) -> bool {
            path == Path::new("/notes") || path == Path::new("/notes/Личное")
        }

        fn list(&self, _root: &Path) -> Result<Vec<Entry>, AppError> {
            Ok(vec![
                Entry::Folder {
                    name: "Личное".into(),
                    path: "Личное".into(),
                    closed: true,
                    children: vec![Entry::Note {
                        name: "дневник.md".into(),
                        path: "Личное/дневник.md".into(),
                    }],
                },
                Entry::Note {
                    name: "план.md".into(),
                    path: "план.md".into(),
                },
            ])
        }

        fn create(&self, _path: &Path, _kind: EntryKind) -> Result<(), AppError> {
            Ok(())
        }

        fn read(&self, path: &Path) -> Result<String, AppError> {
            Ok(format!("текст {}", path.display()))
        }

        fn write(&self, _path: &Path, _text: &str, _base: Option<&str>) -> Result<(), AppError> {
            Ok(())
        }

        fn trash(&self, _path: &Path) -> Result<(), AppError> {
            Ok(())
        }

        fn mark(&self, folder: &Path, closed: bool) -> Result<(), AppError> {
            self.0.borrow_mut().push((folder.to_path_buf(), closed));
            Ok(())
        }

        fn marked(&self, folder: &Path) -> bool {
            folder.to_string_lossy().to_lowercase() == "/notes/личное"
        }
    }

    #[test]
    fn закрытую_папку_агент_не_получает_ни_списком_ни_поиском_ни_по_пути() {
        let place = chosen("/notes");
        let history = Album::default();

        assert_eq!(
            agent_paths(&place, &Private::default()),
            Ok(vec!["план.md".into()])
        );
        assert_eq!(
            agent_texts(&place, &Private::default()).map(|texts| texts.len()),
            Ok(1)
        );

        for path in ["Личное/дневник.md", "личное/дневник.md", "Личное/новая.md"]
        {
            assert_eq!(
                agent_read(&place, &Private::default(), path),
                Err(AppError::invalid("note_closed")),
                "{path}"
            );
            assert_eq!(
                agent_put(&place, &Private::default(), &history, path, "текст"),
                Err(AppError::invalid("note_closed")),
                "{path}"
            );
        }

        assert_eq!(
            agent_read(&place, &Private::default(), "план.md"),
            Ok("текст /notes/план.md".into())
        );
        // Окну закрытая папка видна как обычно.
        assert_eq!(
            texts(&place, &Private::default()).map(|texts| texts.len()),
            Ok(2)
        );
    }

    #[test]
    fn папку_закрывают_и_открывают_меткой_но_не_корень() {
        let place = chosen("/notes");
        let disk = Private::default();

        close_for_agent(&place, &disk, "Личное", true).unwrap();
        close_for_agent(&place, &disk, "Личное", false).unwrap();

        assert_eq!(
            *disk.0.borrow(),
            [
                (PathBuf::from("/notes/Личное"), true),
                (PathBuf::from("/notes/Личное"), false)
            ]
        );
        assert_eq!(
            close_for_agent(&place, &disk, "", true),
            Err(AppError::invalid("path_invalid"))
        );
        assert_eq!(
            close_for_agent(&place, &disk, "../Личное", true),
            Err(AppError::invalid("path_invalid"))
        );
        assert_eq!(
            close_for_agent(&place, &disk, "Нет", true),
            Err(AppError::not_found("folder_missing"))
        );
    }

    #[test]
    fn заметка_получает_md_и_путь_как_в_дереве() {
        let disk = Recorder::default();

        let path = create(
            &chosen("/notes"),
            &disk,
            "Проекты",
            "  план  ",
            EntryKind::Note,
        );

        assert_eq!(path, Ok("Проекты/план.md".into()));
        assert_eq!(
            disk.0.borrow()[0],
            (PathBuf::from("/notes/Проекты/план.md"), EntryKind::Note)
        );
    }

    #[test]
    fn папка_в_корне_без_расширения() {
        let disk = Recorder::default();

        let path = create(&chosen("/notes"), &disk, "", "Встречи", EntryKind::Folder);

        assert_eq!(path, Ok("Встречи".into()));
    }

    #[test]
    fn плохое_имя_и_путь_наружу_до_диска_не_доходят() {
        let disk = Recorder::default();
        let place = chosen("/notes");

        assert_eq!(
            create(&place, &disk, "", "а/б", EntryKind::Note),
            Err(AppError::invalid("name_forbidden"))
        );
        assert_eq!(
            create(&place, &disk, "..", "план", EntryKind::Note),
            Err(AppError::invalid("path_invalid"))
        );
        assert!(disk.0.borrow().is_empty());
    }

    #[test]
    fn заметка_читается_и_пишется_внутри_хранилища() {
        let disk = Recorder::default();
        let place = chosen("/notes");

        assert_eq!(
            read(&place, &disk, "Проекты/план.md"),
            Ok("/notes/Проекты/план.md".into())
        );
        assert_eq!(
            write(
                &place,
                &disk,
                &Memo::default(),
                &Album::default(),
                &edit("план.md", "текст")
            ),
            Ok(())
        );
        assert_eq!(disk.0.borrow()[0].0, PathBuf::from("/notes/план.md"));
    }

    #[test]
    fn путь_наружу_и_не_заметка_до_диска_не_доходят() {
        let disk = Recorder::default();
        let journal = Memo::default();
        let place = chosen("/notes");

        assert_eq!(
            read(&place, &disk, "../../.ssh/id_rsa"),
            Err(AppError::invalid("path_invalid"))
        );
        let history = Album::default();

        assert_eq!(
            write(
                &place,
                &disk,
                &journal,
                &history,
                &edit("../соседи/план.md", "текст")
            ),
            Err(AppError::invalid("path_invalid"))
        );
        assert_eq!(
            write(
                &place,
                &disk,
                &journal,
                &history,
                &edit(".obsidian/app.json", "{}")
            ),
            Err(AppError::invalid("path_invalid"))
        );
        assert!(disk.0.borrow().is_empty());
        assert!(journal.0.borrow().is_empty());
    }

    #[test]
    fn записанная_правка_уходит_из_журнала_незаписанная_остаётся() {
        let journal = Memo::default();
        let place = chosen("/notes");

        let history = Album::default();

        write(
            &place,
            &Recorder::default(),
            &journal,
            &history,
            &edit("план.md", "раз"),
        )
        .unwrap();
        assert!(journal.0.borrow().is_empty());

        assert_eq!(
            write(
                &place,
                &Changed::default(),
                &journal,
                &history,
                &edit("план.md", "два")
            ),
            Err(AppError::conflict("note_conflict"))
        );
        assert_eq!(
            unsaved(&place, &Changed::default(), &journal),
            Ok(vec![edit("план.md", "два")])
        );
    }

    #[test]
    fn журнал_забывает_правки_старше_недели_и_по_отказу() {
        let journal = Memo::default();
        let place = chosen("/notes");
        let disk = Changed::default();
        journal.0.borrow_mut().extend([
            (
                edit("старое.md", "старое"),
                JOURNAL_KEEP + Duration::from_secs(1),
            ),
            (edit("свежее.md", "свежее"), Duration::from_secs(60)),
        ]);

        assert_eq!(
            unsaved(&place, &disk, &journal),
            Ok(vec![edit("свежее.md", "свежее")])
        );
        assert_eq!(journal.0.borrow().len(), 1);

        forget_unsaved(&place, &disk, &journal, "свежее.md").unwrap();
        assert!(journal.0.borrow().is_empty());
    }

    #[test]
    fn в_корзину_уходит_заметка_или_папка_но_не_корень_и_не_путь_наружу() {
        let disk = Changed::default();
        let place = chosen("/notes");
        let history = Album::default();

        assert_eq!(trash(&place, &disk, &history, "Проекты/план.md"), Ok(()));
        assert_eq!(trash(&place, &disk, &history, "Проекты"), Ok(()));
        assert_eq!(
            trash(&place, &disk, &history, ""),
            Err(AppError::invalid("path_invalid"))
        );
        assert_eq!(
            trash(&place, &disk, &history, ".."),
            Err(AppError::invalid("path_invalid"))
        );
        assert_eq!(
            *disk.0.borrow(),
            vec![
                PathBuf::from("/notes/Проекты/план.md"),
                PathBuf::from("/notes/Проекты")
            ]
        );
    }

    #[test]
    fn первый_запуск_без_выбранной_папки() {
        assert_eq!(status(&Place::default(), &Disk(vec![])), VaultStatus::None);
    }

    #[test]
    fn убранная_папка_помнится_и_не_открывается() {
        let place = chosen("/notes");

        assert_eq!(
            status(&place, &Disk(vec![])),
            VaultStatus::Missing {
                path: "/notes".into()
            }
        );
        assert_eq!(
            tree(&place, &Disk(vec![])),
            Err(AppError::not_found("vault_missing"))
        );
    }

    #[test]
    fn папка_вернулась_на_место_и_хранилище_открылось() {
        let place = chosen("/notes");
        let disk = Disk(vec!["/notes"]);

        assert_eq!(
            status(&place, &disk),
            VaultStatus::Ready {
                path: "/notes".into()
            }
        );
        assert_eq!(tree(&place, &disk).map(|entries| entries.len()), Ok(1));
    }

    #[test]
    fn выбор_запоминается() {
        let place = Place::default();
        let disk = Disk(vec!["/notes"]);

        let status = choose(&place, &disk, Path::new("/notes"));

        assert_eq!(
            status,
            Ok(VaultStatus::Ready {
                path: "/notes".into()
            })
        );
        assert_eq!(place.load(), Some(PathBuf::from("/notes")));
    }

    #[test]
    fn исчезнувшая_до_выбора_папка_не_запоминается() {
        let place = chosen("/old");

        let status = choose(&place, &Disk(vec![]), Path::new("/notes"));

        assert_eq!(status, Err(AppError::not_found("vault_missing")));
        assert_eq!(place.load(), Some(PathBuf::from("/old")));
    }

    #[test]
    fn правка_агента_снимает_каждый_прежний_текст() {
        let place = chosen("/notes");
        let disk = Files::with(&[("план.md", "было")]);
        let history = Album::default();

        put(&place, &disk, &history, "план.md", "стало").unwrap();
        put(&place, &disk, &history, "план.md", "стало ещё").unwrap();

        assert_eq!(disk.text("план.md").as_deref(), Some("стало ещё"));
        assert_eq!(
            history.texts("план.md"),
            [
                (Source::Agent, "стало".to_owned()),
                (Source::Agent, "было".to_owned())
            ]
        );
    }

    #[test]
    fn агент_создаёт_заметку_вместе_с_папками_но_не_вне_хранилища() {
        let place = chosen("/notes");
        let disk = Files::default();
        let history = Album::default();

        put(&place, &disk, &history, "Встречи/2026/ретро.md", "итоги").unwrap();

        assert_eq!(disk.text("Встречи/2026/ретро.md").as_deref(), Some("итоги"));
        assert!(history.texts("Встречи/2026/ретро.md").is_empty());
        assert_eq!(
            put(&place, &disk, &history, "../чужое.md", "x"),
            Err(AppError::invalid("path_invalid"))
        );
    }
}
