use super::pty::{Command, Pty, lock};
use super::screen::Screen;
use sapien_kernel::AppError;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Куда идёт вывод оболочки, пока её панель открыта в окне.
pub trait OutputSink: Send {
    fn send(&self, bytes: &[u8]);
}

/// Наблюдатель оболочки панели. Реестр зовёт его без своих замков,
/// поэтому наблюдатель может звать реестр сам.
pub trait PaneObserver: Send + Sync + 'static {
    /// Кусок вывода, который уже ушёл в окно и в экран.
    fn output(&self, bytes: &[u8]);
    /// Тик реестра. Ответ: поменялось ли что-то, о чём стоит сказать.
    fn tick(&self, term: &Term) -> bool;
    /// Оболочка кончилась, `screen` её последний экран. Об оболочках,
    /// которые реестр отдал через `remove`, не сообщается.
    fn exited(&self, screen: &[u8]);
}

/// Что запустить в панели.
pub struct Launch<O> {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(OsString, OsString)>,
    pub dir: PathBuf,
    pub size: (u16, u16),
    /// Экран, который оставила прошлая оболочка панели.
    pub screen: Vec<u8>,
    /// Окно панели. Без него вывод только помнится.
    pub sink: Option<Box<dyn OutputSink>>,
    pub observer: O,
}

/// Вывод оболочки: куда он идёт и что из него помнится.
struct Output {
    sink: Option<Box<dyn OutputSink>>,
    screen: Screen,
}

/// Оболочка панели в псевдотерминале.
pub struct Term {
    pty: Pty,
    output: Arc<Mutex<Output>>,
}

impl Term {
    /// Ввод с клавиатуры окна.
    pub fn write(&self, bytes: &[u8]) -> Result<(), AppError> {
        self.pty.write(bytes)
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        self.pty.resize(cols, rows);
    }

    /// Группа на переднем плане, если это не сама оболочка.
    pub fn foreground(&self) -> Option<u32> {
        self.pty.foreground()
    }

    /// SIGHUP оболочке и её команде на переднем плане.
    pub fn stop(&self) {
        self.pty.stop();
    }

    /// Что помнится из вывода.
    pub fn screen(&self) -> Vec<u8> {
        lock(&self.output).screen.bytes().to_vec()
    }

    /// Вывод идёт в окно `sink`. Первым сообщением идёт уже написанное,
    /// пусть и пустое: на запросы программ в нём окно не отвечает.
    pub fn attach(&self, sink: Box<dyn OutputSink>) {
        let mut output = lock(&self.output);

        sink.send(output.screen.bytes());
        output.sink = Some(sink);
    }

    /// Окна у панели больше нет: вывод только помнится.
    pub fn detach(&self) {
        lock(&self.output).sink = None;
    }
}

/// Панель в реестре: оболочка и её наблюдатель.
pub struct Pane<O> {
    pub term: Term,
    pub observer: Arc<O>,
}

type Panes<O> = Mutex<HashMap<String, Arc<Pane<O>>>>;

/// Реестр оболочек по панелям. У каждой панели своя оболочка.
pub struct Supervisor<O> {
    panes: Arc<Panes<O>>,
}

impl<O> Default for Supervisor<O> {
    fn default() -> Self {
        Self {
            panes: Arc::default(),
        }
    }
}

impl<O: PaneObserver> Supervisor<O> {
    pub fn get(&self, pane: &str) -> Option<Arc<Pane<O>>> {
        lock(&self.panes).get(pane).cloned()
    }

    pub fn panes(&self) -> Vec<Arc<Pane<O>>> {
        lock(&self.panes).values().cloned().collect()
    }

    /// Запускает оболочку панели `pane` под прежним экраном. Идущую
    /// оболочку панели не трогает. С окном первым сообщением идёт прежний
    /// экран.
    pub fn start(&self, pane: &str, launch: Launch<O>) -> Result<(), AppError> {
        // Реестр держит запуск до конца вставки, поэтому оболочка, которая
        // кончилась сразу, тоже уходит из него.
        let mut panes = lock(&self.panes);

        if panes.contains_key(pane) {
            return Ok(());
        }

        let screen = Screen::resumed(launch.screen);

        if let Some(sink) = &launch.sink {
            sink.send(screen.bytes());
        }

        let output = Arc::new(Mutex::new(Output {
            sink: launch.sink,
            screen,
        }));
        let observer = Arc::new(launch.observer);
        let (into, seen) = (output.clone(), observer.clone());
        let (registry, name) = (self.panes.clone(), pane.to_owned());
        let pty = Pty::spawn(
            Command {
                program: &launch.program,
                args: &launch.args,
                env: launch.env,
                dir: &launch.dir,
                cols: launch.size.0,
                rows: launch.size.1,
            },
            move |bytes| {
                {
                    let mut output = lock(&into);

                    output.screen.push(bytes);

                    // Окно перезагружают: вывод до нового окна помнится
                    // в экране.
                    if let Some(sink) = &output.sink {
                        sink.send(bytes);
                    }
                }

                seen.output(bytes);
            },
            move || exited(&registry, &name),
        )?;

        panes.insert(
            pane.to_owned(),
            Arc::new(Pane {
                term: Term { pty, output },
                observer,
            }),
        );
        Ok(())
    }

