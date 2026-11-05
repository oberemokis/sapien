use super::domain::{
    Conversation, Report, Titles, accepts, agent_of, resume_command, session_title,
};
use std::time::{Duration, Instant};

/// Сколько после ввода или нового размера вывод считается откликом
/// терминала, а не работой агента: эхо набранного и перерисовка.
const ECHO: Duration = Duration::from_millis(300);

/// Сколько агент молчит, прежде чем считается, что он ждёт человека.
const QUIET: Duration = Duration::from_secs(3);

/// Сколько после смены команды на переднем плане она перепроверяется:
/// оболочка сначала порождает свою копию и только потом запускает в ней
/// команду.
const SETTLE: Duration = Duration::from_secs(3);

/// Сколько оболочка молчит после первого вывода, прежде чем панель наберёт
/// в ней команду продолжения: к этому времени она дописала приглашение
/// и читает строку сама, а набранное не повторяется над приглашением.
const READY: Duration = Duration::from_millis(300);

/// Сколько живёт терминал закрытой вкладки, в котором ничего не происходит.
const SILENCE: Duration = Duration::from_secs(600);

/// Что поменялось за тик сторожа.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Look {
    /// Другой агент на переднем плане или он взялся за работу либо бросил.
    pub changed: bool,
    /// Агент только что взялся за работу.
    pub started: bool,
    /// Из агента вышли, и продолжать его разговор больше нечего.
    pub forgot: bool,
}

/// Сторож агента в панели: какой агент на переднем плане её терминала,
/// работает ли он, как назвал сессию и какой разговор панель продолжит.
/// Часов и процессов не трогает: время, группа на переднем плане и её
/// командная строка приходят снаружи.
#[derive(Debug)]
pub struct PaneWatch {
    agent: Option<&'static str>,
    /// Группа на переднем плане и когда она там появилась.
    group: Option<(u32, Instant)>,
    /// Последний вывод, который не был откликом на ввод.
    worked: Instant,
    /// Последний ввод или новый размер.
    poked: Instant,
    answering: bool,
    titles: Titles,
    /// Последнее имя сессии от агента.
    title: Option<String>,
    /// Разговор агента, который панель продолжит после перезапуска.
    conversation: Option<Conversation>,
    /// Команда продолжения разговора, которую панель наберёт, когда
    /// оболочка будет готова, и когда оболочка последний раз писала.
    resume: Option<String>,
    printed: Option<Instant>,
    /// Терминал останавливает приложение: агент уходит не сам, и его
    /// разговор остаётся панели.
    closing: bool,
    /// Панель закрыли: терминал доживает до конца работы агента.
    closed: bool,
}

/// Давно прошедший миг: с него агент ещё не работал.
fn long_ago(now: Instant) -> Instant {
    now.checked_sub(QUIET).unwrap_or(now)
}

impl PaneWatch {
    /// Оболочка панели запустилась в `now`. Агент, который работал
    /// в панели, продолжит разговор `conversation`.
    pub fn new(conversation: Option<Conversation>, now: Instant) -> Self {
        Self {
            agent: None,
            group: None,
            worked: long_ago(now),
            poked: now,
            answering: false,
            titles: Titles::default(),
            title: None,
            resume: conversation.as_ref().and_then(resume_command),
            conversation,
            printed: None,
            closing: false,
            closed: false,
        }
    }

