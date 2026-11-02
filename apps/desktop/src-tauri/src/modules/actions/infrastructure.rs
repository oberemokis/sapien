use super::domain::ActionFile;
use super::ports::Folder;
use crate::durable;
use crate::error::AppError;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Папка `actions/` в папке данных приложения, файл на действие.
pub struct ActionsDir {
    dir: PathBuf,
}

impl ActionsDir {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("actions"),
        }
    }
}

impl Folder for ActionsDir {
    /// Только видимые файлы `.md`: временный файл записи (durable.rs)
    /// скрыт точкой. Нечитаемый файл список не ломает.
    fn list(&self) -> Result<Vec<ActionFile>, AppError> {
        let items = match fs::read_dir(&self.dir) {
            Ok(items) => items,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(vec![]),
            Err(_) => return Err(AppError::unavailable("actions_unreadable")),
        };

        Ok(items
            .filter_map(|item| {
                let item = item.ok()?;
                let path = item.file_name().into_string().ok()?;

                if path.starts_with('.') || !path.ends_with(".md") || !item.path().is_file() {
                    return None;
                }

                let text = fs::read_to_string(item.path()).ok()?;

                Some(ActionFile { path, text })
            })
            .collect())
    }

    fn exists(&self, path: &str) -> bool {
        self.dir.join(path).exists()
    }

    fn write(&self, path: &str, text: &str) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable("action_unwritable");

        fs::create_dir_all(&self.dir).map_err(unwritable)?;
        durable::write(&self.dir.join(path), text.as_bytes()).map_err(unwritable)
    }

    fn delete(&self, path: &str) -> Result<(), AppError> {
        match fs::remove_file(self.dir.join(path)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => {
                Err(AppError::not_found("action_missing"))
            }
            Err(_) => Err(AppError::unavailable("action_unwritable")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn действия_лежат_файлами_в_своей_папке() {
        let data = tempfile::tempdir().unwrap();
        let folder = ActionsDir::new(data.path());

        assert_eq!(folder.list(), Ok(vec![]));

        folder.write("Сводка.md", "---\n---\nСобери").unwrap();
        fs::write(data.path().join("actions/заметка.txt"), "").unwrap();
        fs::create_dir(data.path().join("actions/папка.md")).unwrap();

        assert!(folder.exists("Сводка.md"));
        assert_eq!(
            folder.list(),
            Ok(vec![ActionFile {
                path: "Сводка.md".into(),
                text: "---\n---\nСобери".into(),
            }])
        );

        folder.delete("Сводка.md").unwrap();

        assert!(!folder.exists("Сводка.md"));
        assert_eq!(
            folder.delete("Сводка.md"),
            Err(AppError::not_found("action_missing"))
        );
    }
}