    /// Убирает из реестра панели, о наблюдателях которых `which` отвечает
    /// правдой, и отдаёт их. Конец их оболочек наблюдателю уже не придёт.
    pub fn remove(&self, which: impl Fn(&O) -> bool) -> Vec<Arc<Pane<O>>> {
        let mut gone = vec![];

        lock(&self.panes).retain(|_, pane| {
            let keep = !which(&pane.observer);

            if !keep {
                gone.push(pane.clone());
            }

            keep
        });
        gone
    }

    /// Каждый наблюдатель смотрит на свою оболочку. Ответ: поменялось ли
    /// что-то хоть у одного.
    pub fn tick(&self) -> bool {
        self.panes()
            .iter()
            .fold(false, |news, pane| pane.observer.tick(&pane.term) | news)
    }
}

/// Оболочка панели `pane` кончилась: панель уходит из реестра, а её
/// наблюдатель получает последний экран.
fn exited<O: PaneObserver>(panes: &Panes<O>, pane: &str) {
    let Some(gone) = lock(panes).remove(pane) else {
        return;
    };

    gone.observer.exited(&gone.term.screen());
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

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

    /// Окно, которое помнит всё, что в него пришло, по сообщениям.
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

        fn first(&self) -> Vec<u8> {
            lock(&self.0)[0].clone()
        }
    }

    #[derive(Default)]
    struct Seen {
        pane: &'static str,
        output: Mutex<String>,
        ticks: AtomicUsize,
        exited: Mutex<Option<String>>,
    }

    impl PaneObserver for Seen {
        fn output(&self, bytes: &[u8]) {
            lock(&self.output).push_str(&String::from_utf8_lossy(bytes));
        }

        fn tick(&self, _: &Term) -> bool {
            self.ticks.fetch_add(1, Ordering::SeqCst) == 0
        }

        fn exited(&self, screen: &[u8]) {
            *lock(&self.exited) = Some(String::from_utf8_lossy(screen).into_owned());
        }
    }

    /// Оболочка панели `pane`, которая эхом отвечает на строку и выходит
    /// по `exit`.
    fn launch(pane: &'static str, screen: &[u8], sink: Option<Window>) -> Launch<Seen> {
        Launch {
            program: "/bin/sh".into(),
            args: vec![
                "-c".into(),
                r#"echo готов; while read -r line; do [ "$line" = exit ] && exit; echo "эхо $line"; done"#.into(),
            ],
            env: vec![("PATH".into(), "/usr/bin:/bin".into())],
            dir: std::env::temp_dir(),
            size: (80, 24),
            screen: screen.to_vec(),
            sink: sink.map(|sink| Box::new(sink) as Box<dyn OutputSink>),
            observer: Seen {
                pane,
                ..Seen::default()
            },
        }
    }

    #[test]
    fn вывод_идёт_в_окно_экран_и_наблюдателю_а_конец_уводит_панель() {
        let supervisor = Supervisor::default();
        let window = Window::default();

        supervisor
            .start("p1", launch("p1", b"$ make\r\n", Some(window.clone())))
            .unwrap();

        // Первым сообщением окно получает прежний экран.
        assert!(window.first().starts_with(b"$ make\r\n"));
        assert!(until(|| window.text().contains("готов")));

        let pane = supervisor.get("p1").unwrap();

        assert!(until(|| lock(&pane.observer.output).contains("готов")));

        // Уже идущую панель запуск не трогает.
        supervisor.start("p1", launch("p1", b"", None)).unwrap();
        assert!(Arc::ptr_eq(&pane, &supervisor.get("p1").unwrap()));

        // Тик доходит до наблюдателя, и его ответ становится ответом тика.
        assert!(supervisor.tick());
        assert!(!supervisor.tick());

        // Новое окно получает экран целиком, старое больше ничего.
        let again = Window::default();

        pane.term.detach();
        pane.term.attach(Box::new(again.clone()));
        assert!(String::from_utf8_lossy(&again.first()).contains("готов"));
        pane.term.write(b"hi\n").unwrap();
        assert!(until(|| again.text().contains("эхо hi")));
        assert!(!window.text().contains("эхо hi"));

        pane.term.write(b"exit\n").unwrap();
        assert!(until(|| supervisor.get("p1").is_none()));
        assert!(until(|| lock(&pane.observer.exited)
            .as_deref()
            .is_some_and(|screen| screen.contains("эхо hi"))));
    }

    #[test]
    fn убранную_из_реестра_оболочку_наблюдатель_не_провожает() {
        let supervisor = Supervisor::default();

        supervisor.start("p1", launch("p1", b"", None)).unwrap();
        supervisor.start("p2", launch("p2", b"", None)).unwrap();

        let gone = supervisor.remove(|seen| seen.pane == "p1");
        let left = supervisor.get("p2").unwrap();

        assert_eq!(gone.len(), 1);
        assert_eq!(supervisor.panes().len(), 1);

        // Остановленная оболочка из реестра провожается, а убранная нет.
        gone[0].term.stop();
        left.term.stop();
        assert!(until(|| lock(&left.observer.exited).is_some()));
        assert!(supervisor.panes().is_empty());
        assert_eq!(*lock(&gone[0].observer.exited), None);
    }
}
