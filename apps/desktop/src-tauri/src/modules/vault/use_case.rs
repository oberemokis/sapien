use super::domain::{
    Entry, EntryKind, JOURNAL_KEEP, Unsaved, check_name, note_file_name, note_paths,
    parse_folder_path, parse_note_path,
};
use super::ports::{Journal, VaultDisk, VaultPlace};
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

/// Правка сначала ложится в журнал восстановления, потом в файл, и только
/// после записи файла уходит из журнала. Упало приложение посреди записи,
/// отказал диск, файл изменили снаружи: правка остаётся в журнале.
/// Журнал запись не держит: не вышло записать в него, файл всё равно пишется.
pub fn write(
    place: &impl VaultPlace,
    disk: &impl VaultDisk,
    journal: &impl Journal,
    unsaved: &Unsaved,
) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let file = note_at(place, disk, &unsaved.path)?;
    let _ = journal.put(&root, unsaved);

    disk.write(&file, &unsaved.text, unsaved.base.as_deref())?;
    journal.remove(&root, &unsaved.path);

    Ok(())
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
/// и путь наружу до диска не доходят.
pub fn trash(place: &impl VaultPlace, disk: &impl VaultDisk, path: &str) -> Result<(), AppError> {
    let root = open_root(place, disk)?;
    let path = parse_note_path(path)
        .or_else(|| parse_folder_path(path).filter(|folder| !folder.is_empty()))
        .ok_or(AppError::invalid("path_invalid"))?;

    disk.trash(&root.join(path))
}

/// Текст заметки для разбора в интерфейсе: теги и всё, что ищется по тексту.
#[derive(Debug, PartialEq, Serialize)]
pub struct NoteText {
    path: String,
    text: String,
}

/// Тексты всех заметок хранилища разом. Заметку, которую не прочитать
/// (её удалили между списком и чтением, на неё нет прав), пропускаем:
/// список без неё полезнее ошибки на всё хранилище.
pub fn texts(place: &impl VaultPlace, disk: &impl VaultDisk) -> Result<Vec<NoteText>, AppError> {
    let root = open_root(place, disk)?;

    Ok(note_paths(&disk.list(&root)?)
        .into_iter()
        .filter_map(|path| {
            let text = disk.read(&root.join(&path)).ok()?;

            Some(NoteText { path, text })
        })
        .collect())
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
    }

    fn chosen(path: &str) -> Place {
        Place(RefCell::new(Some(path.into())))
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
            write(&place, &disk, &Memo::default(), &edit("план.md", "текст")),
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
        assert_eq!(
            write(&place, &disk, &journal, &edit("../соседи/план.md", "текст")),
            Err(AppError::invalid("path_invalid"))
        );
        assert_eq!(
            write(&place, &disk, &journal, &edit(".obsidian/app.json", "{}")),
            Err(AppError::invalid("path_invalid"))
        );
        assert!(disk.0.borrow().is_empty());
        assert!(journal.0.borrow().is_empty());
    }

    #[test]
    fn записанная_правка_уходит_из_журнала_незаписанная_остаётся() {
        let journal = Memo::default();
        let place = chosen("/notes");

        write(
            &place,
            &Recorder::default(),
            &journal,
            &edit("план.md", "раз"),
        )
        .unwrap();
        assert!(journal.0.borrow().is_empty());

        assert_eq!(
            write(
                &place,
                &Changed::default(),
                &journal,
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

        assert_eq!(trash(&place, &disk, "Проекты/план.md"), Ok(()));
        assert_eq!(trash(&place, &disk, "Проекты"), Ok(()));
        assert_eq!(
            trash(&place, &disk, ""),
            Err(AppError::invalid("path_invalid"))
        );
        assert_eq!(
            trash(&place, &disk, ".."),
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
}
