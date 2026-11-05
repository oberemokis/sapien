use super::domain::{PaneAgent, Session, SessionInfo, session_name};
use super::ports::{Projects, Sessions};
use sapien_kernel::AppError;
use std::cmp::Reverse;
use std::path::PathBuf;

/// Сессии всех проектов, свежие первыми. `agents`: агенты в панелях
/// сессии.
pub fn sessions(
    store: &impl Sessions,
    agents: impl Fn(&str) -> Vec<PaneAgent>,
) -> Result<Vec<SessionInfo>, AppError> {
    let mut sessions = store.list()?;

    for session in &mut sessions {
        session.agents = agents(&session.id);
        session.answering = session.agents.iter().any(|agent| agent.answering);
    }

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

/// Удаляет сессию `id`. В ней работает агент (`answering`), и она остаётся:
/// посреди работы её не потерять случайно. Иначе её терминал
/// останавливается (`stop`) до удаления.
pub fn delete_session(
    store: &impl Sessions,
    answering: impl Fn(&str) -> bool,
    stop: impl Fn(&str),
    id: &str,
) -> Result<(), AppError> {
    if answering(id) {
        return Err(AppError::conflict("agent_busy"));
    }

    stop(id);
    store.delete(id)
}

/// Удаляет сессии проекта, который убирают из списка. Работает агент
/// хоть в одной из них, и не удаляется ни одна.
pub fn forget_project(
    store: &impl Sessions,
    answering: impl Fn(&str) -> bool,
    stop: impl Fn(&str),
    project: &str,
) -> Result<(), AppError> {
    let doomed: Vec<SessionInfo> = store
        .list()?
        .into_iter()
        .filter(|session| session.project == project)
        .collect();

    if doomed.iter().any(|session| answering(&session.id)) {
        return Err(AppError::conflict("agent_busy"));
    }

    doomed.iter().try_for_each(|session| {
        stop(&session.id);
        store.delete(&session.id)
    })
}

/// Папка проекта сессии `id`: в ней открывается терминал.
pub fn folder(
    store: &impl Sessions,
    projects: &impl Projects,
    id: &str,
) -> Result<PathBuf, AppError> {
    let session = store.load(id)?;

    projects
        .folder(&session.project)
        .ok_or(AppError::not_found("project_missing"))
}

/// Агент взялся за работу в сессии `id` или назвал её заголовком `title`
/// терминала. Сессия поднимается в списке, а заголовок, если он есть
/// и новый, становится её именем, пока имя не дал человек. Отвечает,
/// поменялось ли что-то.
pub fn touch(
    store: &impl Sessions,
    id: &str,
    title: Option<String>,
    now: u64,
) -> Result<bool, AppError> {
    let mut session = store.load(id)?;

    match title {
        Some(title) if title != session.title && !session.named => session.title = title,
        Some(_) => return Ok(false),
        None => {}
    }

    session.updated = now;
    store.save(&session)?;
    Ok(true)
}

/// Человек назвал сессию `id` именем `title`. Место в списке не меняется.
/// Пустое имя отдаёт сессию агенту: её снова назовёт заголовок терминала.
pub fn rename_session(store: &impl Sessions, id: &str, title: &str) -> Result<(), AppError> {
    let title = session_name(title).ok_or(AppError::invalid("title_invalid"))?;
    let mut session = store.load(id)?;

    session.named = !title.is_empty();
    session.title = title;
    store.save(&session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, HashMap};
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

        fn get(&self, id: &str) -> Session {
            self.0.lock().unwrap()[id].clone()
        }

        fn put(&self, session: Session) {
            self.0.lock().unwrap().insert(session.id.clone(), session);
        }
    }

    impl Sessions for FakeSessions {
        fn list(&self) -> Result<Vec<SessionInfo>, AppError> {
            Ok(self.0.lock().unwrap().values().map(Session::info).collect())
        }

        fn load(&self, id: &str) -> Result<Session, AppError> {
            self.0
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or(AppError::not_found("session_missing"))
        }

        fn save(&self, session: &Session) -> Result<(), AppError> {
            self.put(session.clone());
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
            Ok(Session::new("s1".into(), "p1", 1).info())
        );
        assert_eq!(store.get("s1"), Session::new("s1".into(), "p1", 1));
        assert_eq!(store.ids(), ["s1"]);
        assert_eq!(
            folder(&store, &projects, "s1"),
            Ok(PathBuf::from("/код/sapien"))
        );
        assert_eq!(
            folder(&store, &projects, "s9"),
            Err(AppError::not_found("session_missing"))
        );
    }

    #[test]
    fn список_сессий_от_свежих_к_старым_с_агентами_их_панелей() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();

        new_session(&store, &projects, "p1", "a".into(), 5).unwrap();
        new_session(&store, &projects, "p2", "b".into(), 9).unwrap();
        new_session(&store, &projects, "p1", "c".into(), 1).unwrap();

        let agent = |pane: &str, agent: &str, answering| PaneAgent {
            pane: pane.into(),
            agent: agent.into(),
            answering,
        };
        // В сессии a работает один агент из двух, в c агент ждёт человека.
        let agents = |id: &str| match id {
            "a" => vec![agent("a", "claude", false), agent("a2", "codex", true)],
            "c" => vec![agent("c", "codex", false)],
            _ => vec![],
        };
        let listed: Vec<(String, bool, usize)> = sessions(&store, agents)
            .unwrap()
            .into_iter()
            .map(|session| (session.id, session.answering, session.agents.len()))
            .collect();

        assert_eq!(
            listed,
            [
                ("b".into(), false, 0),
                ("a".into(), true, 2),
                ("c".into(), false, 1)
            ]
        );
    }

    #[test]
    fn сессию_где_работает_агент_не_удалить_а_остальные_удаляются_вместе_с_терминалом() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();
        let stopped = Mutex::new(vec![]);
        let stop = |id: &str| stopped.lock().unwrap().push(id.to_owned());

        for (id, project) in [("a", "p1"), ("b", "p1"), ("c", "p2")] {
            new_session(&store, &projects, project, id.into(), 1).unwrap();
        }

        let busy = Err(AppError::conflict("agent_busy"));
        // Агент работает в двух сессиях сразу.
        let answering = |id: &str| ["b", "c"].contains(&id);

        assert_eq!(delete_session(&store, answering, stop, "b"), busy);
        assert_eq!(delete_session(&store, answering, stop, "c"), busy);
        assert_eq!(forget_project(&store, answering, stop, "p1"), busy);
        assert_eq!(store.ids(), ["a", "b", "c"]);
        assert!(stopped.lock().unwrap().is_empty());

        // Свободная сессия рядом с занятыми удаляется.
        delete_session(&store, answering, stop, "a").unwrap();
        assert_eq!(store.ids(), ["b", "c"]);

        // Агент работает только в другом проекте: этот убирается целиком.
        forget_project(&store, |id| id == "c", stop, "p1").unwrap();
        assert_eq!(store.ids(), ["c"]);
        assert_eq!(*stopped.lock().unwrap(), ["a", "b"]);
    }

    #[test]
    fn работа_агента_поднимает_сессию_а_его_заголовок_её_называет() {
        let store = FakeSessions::default();

        store.put(Session::new("s1".into(), "p1", 1));

        assert_eq!(touch(&store, "s1", None, 5), Ok(true));
        assert_eq!(store.get("s1").updated, 5);

        assert_eq!(
            touch(&store, "s1", Some("Почини сборку".into()), 7),
            Ok(true)
        );
        assert_eq!(store.get("s1").title, "Почини сборку");
        assert_eq!(store.get("s1").updated, 7);

        // Тот же заголовок ничего не меняет и не пишет.
        assert_eq!(
            touch(&store, "s1", Some("Почини сборку".into()), 9),
            Ok(false)
        );
        assert_eq!(store.get("s1").updated, 7);

        assert_eq!(
            touch(&store, "s9", None, 9),
            Err(AppError::not_found("session_missing"))
        );
    }

    #[test]
    fn имя_от_человека_заголовки_агента_не_меняют_пока_его_не_стёрли() {
        let store = FakeSessions::default();

        store.put(Session::new("s1".into(), "p1", 1));
        touch(&store, "s1", Some("Почини сборку".into()), 2).unwrap();

        rename_session(&store, "s1", "  Релиз 0.3 ").unwrap();
        assert_eq!(store.get("s1").title, "Релиз 0.3");
        assert_eq!(store.get("s1").updated, 2);

        // Заголовок агента имя не трогает, а работа сессию поднимает.
        assert_eq!(touch(&store, "s1", Some("Другое".into()), 3), Ok(false));
        assert_eq!(touch(&store, "s1", None, 4), Ok(true));
        assert_eq!(store.get("s1").title, "Релиз 0.3");

        // Стёртое имя возвращает сессию агенту.
        rename_session(&store, "s1", "").unwrap();
        assert_eq!(store.get("s1").title, "");
        assert_eq!(touch(&store, "s1", Some("Другое".into()), 5), Ok(true));
        assert_eq!(store.get("s1").title, "Другое");

        assert_eq!(
            rename_session(&store, "s1", "две\nстроки"),
            Err(AppError::invalid("title_invalid"))
        );
        assert_eq!(
            rename_session(&store, "s9", "Имя"),
            Err(AppError::not_found("session_missing"))
        );
    }
}
