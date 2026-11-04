use crate::durable;
use crate::error::AppError;
use crate::modules::agent::domain::{Conversation, Session, SessionInfo};
use crate::modules::agent::ports::Sessions;
use serde_json::Value;
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

/// Сессии лежат в папке данных приложения, файл на сессию:
/// `sessions/<id>.json`, внутри `{ id, project, title, created, updated,
/// claude }`, а последние экраны её панелей в `sessions/screens/<id>/<панель>`.
/// В папке проекта их нет: они не попадают ни в git, ни на облачный диск.
pub struct SessionsDir {
    dir: PathBuf,
}

/// Имена сессий и панелей приходят из окна, и с `/` или `..` они увели бы
/// запись из папки сессий: такой сессии или панели просто нет.
fn plain(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-')
}

impl SessionsDir {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("sessions"),
        }
    }

    fn file(&self, id: &str) -> Option<PathBuf> {
        plain(id).then(|| self.dir.join(format!("{id}.json")))
    }

    fn screens(&self, session: &str) -> Option<PathBuf> {
        plain(session).then(|| self.dir.join("screens").join(session))
    }

    fn screen_file(&self, session: &str, pane: &str) -> Option<PathBuf> {
        Some(self.screens(session)?.join(pane)).filter(|_| plain(pane))
    }

    /// Вывод терминала панели `pane` сессии `session`, каким он был, когда
    /// терминал кончился.
    pub fn screen(&self, session: &str, pane: &str) -> Option<Vec<u8>> {
        fs::read(self.screen_file(session, pane)?).ok()
    }

    pub fn save_screen(&self, session: &str, pane: &str, bytes: &[u8]) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable("session_unwritable");
        let (Some(dir), Some(file)) = (self.screens(session), self.screen_file(session, pane))
        else {
            return Err(AppError::invalid("session_invalid"));
        };

        // Экран из версии без панелей лежит файлом на месте папки.
        if dir.is_file() {
            fs::remove_file(&dir).map_err(unwritable)?;
        }

        fs::create_dir_all(dir).map_err(unwritable)?;
        durable::write(&file, bytes).map_err(unwritable)
    }

    /// Разговор агента панели лежит рядом с её экраном, `<панель>.agent`,
    /// и удаляется вместе с сессией.
    fn conversation_file(&self, session: &str, pane: &str) -> Option<PathBuf> {
        Some(self.screens(session)?.join(format!("{pane}.agent"))).filter(|_| plain(pane))
    }

    /// Разговор, который панель продолжит, когда её оболочка начнётся
    /// заново. Нечитаемый файл значит, что продолжать нечего.
    pub fn conversation(&self, session: &str, pane: &str) -> Option<Conversation> {
        let text = fs::read(self.conversation_file(session, pane)?).ok()?;

        serde_json::from_slice(&text).ok()
    }

    /// `None`: агент из панели ушёл, и продолжать нечего.
    pub fn save_conversation(
        &self,
        session: &str,
        pane: &str,
        conversation: Option<&Conversation>,
    ) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable("session_unwritable");
        let (Some(dir), Some(file)) =
            (self.screens(session), self.conversation_file(session, pane))
        else {
            return Err(AppError::invalid("session_invalid"));
        };

        let Some(conversation) = conversation else {
            return match fs::remove_file(&file) {
                Err(error) if error.kind() != ErrorKind::NotFound => Err(unwritable(error)),
                _ => Ok(()),
            };
        };
        let bytes =
            serde_json::to_vec(conversation).map_err(|_| AppError::invalid("session_invalid"))?;

        if dir.is_file() {
            fs::remove_file(&dir).map_err(unwritable)?;
        }

        fs::create_dir_all(dir).map_err(unwritable)?;
        durable::write(&file, &bytes).map_err(unwritable)
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

    /// Экраны панелей уходят вместе с сессией.
    fn delete(&self, id: &str) -> Result<(), AppError> {
        let (Some(file), Some(screens)) = (self.file(id), self.screens(id)) else {
            return Ok(());
        };
        let gone = |removed: io::Result<()>| match removed {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                Err(AppError::unavailable("session_unwritable"))
            }
            _ => Ok(()),
        };

        // Экран из версии без панелей лежит файлом на месте папки.
        gone(fs::remove_dir_all(&screens).or_else(|_| fs::remove_file(&screens)))?;
        gone(fs::remove_file(file))
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
            named: true,
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

        // Экраны панелей тоже переживают перезапуск, а список не трогают.
        assert_eq!(again.screen("a1", "a1"), None);
        again.save_screen("a1", "a1", b"\x1b[1m$ make\r\n").unwrap();
        again.save_screen("a1", "f00d", b"$ pnpm dev\r\n").unwrap();
        let restarted = SessionsDir::new(data.path());
        assert_eq!(
            restarted.screen("a1", "a1").as_deref(),
            Some(&b"\x1b[1m$ make\r\n"[..])
        );
        assert_eq!(
            restarted.screen("a1", "f00d").as_deref(),
            Some(&b"$ pnpm dev\r\n"[..])
        );
        assert_eq!(again.list().unwrap().len(), 2);

        // Разговор агента панели тоже, пока из агента не вышли.
        let conversation = Conversation {
            agent: "claude".into(),
            id: "4f1c".into(),
            cwd: None,
            transcript: Some("/t/4f1c.jsonl".into()),
        };

        again
            .save_conversation("a1", "f00d", Some(&conversation))
            .unwrap();
        assert_eq!(
            SessionsDir::new(data.path()).conversation("a1", "f00d"),
            Some(conversation.clone())
        );
        assert_eq!(again.conversation("a1", "a1"), None);
        again.save_conversation("a1", "f00d", None).unwrap();
        again.save_conversation("a1", "f00d", None).unwrap();
        assert_eq!(again.conversation("a1", "f00d"), None);
        again
            .save_conversation("a1", "f00d", Some(&conversation))
            .unwrap();

        again.delete("a1").unwrap();
        again.delete("a1").unwrap();
        assert_eq!(saved(data.path(), "a1"), None);
        assert_eq!(again.screen("a1", "a1"), None);
        assert_eq!(again.conversation("a1", "f00d"), None);
        assert!(!data.path().join("sessions/screens/a1").exists());
    }

    #[test]
    fn экран_из_версии_без_панелей_не_мешает_сохранять_и_удалять() {
        let data = tempfile::tempdir().unwrap();
        let store = SessionsDir::new(data.path());
        let old = data.path().join("sessions/screens/a1");

        store.save(&session("a1", "p1")).unwrap();
        fs::create_dir_all(data.path().join("sessions/screens")).unwrap();
        fs::write(&old, b"$ old").unwrap();
        assert_eq!(store.screen("a1", "a1"), None);
        store.save_screen("a1", "a1", b"$ new").unwrap();
        assert_eq!(store.screen("a1", "a1").as_deref(), Some(&b"$ new"[..]));

        store.save(&session("b2", "p1")).unwrap();
        fs::write(data.path().join("sessions/screens/b2"), b"$ old").unwrap();
        store.delete("b2").unwrap();
        assert_eq!(saved(data.path(), "b2"), None);
        assert!(!data.path().join("sessions/screens/b2").exists());
        assert!(old.is_dir());
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

        // Панель с таким именем тоже не уводит экран из папки сессии.
        assert_eq!(
            store.save_screen("a1", "../../../секрет.json", b"x"),
            Err(AppError::invalid("session_invalid"))
        );
        assert_eq!(store.screen("a1", "../../../секрет.json"), None);
        assert_eq!(
            fs::read_to_string(data.path().join("секрет.json")).unwrap(),
            "{}"
        );
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
