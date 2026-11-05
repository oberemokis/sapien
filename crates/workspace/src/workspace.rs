use super::ports::Events;
use super::watcher::{Hub, Watcher, lock};
use sapien_agents::{Conversation, PaneWatch, Report, hooks};
use sapien_kernel::{AppError, durable};
use sapien_sessions::{PaneAgent, PaneFiles, Projects, SessionInfo, Sessions};
use sapien_terminal::{
    Launch, OutputSink, Supervisor, TerminalCode, shell_environment, user_shell,
};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Как часто сторож смотрит, что идёт в терминалах.
const TICK: Duration = Duration::from_secs(1);

/// Размер терминала, который запустили без вкладки, пока её не открыли.
const BACKGROUND_SIZE: (u16, u16) = (120, 40);

/// Сессии, их терминалы и агенты в них. `S`: где лежат сессии и файлы
/// панелей, `P`: папки проектов, `E`: события окну.
pub struct Workspace<S, P, E> {
    hub: Arc<Hub<S, E>>,
    projects: P,
    terminals: Supervisor<Watcher<S, E>>,
    /// Оболочка панели и её аргументы: оболочка человека оболочкой входа.
    shell: (PathBuf, Vec<String>),
    /// Куда интеграции агентов сообщают разговоры панелей.
    socket: OnceLock<PathBuf>,
    /// Панели открываются и запускаются по одной: иначе два запроса подняли
    /// бы две оболочки одной панели.
    opening: Mutex<()>,
}

