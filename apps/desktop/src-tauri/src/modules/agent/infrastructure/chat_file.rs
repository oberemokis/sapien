use crate::durable::{self, file_key};
use crate::error::AppError;
use crate::modules::agent::ports::ChatStore;
use serde_json::{Value, json};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// История чата лежит в папке данных приложения, файл на хранилище:
/// `chats/<хеш пути хранилища>.json`, внутри `{ "messages": [...] }`.
/// В хранилище её нет: она не попадает ни в дерево, ни на облачный диск.
pub struct ChatFile {
    file: PathBuf,
}

impl ChatFile {
    pub fn new(data_dir: &Path, vault: &Path) -> Self {
        let key = file_key(&vault.to_string_lossy());

        Self {
            file: data_dir.join("chats").join(format!("{key}.json")),
        }
    }
}

impl ChatStore for ChatFile {
    fn load(&self) -> Result<Vec<Value>, AppError> {
        let bytes = match fs::read(&self.file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(vec![]),
            Err(_) => return Err(AppError::unavailable("chat_unreadable")),
        };
        let saved: Value =
            serde_json::from_slice(&bytes).map_err(|_| AppError::unavailable("chat_unreadable"))?;

        Ok(saved["messages"].as_array().cloned().unwrap_or_default())
    }

    fn save(&self, messages: &[Value]) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable("chat_unwritable");

        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(unwritable)?;
        }

        let saved = json!({ "messages": messages });

        durable::write(&self.file, saved.to_string().as_bytes()).map_err(unwritable)
    }

    fn clear(&self) -> Result<(), AppError> {
        match fs::remove_file(&self.file) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                Err(AppError::unavailable("chat_unwritable"))
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn у_каждого_хранилища_своя_история() {
        let data = tempfile::tempdir().unwrap();
        let work = ChatFile::new(data.path(), Path::new("/Users/me/Работа"));
        let home = ChatFile::new(data.path(), Path::new("/Users/me/Дом"));
        let messages =
            [json!({ "role": "user", "content": [{ "type": "text", "text": "Привет" }] })];

        assert_eq!(work.load(), Ok(vec![]));

        work.save(&messages).unwrap();

        assert_eq!(work.load(), Ok(messages.to_vec()));
        assert_eq!(home.load(), Ok(vec![]));

        work.clear().unwrap();
        work.clear().unwrap();

        assert_eq!(work.load(), Ok(vec![]));
    }
}
