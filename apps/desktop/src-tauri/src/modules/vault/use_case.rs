use super::domain::Entry;
use super::ports::{VaultDisk, VaultPlace};
use crate::error::AppError;
use serde::Serialize;
use std::path::Path;

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

pub fn tree(place: &impl VaultPlace, disk: &impl VaultDisk) -> Result<Vec<Entry>, AppError> {
    let root = place
        .load()
        .ok_or(AppError::not_found("vault_not_chosen"))?;

    if !disk.is_dir(&root) {
        return Err(AppError::not_found("vault_missing"));
    }

    disk.list(&root)
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
    }

    fn chosen(path: &str) -> Place {
        Place(RefCell::new(Some(path.into())))
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
