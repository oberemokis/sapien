use crate::durable;
use crate::error::AppError;
use crate::modules::agent::domain::{Session, SessionInfo};
use crate::modules::agent::ports::Sessions;
use serde_json::Value;
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

/// Сессии лежат в папке данных приложения, файл на сессию:
/// `sessions/<id>.json`, внутри `{ id, project, title, created, updated,
/// claude }`. В папке проекта их нет: они не попадают ни в git, ни на
/// облачный диск.
pub struct SessionsDir {
    dir: PathBuf,
}

impl SessionsDir {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("sessions"),
        }
    }

    /// Файл сессии. Имя приходит из окна, и с `/` или `..` оно увело бы
    /// запись из папки сессий: такой сессии просто нет.
    fn file(&self, id: &str) -> Option<PathBuf> {
        let plain = !id.is_empty()
            && id
                .chars()
                .all(|char| char.is_ascii_alphanumeric() || char == '-');

        plain.then(|| self.dir.join(format!("{id}.json")))
    }
}

impl Sessions for SessionsDir {
    /// Нечитаемый файл в списке пропускается: остальные сессии от него
    /// не пропадают.
    fn list(&self) -> Result<Vec<SessionInfo>, AppError> {
        let items = match fs::read_dir(&self.dir) {
            Ok(items) => items,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(vec![]),
            Err(_) => return Err(AppError::unavailable("session_unreadable")),
        };

        Ok(items
            .filter_map(|item| {
                let path = item.ok()?.path();

                if path.extension()? != "json" {
                    return None;
                }

                serde_json::from_slice(&fs::read(path).ok()?).ok()
            })
            .collect())
    }

    fn load(&self, id: &str) -> Result<Session, AppError> {
        let missing = AppError::not_found("session_missing");
        let bytes = match fs::read(self.file(id).ok_or(missing)?) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Err(AppError::not_found("session_missing"));
            }
            Err(_) => return Err(AppError::unavailable("session_unreadable")),
        };

        serde_json::from_slice(&bytes).map_err(|_| AppError::unavailable("session_unreadable"))
    }

    fn save(&self, session: &Session) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable("session_unwritable");
        let file = self
            .file(&session.id)
            .ok_or(AppError::invalid("session_invalid"))?;
        let saved =
            serde_json::to_vec(session).map_err(|_| AppError::unavailable("session_unwritable"))?;

        fs::create_dir_all(&self.dir).map_err(unwritable)?;
        durable::write(&file, &saved).map_err(unwritable)
    }

    fn delete(&self, id: &str) -> Result<(), AppError> {
        let Some(file) = self.file(id) else {
            return Ok(());
        };

        match fs::remove_file(file) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                Err(AppError::unavailable("session_unwritable"))
            }
            _ => Ok(()),
        }
    }
}