    pub fn agent(&self) -> Option<&'static str> {
        self.agent
    }

    pub fn answering(&self) -> bool {
        self.answering
    }

    /// Кусок вывода терминала. Ответ: новое имя сессии от агента.
    pub fn output(&mut self, bytes: &[u8], now: Instant) -> Option<String> {
        self.printed = Some(now);

        if now.saturating_duration_since(self.poked) > ECHO {
            self.worked = now;
        }

        // Заголовок оболочки, например папка, сессию не называет.
        let title = self
            .titles
            .feed(bytes)
            .filter(|_| self.agent.is_some())
            .and_then(|raw| session_title(&raw))
            .filter(|title| self.title.as_ref() != Some(title));

        if title.is_some() {
            self.title.clone_from(&title);
        }

        title
    }

    /// Ввод с клавиатуры окна. Человек начал набирать сам: команда
    /// продолжения легла бы в его строку. Ответы терминала на запросы
    /// оболочки начинаются с ESC.
    pub fn input(&mut self, text: &str, now: Instant) {
        self.poked = now;

        if !text.starts_with('\x1b') {
            self.resume = None;
        }
    }

    pub fn resized(&mut self, now: Instant) {
        self.poked = now;
    }

    /// Вкладку панели открыли снова: терминал больше не доживает,
    /// а его перерисовка в новом окне не работа агента.
    pub fn reopened(&mut self, now: Instant) {
        self.poked = now;
        self.closing = false;
        self.closed = false;
    }

    /// Панель закрыли. Вкладку могут открыть снова, и агент в ней
    /// продолжит разговор.
    pub fn close(&mut self) {
        self.closing = true;
        self.closed = true;
    }

    /// Терминал останавливает приложение, а не человек выходом из агента.
    pub fn halt(&mut self) {
        self.closing = true;
    }

    /// Тик сторожа. `front`: группа на переднем плане терминала, если это
    /// не сама оболочка. `command` даёт её командную строку и зовётся,
    /// только когда группу надо узнать.
    pub fn look(
        &mut self,
        front: Option<u32>,
        command: impl FnOnce(u32) -> Option<String>,
        now: Instant,
    ) -> Look {
        let before = (self.agent, self.answering);

        match (front, self.group) {
            (None, _) => {
                self.group = None;
                self.agent = None;
            }
            (Some(group), Some((seen, since)))
                if group == seen
                    && (self.agent.is_some() || now.saturating_duration_since(since) > SETTLE) => {}
            (Some(group), seen) => {
                let since = match seen {
                    Some((old, since)) if old == group => since,
                    _ => now,
                };

                self.group = Some((group, since));
                self.agent = command(group).as_deref().and_then(agent_of);
            }
        }

        if self.agent != before.0 {
            // Агент только что пришёл или ушёл: его заставка и прощание
            // не работа, а прежнее имя не его.
            self.worked = long_ago(now);
            self.title = None;
        }

        self.answering = self.agent.is_some() && now.saturating_duration_since(self.worked) < QUIET;

        // На переднем плане снова оболочка: из агента вышли. Агент, которого
        // остановило приложение, свой разговор помнит.
        let left = before.0.is_some() && self.agent.is_none() && front.is_none() && !self.closing;

        Look {
            changed: (self.agent, self.answering) != before,
            started: self.answering && !before.1,
            forgot: left && self.conversation.take().is_some(),
        }
    }

    /// Команда продолжения разговора, когда оболочка готова её принять.
    /// Отдаётся один раз.
    pub fn resume(&mut self, now: Instant) -> Option<String> {
        let ready = self
            .printed
            .is_some_and(|at| now.saturating_duration_since(at) > READY);

        ready.then(|| self.resume.take()).flatten()
    }

    /// Весть от интеграции агента. Ответ: панель приняла разговор, и его
    /// стоит сохранить, чтобы продолжить после перезапуска.
    pub fn report(&mut self, report: &Report) -> bool {
        if !accepts(self.conversation.as_ref(), report) {
            return false;
        }

        self.conversation = Some(report.conversation.clone());
        true
    }

    /// Терминал закрытой панели, в котором агент не работает и давно
    /// ничего не происходит: его пора остановить.
    pub fn abandoned(&self, now: Instant) -> bool {
        self.closed && !self.answering && now.saturating_duration_since(self.worked) > SILENCE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Группа на переднем плане, в которой идёт агент.
    const FRONT: Option<u32> = Some(42);

    fn claude(_: u32) -> Option<String> {
        Some("node /opt/homebrew/bin/claude --resume 4f1c".into())
    }

    fn unasked(_: u32) -> Option<String> {
        panic!("узнанную группу не спрашивают снова")
    }

    fn ms(count: u64) -> Duration {
        Duration::from_millis(count)
    }

    fn conversation() -> Conversation {
        Conversation {
            agent: "claude".into(),
            id: "4f1c".into(),
            cwd: Some("/код/sapien".into()),
            transcript: None,
        }
    }

    /// Сторож, у которого агент уже на переднем плане, и миг его прихода.
    fn watching(conversation: Option<Conversation>) -> (PaneWatch, Instant) {
        let start = Instant::now();
        let mut watch = PaneWatch::new(conversation, start);

        watch.look(FRONT, claude, start);
        (watch, start)
    }

    #[test]
    fn эхо_и_перерисовка_не_работа_а_вывод_после_них_работа() {
        let (mut watch, start) = watching(None);

        assert_eq!(watch.agent(), Some("claude"));
        assert!(!watch.answering());

        watch.input("п", start + ms(1000));
        watch.output("п".as_bytes(), start + ms(1100));
        assert_eq!(
            watch.look(FRONT, unasked, start + ms(1200)),
            Look::default()
        );

        watch.resized(start + ms(2000));
        watch.output(b"\x1b[2J", start + ms(2250));
        assert_eq!(
            watch.look(FRONT, unasked, start + ms(2300)),
            Look::default()
        );

        watch.output(b"Thinking", start + ms(2400));
        assert_eq!(
            watch.look(FRONT, unasked, start + ms(2500)),
            Look {
                changed: true,
                started: true,
                forgot: false
            }
        );
        assert!(watch.answering());
    }

    #[test]
    fn три_секунды_тишины_гасят_работу() {
        let (mut watch, start) = watching(None);

        watch.output(b"Thinking", start + ms(500));
        assert!(watch.look(FRONT, unasked, start + ms(1000)).started);

        assert_eq!(
            watch.look(FRONT, unasked, start + ms(3400)),
            Look::default()
        );
        assert!(watch.answering());

        assert_eq!(
            watch.look(FRONT, unasked, start + ms(3600)),
            Look {
                changed: true,
                ..Look::default()
            }
        );
        assert!(!watch.answering());
    }

    #[test]
    fn новая_группа_перепроверяется_пока_оболочка_не_запустила_в_ней_команду() {
        let start = Instant::now();
        let mut watch = PaneWatch::new(None, start);

        // Оболочка сначала порождает свою копию, и только потом в той же
        // группе идёт агент.
        assert_eq!(
            watch.look(Some(7), |_| Some("-zsh".into()), start),
            Look::default()
        );
        assert!(watch.look(Some(7), claude, start + ms(1000)).changed);
        assert_eq!(watch.agent(), Some("claude"));
        watch.look(Some(7), unasked, start + ms(5000));

        // Не агент в той же группе дольше трёх секунд больше не спрашивается,
        // а новая группа спрашивается сразу.
        let mut other = PaneWatch::new(None, start);

        other.look(Some(8), |_| Some("make build".into()), start);
        other.look(Some(8), unasked, start + ms(3100));
        assert_eq!(other.agent(), None);
        other.look(Some(9), claude, start + ms(3200));
        assert_eq!(other.agent(), Some("claude"));
    }

    #[test]
    fn выход_из_агента_забывает_разговор_а_остановка_приложением_помнит() {
        let (mut watch, start) = watching(Some(conversation()));

        // На переднем плане снова оболочка.
        assert_eq!(
            watch.look(None, unasked, start + ms(1000)),
            Look {
                changed: true,
                started: false,
                forgot: true
            }
        );
        assert!(!watch.look(None, unasked, start + ms(2000)).forgot);

        let (mut halted, start) = watching(Some(conversation()));

        halted.halt();
        assert!(!halted.look(None, unasked, start + ms(1000)).forgot);

        // Закрытая вкладка тоже останавливает терминал приложением.
        let (mut closed, start) = watching(Some(conversation()));

        closed.close();
        assert!(!closed.look(None, unasked, start + ms(1000)).forgot);
    }

    #[test]
    fn команда_продолжения_ждёт_приглашения_и_уступает_набранному() {
        let start = Instant::now();
        let mut watch = PaneWatch::new(Some(conversation()), start);

        assert_eq!(watch.resume(start + ms(1000)), None);
        watch.output(b"$ ", start + ms(1000));
        assert_eq!(watch.resume(start + ms(1200)), None);
        // Ответ терминала на запрос оболочки набором человека не считается.
        watch.input("\x1b[0n", start + ms(1250));
        assert_eq!(
            watch.resume(start + ms(1400)).as_deref(),
            Some("cd '/код/sapien' && claude --resume '4f1c'")
        );
        assert_eq!(watch.resume(start + ms(2000)), None);

        let mut typed = PaneWatch::new(Some(conversation()), start);

        typed.output(b"$ ", start);
        typed.input("l", start + ms(100));
        assert_eq!(typed.resume(start + ms(1000)), None);
    }

    #[test]
    fn имя_сессии_даёт_заголовок_агента_а_не_оболочки() {
        let (mut watch, start) = watching(None);
        let title = "\x1b]0;✳ Fix login\x07".as_bytes();

        assert_eq!(watch.output(title, start), Some("Fix login".into()));
        assert_eq!(watch.output(title, start), None);

        let mut shell = PaneWatch::new(None, start);

        assert_eq!(shell.output(b"\x1b]0;~/code\x07", start), None);
    }

    #[test]
    fn закрытая_панель_доживает_до_конца_работы_агента() {
        let (mut watch, start) = watching(None);
        let later = start + Duration::from_secs(601);

        assert!(!watch.abandoned(later));
        watch.close();
        assert!(watch.abandoned(later));
        watch.reopened(later);
        assert!(!watch.abandoned(later));

        watch.close();
        watch.output(b"Thinking", later + ms(500));
        watch.look(FRONT, unasked, later + ms(600));
        assert!(!watch.abandoned(later + ms(700)));
    }

    #[test]
    fn разговор_панели_меняет_весть_интеграции() {
        let (mut watch, _) = watching(None);
        let report = Report {
            pane: "p".into(),
            conversation: conversation(),
            source: "startup".into(),
        };

        assert!(watch.report(&report));
        assert!(!watch.report(&report));
    }
}
