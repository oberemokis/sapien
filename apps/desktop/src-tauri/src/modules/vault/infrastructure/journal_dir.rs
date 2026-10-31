use crate::durable::file_key;
use crate::error::AppError;
use crate::modules::vault::domain::Unsaved;
use crate::modules::vault::ports::Journal;
use crate::sealed;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Журнал лежит в папке данных приложения, а не в хранилище: облачный диск
/// не унесёт чужие недописанные правки на другой компьютер. Папка на каждое
/// хранилище, файл на каждую заметку, имена из хеша пути, текст зашифрован
/// (sealed.rs).
pub struct JournalDir {
    dir: PathBuf,
}

impl JournalDir {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("journal"),
        }
    }

    fn vault_dir(&self, vault: &Path) -> PathBuf {
        self.dir.join(file_key(&vault.to_string_lossy()))
    }

    fn file(&self, vault: &Path, path: &str) -> PathBuf {
        self.vault_dir(vault)
            .join(format!("{}.json", file_key(path)))
    }
}

impl Journal for JournalDir {
    fn put(&self, vault: &Path, unsaved: &Unsaved) -> Result<(), AppError> {
        let json =
            serde_json::to_vec(unsaved).map_err(|_| AppError::unavailable("journal_unwritable"))?;

        fs::create_dir_all(self.vault_dir(vault))
            .and_then(|()| sealed::write(&self.file(vault, &unsaved.path), &json))
            .map_err(|_| AppError::unavailable("journal_unwritable"))
    }

    fn remove(&self, vault: &Path, path: &str) {
        let _ = fs::remove_file(self.file(vault, path));
    }

    fn list(&self, vault: &Path) -> Vec<(Unsaved, Duration)> {
        let Ok(items) = fs::read_dir(self.vault_dir(vault)) else {
            return Vec::new();
        };

        // Испорченную запись пропускаем: одна битая правка не должна
        // прятать остальные.
        items
            .flatten()
            .filter(|item| item.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|item| {
                let unsaved = serde_json::from_slice(&sealed::read(&item.path()).ok()?).ok()?;
                let age = item
                    .metadata()
                    .ok()?
                    .modified()
                    .ok()?
                    .elapsed()
                    .unwrap_or_default();

                Some((unsaved, age))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(path: &str, text: &str) -> Unsaved {
        Unsaved {
            path: path.into(),
            base: Some("было".into()),
            text: text.into(),
        }
    }

    #[test]
    fn правки_живут_до_удаления_и_по_хранилищам() {
        let data = tempfile::tempdir().unwrap();
        let journal = JournalDir::new(data.path());
        let work = Path::new("/Users/me/Работа");
        let home = Path::new("/Users/me/Дом");

        journal.put(work, &edit("план.md", "первая")).unwrap();
        journal.put(work, &edit("план.md", "вторая")).unwrap();
        journal.put(home, &edit("план.md", "дома")).unwrap();

        let texts = |vault| -> Vec<String> {
            JournalDir::new(data.path())
                .list(vault)
                .into_iter()
                .map(|(unsaved, _)| unsaved.text)
                .collect()
        };
        assert_eq!(texts(work), ["вторая"]);
        assert_eq!(texts(home), ["дома"]);

        journal.remove(work, "план.md");
        assert!(texts(work).is_empty());
    }

    #[test]
    fn битая_запись_не_прячет_остальные() {
        let data = tempfile::tempdir().unwrap();
        let journal = JournalDir::new(data.path());
        let vault = Path::new("/Users/me/Заметки");

        journal.put(vault, &edit("план.md", "текст")).unwrap();
        fs::write(journal.file(vault, "сломано.md"), "{не json").unwrap();

        assert_eq!(journal.list(vault).len(), 1);
    }
}
