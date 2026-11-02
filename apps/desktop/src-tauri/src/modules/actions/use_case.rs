use super::domain::{ActionFile, file_name, parse_path};
use super::ports::Folder;
use crate::error::AppError;

/// Действия по имени файла.
pub fn list(folder: &impl Folder) -> Result<Vec<ActionFile>, AppError> {
    let mut actions = folder.list()?;

    actions.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(actions)
}

/// Новое действие `name` с текстом `text`. Отдаёт имя его файла.
/// Прежнее действие с тем же именем не затирается.
pub fn create(folder: &impl Folder, name: &str, text: &str) -> Result<String, AppError> {
    let path = file_name(name)?;

    if folder.exists(&path) {
        return Err(AppError::conflict("name_taken"));
    }

    folder.write(&path, text)?;
    Ok(path)
}

/// Новый текст действия. Действие удалили, и правка его не воскрешает.
pub fn write(folder: &impl Folder, path: &str, text: &str) -> Result<(), AppError> {
    let path = parse_path(path)?;

    if !folder.exists(path) {
        return Err(AppError::not_found("action_missing"));
    }

    folder.write(path, text)
}

pub fn delete(folder: &impl Folder, path: &str) -> Result<(), AppError> {
    folder.delete(parse_path(path)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    /// Папка в памяти. Имена сравниваются без регистра, как на диске macOS.
    #[derive(Default)]
    struct FakeFolder(Mutex<BTreeMap<String, String>>);

    impl FakeFolder {
        fn text(&self, path: &str) -> Option<String> {
            self.0.lock().unwrap().get(path).cloned()
        }
    }

    impl Folder for FakeFolder {
        fn list(&self) -> Result<Vec<ActionFile>, AppError> {
            Ok(self
                .0
                .lock()
                .unwrap()
                .iter()
                .rev()
                .map(|(path, text)| ActionFile {
                    path: path.clone(),
                    text: text.clone(),
                })
                .collect())
        }

        fn exists(&self, path: &str) -> bool {
            self.0
                .lock()
                .unwrap()
                .keys()
                .any(|known| known.to_lowercase() == path.to_lowercase())
        }

        fn write(&self, path: &str, text: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(path.into(), text.into());
            Ok(())
        }

        fn delete(&self, path: &str) -> Result<(), AppError> {
            self.0
                .lock()
                .unwrap()
                .remove(path)
                .map(drop)
                .ok_or(AppError::not_found("action_missing"))
        }
    }

    #[test]
    fn действие_создаётся_под_свободным_именем() {
        let folder = FakeFolder::default();

        assert_eq!(
            create(&folder, " Сводка ", "---\nmodel: opus\n---\nСобери"),
            Ok("Сводка.md".into())
        );
        assert_eq!(create(&folder, "Ревью", ""), Ok("Ревью.md".into()));
        assert_eq!(
            create(&folder, "сводка", "поверх"),
            Err(AppError::conflict("name_taken"))
        );
        assert_eq!(
            folder.text("Сводка.md").as_deref(),
            Some("---\nmodel: opus\n---\nСобери")
        );

        let paths: Vec<String> = list(&folder)
            .unwrap()
            .into_iter()
            .map(|action| action.path)
            .collect();

        assert_eq!(paths, ["Ревью.md", "Сводка.md"]);
    }

    #[test]
    fn запрещённое_имя_не_доходит_до_папки() {
        let folder = FakeFolder::default();
        let code = |name: &str| create(&folder, name, "").map_err(|error| error.code);

        assert_eq!(code(""), Err("name_empty"));
        assert_eq!(code("../Сводка"), Err("name_forbidden"));
        assert_eq!(code(".Сводка"), Err("name_hidden"));
        assert!(list(&folder).unwrap().is_empty());
    }

    #[test]
    fn правка_и_удаление_только_существующего_действия() {
        let folder = FakeFolder::default();

        create(&folder, "Сводка", "было").unwrap();
        write(&folder, "Сводка.md", "стало").unwrap();

        assert_eq!(folder.text("Сводка.md").as_deref(), Some("стало"));
        assert_eq!(
            write(&folder, "Нет.md", "текст"),
            Err(AppError::not_found("action_missing"))
        );
        assert_eq!(
            write(&folder, "../Сводка.md", "текст"),
            Err(AppError::invalid("name_forbidden"))
        );

        delete(&folder, "Сводка.md").unwrap();

        assert_eq!(
            delete(&folder, "Сводка.md"),
            Err(AppError::not_found("action_missing"))
        );
        assert_eq!(
            write(&folder, "Сводка.md", "снова"),
            Err(AppError::not_found("action_missing"))
        );
        assert_eq!(folder.text("Нет.md"), None);
    }
}
