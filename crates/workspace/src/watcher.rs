use super::ports::Events;
use sapien_agents::{PaneWatch, Report};
use sapien_kernel::durable;
use sapien_sessions::{PaneFiles, Sessions};
use sapien_terminal::{PaneObserver, Term, command_line};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Instant;

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Хранилище сессий и события окну: общие для фасада и сторожей панелей.
pub struct Hub<S, E> {
    pub sessions: S,
    pub events: E,
}

/// Сторож панели `pane` сессии `session`: наблюдатель её оболочки.
/// Узнаёт агента и его работу, поднимает сессию, в которой агент взялся
/// за дело, и называет её заголовком агента.
pub struct Watcher<S, E> {
    pub session: String,
    pub pane: String,
    pub watch: Mutex<PaneWatch>,
    pub hub: Arc<Hub<S, E>>,
}

impl<S: Sessions + PaneFiles, E: Events> Watcher<S, E> {
    /// Терминал останавливает приложение: разговор агента остаётся панели.
    pub fn halt(&self, term: &Term) {
        lock(&self.watch).halt();
        term.stop();
    }

    /// Последний экран терминала остаётся панели до следующего запуска.
    pub fn keep_screen(&self, screen: &[u8]) {
        let _ = self
            .hub
            .sessions
            .save_screen(&self.session, &self.pane, screen);
    }

    /// Интеграция агента сообщила разговор панели: панель продолжит его
    /// после перезапуска.
    pub fn report(&self, report: &Report) {
        if !lock(&self.watch).report(report) {
            return;
        }

        let Ok(bytes) = serde_json::to_vec(&report.conversation) else {
            return;
        };
        let _ = self
            .hub
            .sessions
            .save_conversation(&self.session, &self.pane, Some(&bytes));
    }

    /// Агент взялся за работу или назвал сессию заголовком `title`.
    /// Отвечает, поменялась ли сессия.
    fn touch(&self, title: Option<String>) -> bool {
        sapien_sessions::touch(&self.hub.sessions, &self.session, title, durable::now()) == Ok(true)
    }
}

impl<S, E> PaneObserver for Watcher<S, E>
where
    S: Sessions + PaneFiles + Send + 'static,
    E: Events,
{
    fn output(&self, bytes: &[u8]) {
        let title = lock(&self.watch).output(bytes, Instant::now());

        if title.is_some() && self.touch(title) {
            self.hub.events.sessions_changed();
        }
    }

    fn tick(&self, term: &Term) -> bool {
        let now = Instant::now();
        let look = lock(&self.watch).look(term.foreground(), command_line, now);

        if look.started {
            self.touch(None);
        }

        if look.forgot {
            let _ = self
                .hub
                .sessions
                .save_conversation(&self.session, &self.pane, None);
        }

        let resume = lock(&self.watch).resume(now);

        if let Some(resume) = resume {
            let _ = term.write(format!("{resume}\r").as_bytes());
        }

        let abandoned = lock(&self.watch).abandoned(now);

        if abandoned {
            self.halt(term);
        }

        look.changed
    }

    fn exited(&self, screen: &[u8]) {
        self.keep_screen(screen);
        self.hub.events.terminal_exited(&self.session, &self.pane);
        self.hub.events.sessions_changed();
    }
}
