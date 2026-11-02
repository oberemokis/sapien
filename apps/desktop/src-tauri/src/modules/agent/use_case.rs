use super::domain::{Session, SessionInfo};
use super::ports::{Projects, Sessions};
use crate::error::AppError;
use std::cmp::Reverse;

/// Сессии всех проектов, свежие первыми.
pub fn sessions(store: &impl Sessions) -> Result<Vec<SessionInfo>, AppError> {
    let mut sessions = store.list()?;

    sessions.sort_by_key(|session| Reverse(session.updated));
    Ok(sessions)
}

/// Новая пустая сессия `id` в проекте `project`, заведённая в `now`.
pub fn new_session(
    store: &impl Sessions,
    projects: &impl Projects,
    project: &str,
    id: String,
    now: u64,
) -> Result<SessionInfo, AppError> {
    if projects.folder(project).is_none() {
        return Err(AppError::not_found("project_missing"));
    }

    let session = Session::new(id, project, now);

    store.save(&session)?;
    Ok(session.info())
}

/// Удаляет сессию `id`. По ней отвечает агент (`running`), и она остаётся:
/// ответ записал бы её заново.
pub fn delete_session(
    store: &impl Sessions,
    running: impl Fn(&str) -> bool,
    id: &str,
) -> Result<(), AppError> {
    if running(id) {
        return Err(AppError::conflict("agent_busy"));
    }

    store.delete(id)
}

/// Удаляет сессии проекта, который убирают из списка. Отвечает агент
/// хоть в одной из них, и не удаляется ни одна.
pub fn forget_project(
    store: &impl Sessions,
    running: impl Fn(&str) -> bool,
    project: &str,
) -> Result<(), AppError> {
    let doomed: Vec<SessionInfo> = store
        .list()?
        .into_iter()
        .filter(|session| session.project == project)
        .collect();

    if doomed.iter().any(|session| running(&session.id)) {
        return Err(AppError::conflict("agent_busy"));
    }

    doomed
        .iter()
        .try_for_each(|session| store.delete(&session.id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, HashMap};
    use std::path::PathBuf;
    use std::sync::Mutex;

    /// Проекты, у которых папка на месте. Остальных для агента нет.
    struct FakeProjects(HashMap<&'static str, PathBuf>);

    impl Default for FakeProjects {
        fn default() -> Self {
            Self(HashMap::from([
                ("p1", PathBuf::from("/код/sapien")),
                ("p2", PathBuf::from("/код/сайт")),
            ]))
        }
    }

    impl Projects for FakeProjects {
        fn folder(&self, id: &str) -> Option<PathBuf> {
            self.0.get(id).cloned()
        }
    }

    #[derive(Default)]
    struct FakeSessions(Mutex<BTreeMap<String, Session>>);

    impl FakeSessions {
        fn ids(&self) -> Vec<String> {
            self.0.lock().unwrap().keys().cloned().collect()
        }
    }

    impl Sessions for FakeSessions {
        fn list(&self) -> Result<Vec<SessionInfo>, AppError> {
            Ok(self.0.lock().unwrap().values().map(Session::info).collect())
        }

        fn save(&self, session: &Session) -> Result<(), AppError> {
            self.0
                .lock()
                .unwrap()
                .insert(session.id.clone(), session.clone());
            Ok(())
        }

        fn delete(&self, id: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
    }

    #[test]
    fn сессия_заводится_только_в_проекте_с_папкой() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();

        assert_eq!(
            new_session(&store, &projects, "p9", "s2".into(), 1),
            Err(AppError::not_found("project_missing"))
        );
        assert_eq!(
            new_session(&store, &projects, "p1", "s1".into(), 1),
            Ok(SessionInfo {
                id: "s1".into(),
                project: "p1".into(),
                title: String::new(),
                updated: 1,
                answering: false,
            })
        );
        assert_eq!(
            store.0.lock().unwrap().get("s1"),
            Some(&Session::new("s1".into(), "p1", 1))
        );
        assert_eq!(store.ids(), ["s1"]);
    }

    #[test]
    fn список_сессий_от_свежих_к_старым() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();

        new_session(&store, &projects, "p1", "a".into(), 5).unwrap();
        new_session(&store, &projects, "p2", "b".into(), 9).unwrap();
        new_session(&store, &projects, "p1", "c".into(), 1).unwrap();

        let ids: Vec<String> = sessions(&store)
            .unwrap()
            .into_iter()
            .map(|session| session.id)
            .collect();

        assert_eq!(ids, ["b", "a", "c"]);
    }

    #[test]
    fn занятую_сессию_и_проект_с_ней_не_удалить() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();

        for (id, project) in [("a", "p1"), ("b", "p1"), ("c", "p2")] {
            new_session(&store, &projects, project, id.into(), 1).unwrap();
        }

        let busy = Err(AppError::conflict("agent_busy"));
        // Агент отвечает в двух сессиях сразу.
        let running = |id: &str| ["b", "c"].contains(&id);

        assert_eq!(delete_session(&store, running, "b"), busy);
        assert_eq!(delete_session(&store, running, "c"), busy);
        assert_eq!(forget_project(&store, running, "p1"), busy);
        assert_eq!(store.ids(), ["a", "b", "c"]);

        // Свободная сессия рядом с занятыми удаляется.
        delete_session(&store, running, "a").unwrap();
        assert_eq!(store.ids(), ["b", "c"]);

        // Агент отвечает только в другом проекте: этот убирается целиком.
        forget_project(&store, |id| id == "c", "p1").unwrap();
        assert_eq!(store.ids(), ["c"]);

        delete_session(&store, |id| id == "a", "c").unwrap();
        assert!(store.ids().is_empty());
    }
}
