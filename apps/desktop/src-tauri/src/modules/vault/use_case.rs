use super::domain::{Entry, EntryKind, check_name, note_file_name, parse_folder_path};
use super::ports::{VaultDisk, VaultPlace};
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
    }

    fn chosen(path: &str) -> Place {
        Place(RefCell::new(Some(path.into())))
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
