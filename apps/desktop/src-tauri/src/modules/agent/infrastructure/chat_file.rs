use crate::durable::file_key;
use crate::error::AppError;
use crate::modules::agent::domain::{Change, Chat};
use crate::modules::agent::ports::ChatStore;
use crate::sealed;
use serde_json::{Value, json};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// История чата лежит в папке данных приложения, файл на хранилище:
/// `chats/<хеш пути хранилища>.json`, внутри `{ "messages": [...],
/// "changes": [...] }`. Файл без `changes` читается с пустым списком.
/// В хранилище её нет: она не попадает ни в дерево, ни на облачный диск.
/// На диске файл зашифрован (sealed.rs).
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
    fn load(&self) -> Result<Chat, AppError> {
        let bytes = match sealed::read(&self.file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Chat::default()),
            Err(_) => return Err(AppError::unavailable("chat_unreadable")),
        };

        serde_json::from_slice(&bytes).map_err(|_| AppError::unavailable("chat_unreadable"))
    }

    fn save(&self, messages: &[Value], changes: &[Change]) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable("chat_unwritable");

        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(unwritable)?;
        }

        let saved = json!({ "messages": messages, "changes": changes });

        sealed::write(&self.file, saved.to_string().as_bytes()).map_err(unwritable)
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
        let changes = [Change {
            turn: 0,
            touched: vec![],
            undone: true,
        }];

        assert_eq!(work.load(), Ok(Chat::default()));

        work.save(&messages, &changes).unwrap();

        assert_eq!(
            work.load(),
            Ok(Chat {
                messages: messages.to_vec(),
                changes: changes.to_vec(),
            })
        );
        assert_eq!(home.load(), Ok(Chat::default()));

        work.clear().unwrap();
        work.clear().unwrap();

        assert_eq!(work.load(), Ok(Chat::default()));
    }

    #[test]
    fn история_до_отката_читается_без_правок() {
        let data = tempfile::tempdir().unwrap();
        let chat = ChatFile::new(data.path(), Path::new("/Users/me/Работа"));
        let messages =
            json!([{ "role": "user", "content": [{ "type": "text", "text": "Привет" }] }]);

        fs::create_dir_all(chat.file.parent().unwrap()).unwrap();
        fs::write(&chat.file, json!({ "messages": messages }).to_string()).unwrap();

        let loaded = chat.load().unwrap();

        assert_eq!(Value::Array(loaded.messages), messages);
        assert!(loaded.changes.is_empty());
    }
}
