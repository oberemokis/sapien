use crate::durable;
use crate::error::AppError;
use crate::modules::agent::domain::{Session, SessionInfo};
use crate::modules::agent::ports::Sessions;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Сессии лежат в папке данных приложения, файл на сессию:
/// `sessions/<id>.json`, внутри `{ id, project, title, created, updated,
/// chat }`. В папке проекта их нет: они не попадают ни в git, ни на
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::agent::domain::{Chat, ClaudeSession, Stamp};
    use serde_json::json;

    fn session(id: &str, project: &str) -> Session {
        Session {
            id: id.into(),
            project: project.into(),
            title: "Почини сборку".into(),
            created: 1,
            updated: 2,
            provider: "claude".into(),
            model: Some("opus[1m]".into()),
            effort: Some("high".into()),
            chat: Chat {
                messages: vec![
                    json!({ "role": "user", "content": [{ "type": "text", "text": "Привет" }] }),
                ],
                session: Some(ClaudeSession {
                    id: "4f1c".into(),
                    seen: Some(Stamp {
                        len: 10,
                        modified: 20,
                    }),
                }),
            },
        }
    }

    #[test]
    fn сессия_переживает_перезапуск_и_удаляется() {
        let data = tempfile::tempdir().unwrap();
        let store = SessionsDir::new(data.path());

        assert_eq!(store.list(), Ok(vec![]));
        assert_eq!(
            store.load("a1"),
            Err(AppError::not_found("session_missing"))
        );

        store.save(&session("a1", "p1")).unwrap();
        store.save(&session("b2", "p2")).unwrap();
        // Чужой и испорченный файлы в папке список не ломают.
        fs::write(data.path().join("sessions/notes.txt"), "").unwrap();
        fs::write(data.path().join("sessions/c3.json"), "{").unwrap();

        let again = SessionsDir::new(data.path());
        let mut listed = again.list().unwrap();

        listed.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(
            listed,
            [session("a1", "p1").info(), session("b2", "p2").info()]
        );
        assert_eq!(again.load("a1"), Ok(session("a1", "p1")));
        // Сессия с сообщениями начата, и список видит это без истории.
        assert!(listed.iter().all(|info| info.started));

        // Сессии из версии без выбора агента: агент Claude Code, модели нет.
        // Пустая не начата, а с сообщениями начата и без модели.
        fs::write(
            data.path().join("sessions/d4.json"),
            r#"{"id":"d4","project":"p1","title":"","created":1,"updated":1}"#,
        )
        .unwrap();
        fs::write(
            data.path().join("sessions/e5.json"),
            r#"{"id":"e5","project":"p1","title":"Привет","created":1,"updated":1,"chat":{"messages":[{"role":"user","content":[]}]}}"#,
        )
        .unwrap();

        let old = again.load("d4").unwrap().info();
        let talked = again.load("e5").unwrap().info();

        assert_eq!(
            (
                old.provider.as_str(),
                old.model.clone(),
                old.effort.clone(),
                old.started
            ),
            ("claude", None, None, false)
        );
        assert_eq!((talked.model.clone(), talked.started), (None, true));
        assert!(again.list().unwrap().contains(&old));
        assert!(again.list().unwrap().contains(&talked));

        again.delete("a1").unwrap();
        again.delete("a1").unwrap();
        assert_eq!(
            again.load("a1"),
            Err(AppError::not_found("session_missing"))
        );
    }

    #[test]
    fn имя_сессии_не_уводит_из_папки_сессий() {
        let data = tempfile::tempdir().unwrap();
        let store = SessionsDir::new(&data.path().join("app"));

        fs::write(data.path().join("секрет.json"), "{}").unwrap();

        assert_eq!(
            store.load("../../секрет"),
            Err(AppError::not_found("session_missing"))
        );
        assert_eq!(
            store.save(&session("../x", "p1")),
            Err(AppError::invalid("session_invalid"))
        );
        store.delete("../../секрет").unwrap();
        assert!(data.path().join("секрет.json").exists());
    }
}