impl<S, P, E> Workspace<S, P, E>
where
    S: Sessions + PaneFiles + Send + 'static,
    P: Projects + Send + 'static,
    E: Events,
{
    pub fn new(sessions: S, projects: P, events: E) -> Self {
        Self {
            hub: Arc::new(Hub { sessions, events }),
            projects,
            terminals: Supervisor::default(),
            shell: (user_shell(), vec!["-l".into()]),
            socket: OnceLock::new(),
            opening: Mutex::new(()),
        }
    }

    /// Сторож терминалов и сокет интеграций агентов в папке данных `data`.
    /// Без сокета терминалы работают, а разговоры агентов после перезапуска
    /// не продолжаются.
    pub fn run(self: &Arc<Self>, data: &Path) {
        let told = Arc::clone(self);

        match hooks::listen(data, move |report| told.report(&report)) {
            Ok(socket) => {
                let _ = self.socket.set(socket);
            }
            Err(_) => log::warn!("сокет интеграций агентов не открылся"),
        }

        let watched = Arc::clone(self);

        std::thread::spawn(move || {
            loop {
                std::thread::sleep(TICK);
                watched.tick();
            }
        });
    }

    /// Выход из приложения: экраны остаются панелям, а оболочки и всё, что
    /// в них идёт, уходят. Разговоры агентов панели продолжат при следующем
    /// запуске.
    pub fn stop(&self) {
        for pane in self.terminals.remove(|_| true) {
            pane.observer.keep_screen(&pane.term.screen());
            pane.observer.halt(&pane.term);
        }
    }

    fn tick(&self) {
        if self.terminals.tick() {
            self.hub.events.sessions_changed();
        }
    }

    /// Сессии всех проектов, свежие первыми, с агентами их панелей.
    pub fn sessions(&self) -> Result<Vec<SessionInfo>, AppError> {
        sapien_sessions::sessions(&self.hub.sessions, |id| self.agents(id))
    }

    pub fn new_session(&self, project: &str) -> Result<SessionInfo, AppError> {
        sapien_sessions::new_session(
            &self.hub.sessions,
            &self.projects,
            project,
            durable::fresh_id(),
            durable::now(),
        )
    }

    /// В сессии работает агент, значит, `agent_busy`. Иначе её терминалы
    /// останавливаются до удаления.
    pub fn delete_session(&self, id: &str) -> Result<(), AppError> {
        sapien_sessions::delete_session(
            &self.hub.sessions,
            |id| self.answering(id),
            |id| self.stop_session(id),
            id,
        )
    }

    /// Человек назвал сессию `id` сам, пустое имя отдаёт её агенту.
    pub fn rename_session(&self, id: &str, title: &str) -> Result<(), AppError> {
        sapien_sessions::rename_session(&self.hub.sessions, id, title)?;
        self.hub.events.sessions_changed();
        Ok(())
    }

    /// Стирает сессии проекта, который убирают из списка, и останавливает
    /// их терминалы. Хоть в одной из них работает агент, значит,
    /// `agent_busy`, и не стирается ни одна.
    pub fn forget_project(&self, project: &str) -> Result<(), AppError> {
        sapien_sessions::forget_project(
            &self.hub.sessions,
            |id| self.answering(id),
            |id| self.stop_session(id),
            project,
        )
    }

    /// Терминал панели `pane` сессии `session` размером `cols` на `rows`.
    /// Оболочка панели уже идёт, например окно перезагрузили или её
    /// запустили без вкладки, и вывод переключается в `sink`, начиная с того,
    /// что уже на экране. Иначе она запускается.
    pub fn open(
        &self,
        session: &str,
        pane: &str,
        sink: Box<dyn OutputSink>,
        (cols, rows): (u16, u16),
    ) -> Result<(), AppError> {
        let _one = lock(&self.opening);

        let Some(running) = self.terminals.get(pane) else {
            return self.launch(session, pane, Some(sink), (cols, rows));
        };

        lock(&running.observer.watch).reopened(Instant::now());
        running.term.attach(sink);
        // Два новых размера заставляют полноэкранную программу
        // перерисоваться в новом окне.
        running.term.resize(cols.saturating_sub(1).max(1), rows);
        running.term.resize(cols, rows);
        Ok(())
    }

    /// Оболочка панели запускается без вкладки: при запуске приложения
    /// поднимаются все открытые вкладки, и агенты в них продолжают
    /// разговоры. Идущую оболочку не трогает.
    pub fn start(&self, session: &str, pane: &str) -> Result<(), AppError> {
        let _one = lock(&self.opening);

        if self.terminals.get(pane).is_some() {
            return Ok(());
        }

        self.launch(session, pane, None, BACKGROUND_SIZE)
    }

    /// Ввод с клавиатуры в панель `pane`. Оболочка уже кончилась, значит,
    /// `terminal_missing`.
    pub fn write(&self, pane: &str, data: &str) -> Result<(), AppError> {
        let running = self
            .terminals
            .get(pane)
            .ok_or(AppError::not_found(TerminalCode::Missing))?;

        lock(&running.observer.watch).input(data, Instant::now());
        running.term.write(data.as_bytes())
    }

    pub fn resize(&self, pane: &str, cols: u16, rows: u16) {
        if let Some(running) = self.terminals.get(pane) {
            lock(&running.observer.watch).resized(Instant::now());
            running.term.resize(cols, rows);
        }
    }

    /// Панель закрыли, сама или с вкладкой. Агент работает, и терминал
    /// доживает до конца его работы, иначе останавливается сразу.
    pub fn close(&self, pane: &str) {
        let Some(running) = self.terminals.get(pane) else {
            return;
        };

        running.term.detach();

        let answering = {
            let mut watch = lock(&running.observer.watch);

            watch.close();
            watch.answering()
        };

        if !answering {
            running.term.stop();
        }
    }

    /// Весть от интеграции агента о разговоре панели.
    pub fn report(&self, report: &Report) {
        if let Some(running) = self.terminals.get(&report.pane) {
            running.observer.report(report);
        }
    }

    /// Запускает оболочку панели в папке проекта сессии, с прежним экраном
    /// панели над ней. Агент, который работал в панели, продолжает свой
    /// разговор: оболочка получит команду, как набранную.
    fn launch(
        &self,
        session: &str,
        pane: &str,
        sink: Option<Box<dyn OutputSink>>,
        size: (u16, u16),
    ) -> Result<(), AppError> {
        let store = &self.hub.sessions;
        let dir = sapien_sessions::folder(store, &self.projects, session)?;
        let screen = store.screen(session, pane).unwrap_or_default();
        // Нечитаемый разговор значит, что продолжать нечего.
        let mut conversation: Option<Conversation> = store
            .conversation(session, pane)
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());

        // Агент сообщил разговор, но записать его не успел, например в нём
        // не было ни одного сообщения: продолжать нечего.
        if conversation
            .as_ref()
            .and_then(|conversation| conversation.transcript.as_deref())
            .is_some_and(|transcript| !Path::new(transcript).exists())
        {
            conversation = None;
            let _ = store.save_conversation(session, pane, None);
        }

        self.terminals.start(
            pane,
            Launch {
                program: self.shell.0.clone(),
                args: self.shell.1.clone(),
                env: self.environment(pane),
                dir,
                size,
                screen,
                sink,
                observer: Watcher {
                    session: session.to_owned(),
                    pane: pane.to_owned(),
                    watch: Mutex::new(PaneWatch::new(conversation, Instant::now())),
                    hub: Arc::clone(&self.hub),
                },
            },
        )
    }

    /// Окружение оболочки панели `pane`: по нему интеграции агентов находят
    /// приложение и свою панель.
    fn environment(&self, pane: &str) -> Vec<(OsString, OsString)> {
        let mut env = shell_environment();

        if let Some(socket) = self.socket.get() {
            env.push(("SAPIEN_SOCKET".into(), socket.into()));
            env.push(("SAPIEN_PANE".into(), pane.into()));

            if let Ok(bin) = std::env::current_exe() {
                env.push(("SAPIEN_BIN".into(), bin.into()));
            }
        }

        env
    }

    /// Агенты в панелях сессии `session`, по порядку имён панелей.
    fn agents(&self, session: &str) -> Vec<PaneAgent> {
        let mut agents: Vec<PaneAgent> = self
            .terminals
            .panes()
            .iter()
            .filter(|running| running.observer.session == session)
            .filter_map(|running| {
                let watch = lock(&running.observer.watch);

                Some(PaneAgent {
                    pane: running.observer.pane.clone(),
                    agent: watch.agent()?.to_owned(),
                    answering: watch.answering(),
                })
            })
            .collect();

        agents.sort_by(|a, b| a.pane.cmp(&b.pane));
        agents
    }

    fn answering(&self, session: &str) -> bool {
        self.agents(session).iter().any(|agent| agent.answering)
    }

    /// Сессию удаляют: её терминалы уходят из реестра сразу, чтобы их
    /// конец не сохранил экраны удалённой сессии.
    fn stop_session(&self, session: &str) {
        for running in self.terminals.remove(|watcher| watcher.session == session) {
            running.observer.halt(&running.term);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use sapien_sessions::SessionsCode;
    use sapien_sessions::SessionsDir;
    use tempfile::TempDir;

    /// Оболочка панели в тестах: приглашение, ответ на каждую строку
    /// и выход по `exit`.
    const SHELL: &str = r#"printf '$ '; while read -r line; do [ "$line" = exit ] && exit; echo "ran $line"; printf '$ '; done"#;

    /// Ждёт, пока `done` не станет правдой, не дольше двух секунд.
    fn until(mut done: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);

        while Instant::now() < deadline {
            if done() {
                return true;
            }

            std::thread::sleep(Duration::from_millis(10));
        }

        false
    }

    /// Проект p1 в папке `.0`, других проектов нет.
    struct Folder(PathBuf);

    impl Projects for Folder {
        fn folder(&self, id: &str) -> Option<PathBuf> {
            (id == "p1").then(|| self.0.clone())
        }
    }

    /// События, которые получило окно.
    #[derive(Default)]
    struct Told(Mutex<Vec<String>>);

    impl Events for Told {
        fn sessions_changed(&self) {
            lock(&self.0).push("sessions".into());
        }

        fn terminal_exited(&self, session: &str, pane: &str) {
            lock(&self.0).push(format!("exited {session} {pane}"));
        }
    }

    /// Окно панели: всё, что в него пришло, по сообщениям.
    #[derive(Clone, Default)]
    struct Window(Arc<Mutex<Vec<Vec<u8>>>>);

    impl OutputSink for Window {
        fn send(&self, bytes: &[u8]) {
            lock(&self.0).push(bytes.to_vec());
        }
    }

    impl Window {
        fn text(&self) -> String {
            String::from_utf8_lossy(&lock(&self.0).concat()).into_owned()
        }
    }

    type Fixture = Workspace<SessionsDir, Folder, Told>;

    fn workspace() -> (TempDir, Fixture) {
        let data = tempfile::tempdir().unwrap();
        let mut workspace = Workspace::new(
            SessionsDir::new(data.path()),
            Folder(data.path().to_owned()),
            Told::default(),
        );

        workspace.shell = ("/bin/sh".into(), vec!["-c".into(), SHELL.into()]);
        (data, workspace)
    }

    fn told(workspace: &Fixture) -> Vec<String> {
        lock(&workspace.hub.events.0).clone()
    }

    #[test]
    fn сессию_и_проект_с_работающим_агентом_не_удалить() {
        let (data, workspace) = workspace();
        let id = workspace.new_session("p1").unwrap().id;
        let busy = Err(AppError::conflict(SessionsCode::AgentBusy));

        workspace.start(&id, "a").unwrap();
        workspace.start(&id, "b").unwrap();

        // В панели b агент взялся за работу.
        let now = Instant::now();
        let b = workspace.terminals.get("b").unwrap();

        {
            let mut watch = lock(&b.observer.watch);

            watch.look(Some(1), |_| Some("claude".into()), now);
            watch.output(b"Thinking", now + Duration::from_millis(400));
            watch.look(Some(1), |_| None, now + Duration::from_millis(500));
        }

        assert_eq!(workspace.delete_session(&id), busy);
        assert_eq!(workspace.forget_project("p1"), busy);

        let listed = workspace.sessions().unwrap();

        assert!(listed[0].answering);
        assert_eq!(
            listed[0].agents,
            [PaneAgent {
                pane: "b".into(),
                agent: "claude".into(),
                answering: true,
            }]
        );

        // Агент ждёт человека: сессия уходит вместе с терминалами, и их
        // конец экраны удалённой сессии не сохраняет.
        lock(&b.observer.watch).look(Some(1), |_| None, now + Duration::from_secs(5));
        workspace.delete_session(&id).unwrap();
        assert!(workspace.terminals.panes().is_empty());
        assert_eq!(workspace.sessions(), Ok(vec![]));

        std::thread::sleep(Duration::from_millis(300));
        assert!(told(&workspace).is_empty());
        assert!(!data.path().join("sessions/screens").join(&id).exists());
    }

    #[test]
    fn панель_продолжает_разговор_агента_под_прежним_экраном() {
        let (data, workspace) = workspace();
        let id = workspace.new_session("p1").unwrap().id;
        let files = SessionsDir::new(data.path());
        let window = Window::default();

        files.save_screen(&id, "a", b"old screen\r\n").unwrap();
        files
            .save_conversation(
                &id,
                "a",
                Some(r#"{"agent":"claude","id":"4f1c","cwd":"/tmp/про ект"}"#.as_bytes()),
            )
            .unwrap();

        workspace
            .open(&id, "a", Box::new(window.clone()), (80, 24))
            .unwrap();
        assert!(lock(&window.0)[0].starts_with(b"old screen\r\n"));

        // Оболочка дописала приглашение, и тик набирает команду продолжения.
        assert!(until(|| {
            workspace.tick();
            window
                .text()
                .contains("ran cd '/tmp/про ект' && claude --resume '4f1c'")
        }));

        // Оболочка кончилась: экран остаётся панели, окно узнаёт о конце.
        workspace.write("a", "exit\r").unwrap();
        assert!(until(
            || told(&workspace).contains(&format!("exited {id} a"))
        ));
        assert!(workspace.terminals.get("a").is_none());
        assert!(String::from_utf8_lossy(&files.screen(&id, "a").unwrap()).contains("ran cd '/tmp"));
        assert_eq!(
            workspace.write("a", "ls\r"),
            Err(AppError::not_found(TerminalCode::Missing))
        );
    }

    #[test]
    fn панель_удалённой_сессии_не_запускается() {
        let (_data, workspace) = workspace();
        let id = workspace.new_session("p1").unwrap().id;

        workspace.hub.sessions.delete(&id).unwrap();
        assert_eq!(
            workspace.start(&id, "a"),
            Err(AppError::not_found(SessionsCode::Missing))
        );
        assert!(workspace.terminals.panes().is_empty());
    }
}