/// Шаг переноса данных из формата 1 в 2 (`data_format.rs`): историю чата
/// sapien больше не держит, разговор хранит Claude Code. Файл сессии
/// с историей `chat` целиком уходит в `sessions/archive`, а на его месте
/// остаётся сессия с id разговора Claude Code в `claude`. Файл без `chat`
/// уже перенесён или сессия не говорила, он остаётся как есть: оборванный
/// шаг повторяется без вреда. Нечитаемый файл список и так пропускает.
pub fn without_chat(data_dir: &Path) -> io::Result<()> {
    let dir = data_dir.join("sessions");
    let archive = dir.join("archive");
    let items = match fs::read_dir(&dir) {
        Ok(items) => items,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };

    for item in items {
        let path = item?.path();
        let (Some(name), Some("json")) = (
            path.file_name(),
            path.extension().and_then(|ext| ext.to_str()),
        ) else {
            continue;
        };
        let old = fs::read(&path)?;
        let Ok(Value::Object(mut session)) = serde_json::from_slice(&old) else {
            continue;
        };
        let Some(chat) = session.remove("chat") else {
            continue;
        };

        for gone in ["provider", "model", "effort"] {
            session.remove(gone);
        }

        if let Some(id) = chat["session"]["id"].as_str() {
            session.insert("claude".into(), id.into());
        }

        fs::create_dir_all(&archive)?;
        durable::write(&archive.join(name), &old)?;
        durable::write(&path, &serde_json::to_vec(&session)?)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session(id: &str, project: &str) -> Session {
        Session {
            id: id.into(),
            project: project.into(),
            title: "Почини сборку".into(),
            created: 1,
            updated: 2,
            claude: Some("4f1c".into()),
        }
    }

    /// Сессия, как она лежит в файле. Нет файла, значит, `None`.
    fn saved(data: &Path, id: &str) -> Option<Session> {
        let file = data.join("sessions").join(format!("{id}.json"));

        serde_json::from_slice(&fs::read(file).ok()?).ok()
    }

    #[test]
    fn сессия_переживает_перезапуск_и_удаляется() {
        let data = tempfile::tempdir().unwrap();
        let store = SessionsDir::new(data.path());

        assert_eq!(store.list(), Ok(vec![]));

        store.save(&session("a1", "p1")).unwrap();
        store.save(&Session::new("b2".into(), "p2", 5)).unwrap();
        // Чужой и испорченный файлы в папке список не ломают.
        fs::write(data.path().join("sessions/notes.txt"), "").unwrap();
        fs::write(data.path().join("sessions/c3.json"), "{").unwrap();

        let again = SessionsDir::new(data.path());
        let mut listed = again.list().unwrap();

        listed.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(
            listed,
            [
                session("a1", "p1").info(),
                Session::new("b2".into(), "p2", 5).info()
            ]
        );
        assert_eq!(saved(data.path(), "a1"), Some(session("a1", "p1")));
        assert_eq!(saved(data.path(), "b2").unwrap().claude, None);

        again.delete("a1").unwrap();
        again.delete("a1").unwrap();
        assert_eq!(saved(data.path(), "a1"), None);
    }

    #[test]
    fn имя_сессии_не_уводит_из_папки_сессий() {
        let data = tempfile::tempdir().unwrap();
        let store = SessionsDir::new(&data.path().join("app"));

        fs::write(data.path().join("секрет.json"), "{}").unwrap();

        assert_eq!(
            store.save(&session("../x", "p1")),
            Err(AppError::invalid("session_invalid"))
        );
        store.delete("../../секрет").unwrap();
        assert!(data.path().join("секрет.json").exists());
    }

    #[test]
    fn история_чата_уходит_в_архив_а_сессия_помнит_разговор_claude_code() {
        let data = tempfile::tempdir().unwrap();
        let dir = data.path().join("sessions");
        let talked = json!({
            "id": "a1", "project": "p1", "title": "Почини сборку", "created": 1, "updated": 2,
            "provider": "claude", "model": "opus[1m]", "effort": "high",
            "chat": {
                "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Почини сборку" }] }],
                "session": { "id": "4f1c", "seen": { "len": 10, "modified": 20 } },
            },
        });
        let silent = json!({
            "id": "b2", "project": "p2", "title": "", "created": 3, "updated": 3,
            "provider": "claude", "chat": { "messages": [] },
        });
        let written = |name: &str| -> Option<Value> {
            serde_json::from_slice(&fs::read(dir.join(name)).ok()?).ok()
        };

        // Новая установка: сессий ещё нет.
        without_chat(data.path()).unwrap();
        assert!(!dir.exists());

        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a1.json"), talked.to_string()).unwrap();
        fs::write(dir.join("b2.json"), silent.to_string()).unwrap();
        fs::write(dir.join("c3.json"), "{").unwrap();
        fs::write(dir.join("notes.txt"), "заметка").unwrap();

        without_chat(data.path()).unwrap();
        // Оборванный шаг следующий запуск проходит заново.
        without_chat(data.path()).unwrap();

        assert_eq!(written("archive/a1.json"), Some(talked));
        assert_eq!(written("archive/b2.json"), Some(silent));
        assert_eq!(
            written("a1.json"),
            Some(
                json!({ "id": "a1", "project": "p1", "title": "Почини сборку", "created": 1, "updated": 2, "claude": "4f1c" })
            )
        );
        assert_eq!(
            written("b2.json"),
            Some(json!({ "id": "b2", "project": "p2", "title": "", "created": 3, "updated": 3 }))
        );
        assert_eq!(fs::read_to_string(dir.join("c3.json")).unwrap(), "{");
        assert_eq!(
            fs::read_to_string(dir.join("notes.txt")).unwrap(),
            "заметка"
        );

        assert_eq!(
            saved(data.path(), "a1").unwrap().claude.as_deref(),
            Some("4f1c")
        );
        // Архив в список сессий не попадает.
        assert_eq!(SessionsDir::new(data.path()).list().unwrap().len(), 2);
    }
}
