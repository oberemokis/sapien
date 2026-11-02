use super::domain::{
    Effect, Hook, Session, SessionInfo, Tracked, launch, settings, title, valid_claude,
};
use super::ports::{Projects, Sessions};
use crate::error::AppError;
use std::cmp::Reverse;
use std::mem::replace;
use std::path::{Path, PathBuf};

/// Сессии всех проектов, свежие первыми. `live`: Claude Code, который
/// сейчас говорит в сессии, если он запущен.
pub fn sessions(
    store: &impl Sessions,
    live: impl Fn(&str) -> Option<Tracked>,
) -> Result<Vec<SessionInfo>, AppError> {
    let mut sessions = store.list()?;

    for session in &mut sessions {
        if let Some(tracked) = live(&session.id) {
            session.answering = tracked.answering;
            session.stalled = tracked.stalled;
        }
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

/// Удаляет сессию `id`. В ней отвечает агент (`answering`), и она остаётся:
/// ответ записал бы её заново. Иначе её Claude Code останавливается
/// (`stop`) до удаления.
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

/// Удаляет сессии проекта, который убирают из списка. Отвечает агент
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

/// Что запустить в терминале сессии `session`. `exe`: путь к sapien для
/// хуков, `task`: задание первым сообщением, `background`: действие
/// по расписанию без вкладки.
pub struct Start<'a> {
    pub session: &'a str,
    pub exe: &'a str,
    pub task: Option<&'a str>,
    pub background: bool,
}

/// Как запустить Claude Code сессии.
#[derive(Debug, PartialEq)]
pub struct Plan {
    /// Папка проекта: в ней Claude Code работает.
    pub dir: PathBuf,
    pub args: Vec<String>,
    /// Claude Code продолжает разговор, который помнит.
    pub resumed: bool,
    /// Сессия говорила, а Claude Code её разговора не помнит, например
    /// он удалил старые разговоры: разговор начинается заново.
    pub lost: bool,
}

/// Как открыть Claude Code сессии в терминале. Сессия без разговора
/// получает id `fresh` до запуска, поэтому продолжится и после перезапуска
/// приложения. Помнит ли Claude Code разговор в папке, говорит `remembers`.
pub fn plan(
    store: &impl Sessions,
    projects: &impl Projects,
    remembers: impl Fn(&Path, &str) -> bool,
    start: Start<'_>,
    fresh: impl FnOnce() -> String,
) -> Result<Plan, AppError> {
    let mut session = store.load(start.session)?;
    let dir = projects
        .folder(&session.project)
        .ok_or(AppError::not_found("project_missing"))?;
    let claude = match session.claude.clone().filter(|id| valid_claude(id)) {
        Some(claude) => claude,
        None => {
            let claude = fresh();

            session.claude = Some(claude.clone());
            store.save(&session)?;
            claude
        }
    };
    let resumed = remembers(&dir, &claude);
    let args = launch(
        &claude,
        resumed,
        settings(start.exe, start.background),
        start.task,
        start.background,
    );

    Ok(Plan {
        dir,
        args,
        resumed,
        lost: !resumed && !session.title.is_empty(),
    })
}

/// Событие хука от Claude Code, который говорит в сессии `tracked.session`.
/// Сессии, которой уже нет, событие не меняет: `session_missing`. `owned`:
/// сессии, в которых говорит Claude Code других терминалов. `fresh` даёт
/// id новой сессии, `now` это время события.
///
/// `/clear`, `/resume` и форк меняют разговор: вкладка переходит к сессии
/// с его id, а если её нет или она занята другим терминалом, к новой
/// в том же проекте. Прежняя сессия остаётся в списке. Первый
/// `SessionStart` процесса и сжатие продолжают тот же разговор, даже если
/// Claude Code дал ему новый id.
pub fn on_hook(
    store: &impl Sessions,
    tracked: &mut Tracked,
    hook: Hook,
    owned: &[String],
    fresh: impl FnOnce() -> String,
    now: u64,
) -> Result<Option<Effect>, AppError> {
    match hook {
        Hook::Start { claude, compact } => {
            let first = !replace(&mut tracked.started, true);
            let mut current = store.load(&tracked.session)?;

            if current.claude.as_deref() == Some(claude.as_str()) {
                return Ok(None);
            }

            if first || compact {
                current.claude = Some(claude);
                store.save(&current)?;
                return Ok(None);
            }

            let known = store.list()?.into_iter().find(|session| {
                session.claude.as_deref() == Some(claude.as_str()) && !owned.contains(&session.id)
            });
            let to = match known {
                Some(session) => session.id,
                None => {
                    let mut session = Session::new(fresh(), &current.project, now);

                    session.claude = Some(claude);
                    store.save(&session)?;
                    session.id
                }
            };

            tracked.answering = false;

            let from = replace(&mut tracked.session, to.clone());

            Ok(Some(Effect::Moved { from, to }))
        }
        Hook::Prompt { text } => {
            let mut session = store.load(&tracked.session)?;

            if session.title.is_empty() {
                session.title = title(&text);
            }

            session.updated = now;
            store.save(&session)?;
            tracked.answering = true;
            tracked.prompted = true;
            tracked.stalled = false;
            Ok(Some(Effect::Changed))
        }
        Hook::Stop | Hook::Notification { .. } => {
            store.load(&tracked.session)?;

            let was = tracked.answering;

            // Прерванный Esc ответ Stop не шлёт: его конец видно по тому,
            // что Claude Code ждёт следующего сообщения.
            if matches!(hook, Hook::Stop | Hook::Notification { idle: true }) {
                tracked.answering = false;
            }

            // Вкладку закрыли посреди ответа: ответ кончился или ждёт
            // человека, которого нет. Действие, задание которого не ушло,
            // ждёт человека во вкладке.
            if !tracked.open && tracked.prompted {
                return Ok(Some(Effect::Stop));
            }

            Ok((was != tracked.answering).then_some(Effect::Changed))
        }
    }
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

    /// Сессия `id` в проекте `p1` с разговором Claude Code `claude`.
    fn talked(id: &str, title: &str, claude: Option<&str>) -> Session {
        Session {
            title: title.into(),
            claude: claude.map(str::to_owned),
            ..Session::new(id.into(), "p1", 1)
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
    }

    #[test]
    fn список_сессий_от_свежих_к_старым_с_тем_что_делает_их_claude_code() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();

        new_session(&store, &projects, "p1", "a".into(), 5).unwrap();
        new_session(&store, &projects, "p2", "b".into(), 9).unwrap();
        new_session(&store, &projects, "p1", "c".into(), 1).unwrap();

        let live = |id: &str| {
            let mut tracked = Tracked::new(id.into(), id == "a");

            tracked.answering = id == "a";
            tracked.stalled = id == "c";
            (id != "b").then_some(tracked)
        };
        let listed: Vec<(String, bool, bool)> = sessions(&store, live)
            .unwrap()
            .into_iter()
            .map(|session| (session.id, session.answering, session.stalled))
            .collect();

        assert_eq!(
            listed,
            [
                ("b".into(), false, false),
                ("a".into(), true, false),
                ("c".into(), false, true)
            ]
        );
    }

    #[test]
    fn сессию_где_отвечает_агент_не_удалить_а_остальные_удаляются_вместе_с_claude_code() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();
        let stopped = Mutex::new(vec![]);
        let stop = |id: &str| stopped.lock().unwrap().push(id.to_owned());

        for (id, project) in [("a", "p1"), ("b", "p1"), ("c", "p2")] {
            new_session(&store, &projects, project, id.into(), 1).unwrap();
        }

        let busy = Err(AppError::conflict("agent_busy"));
        // Агент отвечает в двух сессиях сразу.
        let answering = |id: &str| ["b", "c"].contains(&id);

        assert_eq!(delete_session(&store, answering, stop, "b"), busy);
        assert_eq!(delete_session(&store, answering, stop, "c"), busy);
        assert_eq!(forget_project(&store, answering, stop, "p1"), busy);
        assert_eq!(store.ids(), ["a", "b", "c"]);
        assert!(stopped.lock().unwrap().is_empty());

        // Свободная сессия рядом с занятыми удаляется.
        delete_session(&store, answering, stop, "a").unwrap();
        assert_eq!(store.ids(), ["b", "c"]);

        // Агент отвечает только в другом проекте: этот убирается целиком.
        forget_project(&store, |id| id == "c", stop, "p1").unwrap();
        assert_eq!(store.ids(), ["c"]);
        assert_eq!(*stopped.lock().unwrap(), ["a", "b"]);
    }

    fn start<'a>(session: &'a str, task: Option<&'a str>, background: bool) -> Start<'a> {
        Start {
            session,
            exe: "/sapien",
            task,
            background,
        }
    }

    #[test]
    fn новая_сессия_получает_разговор_до_запуска_а_старая_его_продолжает() {
        let store = FakeSessions::default();
        let projects = FakeProjects::default();
        let remembered = |dir: &Path, id: &str| dir == Path::new("/код/sapien") && id == "4f1c";
        let open = |id: &str, task| {
            plan(
                &store,
                &projects,
                remembered,
                start(id, task, false),
                || "9e2d".into(),
            )
        };

        store.put(Session::new("new".into(), "p1", 1));
        store.put(talked("old", "Почини сборку", Some("4f1c")));
        // Разговор Claude Code удалил: например, он старше срока хранения.
        store.put(talked("gone", "Тесты", Some("77aa")));
        // Сессия, которая так и не заговорила.
        store.put(talked("quiet", "", Some("77ab")));
        store.put(Session {
            project: "p9".into(),
            ..talked("away", "Лендинг", Some("4f1c"))
        });

        let fresh = open("new", Some("Сводка")).unwrap();

        assert_eq!(fresh.dir, Path::new("/код/sapien"));
        assert_eq!(fresh.args[..2], ["--session-id", "9e2d"]);
        assert_eq!(fresh.args[fresh.args.len() - 2..], ["--", "Сводка"]);
        assert_eq!((fresh.resumed, fresh.lost), (false, false));
        // id разговора записан до запуска: после перезапуска это --resume.
        assert_eq!(store.get("new").claude.as_deref(), Some("9e2d"));

        let old = open("old", None).unwrap();

        assert_eq!(old.args[..2], ["--resume", "4f1c"]);
        assert_eq!((old.resumed, old.lost), (true, false));

        let gone = open("gone", None).unwrap();

        assert_eq!(gone.args[..2], ["--session-id", "77aa"]);
        assert_eq!((gone.resumed, gone.lost), (false, true));
        assert!(!open("quiet", None).unwrap().lost);

        assert_eq!(
            open("away", None),
            Err(AppError::not_found("project_missing"))
        );
        assert_eq!(
            open("none", None),
            Err(AppError::not_found("session_missing"))
        );
    }

    #[test]
    fn действие_по_расписанию_идёт_без_разрешений_и_без_вопроса_о_них() {
        let store = FakeSessions::default();

        store.put(Session::new("s1".into(), "p1", 1));

        let planned = plan(
            &store,
            &FakeProjects::default(),
            |_, _| false,
            start("s1", Some("Сводка"), true),
            || "9e2d".into(),
        )
        .unwrap();
        let settings: serde_json::Value = serde_json::from_str(&planned.args[3]).unwrap();

        assert!(
            planned
                .args
                .windows(2)
                .any(|pair| pair == ["--permission-mode", "bypassPermissions"])
        );
        assert_eq!(settings["skipDangerousModePermissionPrompt"], true);
    }

    fn hook(
        store: &FakeSessions,
        tracked: &mut Tracked,
        hook: Hook,
        owned: &[&str],
    ) -> Result<Option<Effect>, AppError> {
        let owned: Vec<String> = owned.iter().map(|id| (*id).to_owned()).collect();

        on_hook(store, tracked, hook, &owned, || "new".into(), 7)
    }

    fn prompt(text: &str) -> Hook {
        Hook::Prompt { text: text.into() }
    }

    #[test]
    fn сообщение_ставит_отметку_ответа_и_заголовок_а_конец_ответа_снимает() {
        let store = FakeSessions::default();
        let mut tracked = Tracked::new("s1".into(), true);

        store.put(talked("s1", "", Some("4f1c")));

        assert_eq!(
            hook(&store, &mut tracked, prompt("  Почини сборку\nпадает"), &[]),
            Ok(Some(Effect::Changed))
        );
        assert!(tracked.answering);
        assert_eq!(
            hook(&store, &mut tracked, prompt("И тесты"), &[]),
            Ok(Some(Effect::Changed))
        );
        assert_eq!(store.get("s1").title, "Почини сборку");
        assert_eq!(store.get("s1").updated, 7);

        // Просьба о разрешении: агент ещё отвечает.
        assert_eq!(
            hook(
                &store,
                &mut tracked,
                Hook::Notification { idle: false },
                &[]
            ),
            Ok(None)
        );
        assert!(tracked.answering);
        assert_eq!(
            hook(&store, &mut tracked, Hook::Stop, &[]),
            Ok(Some(Effect::Changed))
        );
        assert!(!tracked.answering);

        // Ответ прервали Esc: Stop не пришёл, а Claude Code ждёт сообщения.
        hook(&store, &mut tracked, prompt("Ещё"), &[]).unwrap();
        assert_eq!(
            hook(&store, &mut tracked, Hook::Notification { idle: true }, &[]),
            Ok(Some(Effect::Changed))
        );
        assert!(!tracked.answering);

        // Сессию удалили: событие её не трогает.
        store.delete("s1").unwrap();
        assert_eq!(
            hook(&store, &mut tracked, prompt("Ещё"), &[]),
            Err(AppError::not_found("session_missing"))
        );
        assert!(store.ids().is_empty());
    }

    #[test]
    fn закрытая_посреди_ответа_вкладка_останавливает_claude_code_после_ответа() {
        let store = FakeSessions::default();

        store.put(talked("s1", "Почини", Some("4f1c")));

        for end in [
            Hook::Stop,
            Hook::Notification { idle: false },
            Hook::Notification { idle: true },
        ] {
            let mut tracked = Tracked::new("s1".into(), true);

            hook(&store, &mut tracked, prompt("Почини"), &[]).unwrap();
            tracked.open = false;
            assert_eq!(hook(&store, &mut tracked, end, &[]), Ok(Some(Effect::Stop)));
        }

        // Действие по расписанию, задание которого не ушло, ждёт человека.
        let mut waiting = Tracked::new("s1".into(), false);

        assert_eq!(
            hook(
                &store,
                &mut waiting,
                Hook::Notification { idle: false },
                &[]
            ),
            Ok(None)
        );

        // А ушедшее заканчивается вместе с ответом.
        let mut scheduled = Tracked::new("s1".into(), false);

        hook(&store, &mut scheduled, prompt("Сводка"), &[]).unwrap();
        assert_eq!(
            hook(&store, &mut scheduled, Hook::Stop, &[]),
            Ok(Some(Effect::Stop))
        );
    }

    fn started(claude: &str) -> Hook {
        Hook::Start {
            claude: claude.into(),
            compact: false,
        }
    }

    #[test]
    fn clear_и_resume_переводят_вкладку_к_сессии_разговора() {
        let store = FakeSessions::default();
        let mut tracked = Tracked::new("s1".into(), true);

        store.put(talked("s1", "Почини", Some("4f1c")));
        store.put(talked("s2", "Тесты", Some("77aa")));
        store.put(talked("s3", "Лендинг", Some("88bb")));

        // Запуск с тем же разговором ничего не меняет.
        assert_eq!(hook(&store, &mut tracked, started("4f1c"), &[]), Ok(None));

        // /clear: новый разговор ложится новой сессией того же проекта.
        hook(&store, &mut tracked, prompt("Почини"), &[]).unwrap();
        assert_eq!(
            hook(&store, &mut tracked, started("99cc"), &[]),
            Ok(Some(Effect::Moved {
                from: "s1".into(),
                to: "new".into()
            }))
        );
        assert_eq!(tracked.session, "new");
        assert!(!tracked.answering);
        assert_eq!(
            store.get("new"),
            Session {
                claude: Some("99cc".into()),
                ..Session::new("new".into(), "p1", 7)
            }
        );
        // Прежняя сессия остаётся со своим разговором.
        assert_eq!(store.get("s1").claude.as_deref(), Some("4f1c"));

        // /resume разговора известной сессии открывает её.
        assert_eq!(
            hook(&store, &mut tracked, started("77aa"), &[]),
            Ok(Some(Effect::Moved {
                from: "new".into(),
                to: "s2".into()
            }))
        );

        // Её разговор уже идёт в другом терминале: заводится новая сессия.
        store.delete("new").unwrap();
        assert_eq!(
            hook(&store, &mut tracked, started("88bb"), &["s3"]),
            Ok(Some(Effect::Moved {
                from: "s2".into(),
                to: "new".into()
            }))
        );
        assert_eq!(store.get("new").claude.as_deref(), Some("88bb"));
    }

    #[test]
    fn первый_запуск_и_сжатие_продолжают_тот_же_разговор() {
        let store = FakeSessions::default();
        let mut tracked = Tracked::new("s1".into(), true);

        store.put(talked("s1", "Почини", Some("4f1c")));

        // Claude Code продолжил разговор под новым id.
        assert_eq!(hook(&store, &mut tracked, started("5a5a"), &[]), Ok(None));
        assert_eq!(store.get("s1").claude.as_deref(), Some("5a5a"));

        let compacted = Hook::Start {
            claude: "6b6b".into(),
            compact: true,
        };

        assert_eq!(hook(&store, &mut tracked, compacted, &[]), Ok(None));
        assert_eq!(store.get("s1").claude.as_deref(), Some("6b6b"));
        assert_eq!(store.ids(), ["s1"]);
        assert_eq!(tracked.session, "s1");
    }
}
