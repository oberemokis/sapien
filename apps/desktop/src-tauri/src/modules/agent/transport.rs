use super::domain::{
    ClaudeStatus, Conversation, Integration, PaneAgent, Report, SessionInfo, Titles, accepts,
    agent_of, resume_command, session_title,
};
use super::infrastructure::claude_code::ClaudeCode;
use super::infrastructure::hooks;
use super::infrastructure::integrations::Integrations;
use super::infrastructure::neighbours::ProjectFolders;
use super::infrastructure::sessions_dir::SessionsDir;
use super::infrastructure::terminal::{Command, Pty, command_line, shell_environment, user_shell};
use super::use_case;
use crate::durable;
use crate::error::AppError;
use serde_json::json;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

fn sessions<R: Runtime>(app: &AppHandle<R>) -> Result<SessionsDir, AppError> {
    Ok(SessionsDir::new(&data_dir(app)?))
}

/// Claude Code устройства. Проверки он проходит в папке данных
/// приложения, поэтому она должна быть.
fn claude<R: Runtime>(app: &AppHandle<R>) -> Result<ClaudeCode, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))?;
    let data = data_dir(app)?;

    std::fs::create_dir_all(&data).map_err(|_| AppError::unavailable("data_dir_unavailable"))?;

    Ok(ClaudeCode::new(&home, &data))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Окну перечитать сессии: что-то в них поменялось без его команды.
const SESSIONS_CHANGED: &str = "agent-sessions";

/// Оболочка терминала кончилась.
const TERMINAL_EXITED: &str = "terminal-exited";

/// Как часто сторож смотрит, что идёт в терминалах.
const TICK: Duration = Duration::from_secs(1);

/// Сколько после ввода или нового размера вывод считается откликом
/// терминала, а не работой агента: эхо набранного и перерисовка.
const ECHO: Duration = Duration::from_millis(300);

/// Сколько агент молчит, прежде чем считается, что он ждёт человека.
const QUIET: Duration = Duration::from_secs(3);

/// Сколько после смены команды на переднем плане она перепроверяется:
/// оболочка сначала порождает свою копию и только потом запускает в ней
/// команду.
const SETTLE: Duration = Duration::from_secs(3);

/// Сколько живёт терминал закрытой вкладки, в котором ничего не происходит.
const SILENCE: Duration = Duration::from_secs(600);

/// Сколько вывода помнится для нового окна и следующего запуска.
const SCREEN: usize = 256 * 1024;

/// Конец прежнего экрана: выйти из второго экрана полноэкранной программы,
/// вернуть курсор, выключить мышь, вести о фокусе и вставку скобками,
/// сбросить цвет. Новая оболочка начинается с чистой строки. Второй экран
/// закрывает 1047, а не 1049: тот ставит курсор туда, где его никто не
/// сохранял, и новая оболочка писала бы поверх прежнего экрана.
const RESET: &[u8] = b"\x1b[?1047l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?2004l\x1b[0m\r\n";

/// Сколько оболочка молчит после первого вывода, прежде чем панель наберёт
/// в ней команду продолжения: к этому времени она дописала приглашение
/// и читает строку сама, а набранное не повторяется над приглашением.
const READY: Duration = Duration::from_millis(300);

/// Размер терминала, который запустили без вкладки, пока её не открыли.
const BACKGROUND_SIZE: (u16, u16) = (120, 40);

/// Вывод терминала: куда он идёт и что из него помнится.
struct Output {
    /// Канал вкладки. Без неё вывод только помнится.
    channel: Option<Channel>,
    screen: Vec<u8>,
    /// Панель закрыли: терминал доживает до конца работы агента.
    closed: bool,
}

impl Output {
    fn push(&mut self, bytes: &[u8]) {
        self.screen.extend_from_slice(bytes);

        if self.screen.len() > 2 * SCREEN {
            self.screen.drain(..self.screen.len() - SCREEN);

            // Срез мог прийтись на середину буквы или последовательности:
            // экран начинается со следующей строки.
            let line = self
                .screen
                .iter()
                .position(|&byte| byte == b'\n')
                .map_or(0, |at| at + 1);

            self.screen.drain(..line);
        }
    }
}

/// Что известно о терминале по его процессам и выводу.
struct Watch {
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
}

/// Давно прошедший миг: с него агент ещё не работал.
fn long_ago() -> Instant {
    Instant::now()
        .checked_sub(QUIET)
        .unwrap_or_else(Instant::now)
}

/// Оболочка панели сессии `session` в псевдотерминале.
struct Term {
    session: String,
    pty: Pty,
    output: Arc<Mutex<Output>>,
    watch: Arc<Mutex<Watch>>,
}

impl Term {
    /// Терминал останавливает приложение, а не человек выходом из агента.
    fn halt(&self) {
        lock(&self.watch).closing = true;
        self.pty.stop();
    }
}

/// Терминалы по панелям. У каждой панели сессии своя оболочка. `socket`:
/// куда интеграции агентов сообщают разговоры панелей.
#[derive(Default)]
pub struct Terminals {
    terms: Mutex<HashMap<String, Arc<Term>>>,
    socket: OnceLock<PathBuf>,
}

impl Terminals {
    fn find(&self, pane: &str) -> Option<Arc<Term>> {
        lock(&self.terms).get(pane).cloned()
    }

    /// Агенты в панелях сессии `session`, по порядку имён панелей.
    fn agents(&self, session: &str) -> Vec<PaneAgent> {
        let mut agents: Vec<PaneAgent> = lock(&self.terms)
            .iter()
            .filter(|(_, term)| term.session == session)
            .filter_map(|(pane, term)| {
                let watch = lock(&term.watch);

                Some(PaneAgent {
                    pane: pane.clone(),
                    agent: watch.agent?.to_owned(),
                    answering: watch.answering,
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
    fn stop(&self, session: &str) {
        lock(&self.terms).retain(|_, term| {
            if term.session == session {
                term.halt();
            }

            term.session != session
        });
    }
}

fn changed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(SESSIONS_CHANGED, ());
}

/// Последний экран терминала остаётся панели `pane` до следующего запуска.
fn keep_screen<R: Runtime>(app: &AppHandle<R>, pane: &str, term: &Term) {
    let screen = lock(&term.output).screen.clone();

    if let Ok(store) = sessions(app) {
        let _ = store.save_screen(&term.session, pane, &screen);
    }
}

/// Агент сессии назвал её заголовком терминала.
fn named<R: Runtime>(app: &AppHandle<R>, session: &str, title: String) {
    let renamed = sessions(app)
        .and_then(|store| use_case::touch(&store, session, Some(title), durable::now()));

    if renamed == Ok(true) {
        changed(app);
    }
}

/// Окружение оболочки панели `pane`: по нему интеграции агентов находят
/// приложение и свою панель.
fn pane_environment<R: Runtime>(app: &AppHandle<R>, pane: &str) -> Vec<(OsString, OsString)> {
    let mut env = shell_environment();

    if let Some(socket) = app.state::<Terminals>().socket.get() {
        env.push(("SAPIEN_SOCKET".into(), socket.into()));
        env.push(("SAPIEN_PANE".into(), pane.into()));

        if let Ok(bin) = std::env::current_exe() {
            env.push(("SAPIEN_BIN".into(), bin.into()));
        }
    }

    env
}

/// Запускает оболочку панели `pane` сессии `session` в папке её проекта,
/// с прежним экраном панели над ней. Агент, который работал в панели,
/// продолжает свой разговор: оболочка получает команду, как набранную.
/// Без канала оболочку запустили без вкладки, и вывод только помнится.
/// С каналом первым сообщением идёт прежний экран, пусть и пустой: на
/// запросы программ в нём окно не отвечает.
fn start(
    app: &AppHandle,
    terms: &mut HashMap<String, Arc<Term>>,
    (session, pane): (&str, &str),
    channel: Option<Channel>,
    (cols, rows): (u16, u16),
) -> Result<(), AppError> {
    let store = sessions(app)?;
    let dir = use_case::folder(&store, &ProjectFolders(app.clone()), session)?;
    let mut screen = store.screen(session, pane).unwrap_or_default();
    let mut conversation = store.conversation(session, pane);

    if !screen.is_empty() {
        screen.extend_from_slice(RESET);
    }

    if let Some(channel) = &channel {
        let _ = channel.send(InvokeResponseBody::Raw(screen.clone()));
    }

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

    let resume = conversation.as_ref().and_then(resume_command);
    let output = Arc::new(Mutex::new(Output {
        channel,
        screen,
        closed: false,
    }));
    let watch = Arc::new(Mutex::new(Watch {
        agent: None,
        group: None,
        worked: long_ago(),
        poked: Instant::now(),
        answering: false,
        titles: Titles::default(),
        title: None,
        conversation,
        resume,
        printed: None,
        closing: false,
    }));
    let (into, seen, events, id) = (
        output.clone(),
        watch.clone(),
        app.clone(),
        session.to_owned(),
    );
    let (ended, gone) = (app.clone(), pane.to_owned());
    let pty = Pty::spawn(
        Command {
            program: &user_shell(),
            args: &["-l".into()],
            env: pane_environment(app, pane),
            dir: &dir,
            cols,
            rows,
        },
        move |bytes| {
            let title = {
                let mut watch = lock(&seen);

                watch.printed = Some(Instant::now());

                if watch.poked.elapsed() > ECHO {
                    watch.worked = Instant::now();
                }

                // Заголовок оболочки, например папка, сессию не называет.
                let raw = watch.titles.feed(bytes);
                let title = raw
                    .filter(|_| watch.agent.is_some())
                    .and_then(|raw| session_title(&raw))
                    .filter(|title| watch.title.as_ref() != Some(title));

                if title.is_some() {
                    watch.title.clone_from(&title);
                }

                title
            };

            {
                let mut output = lock(&into);

                output.push(bytes);

                if let Some(channel) = &output.channel {
                    // Окно перезагружают: вывод до нового канала помнится
                    // в экране.
                    let _ = channel.send(InvokeResponseBody::Raw(bytes.to_vec()));
                }
            }

            if let Some(title) = title {
                named(&events, &id, title);
            }
        },
        move || exited(&ended, &gone),
    )?;

    terms.insert(
        pane.to_owned(),
        Arc::new(Term {
            session: session.to_owned(),
            pty,
            output,
            watch,
        }),
    );
    Ok(())
}

/// Оболочка панели `pane` кончилась. Реестр держит запуск до конца
/// вставки, поэтому оболочка, которая кончилась сразу, тоже уходит из него.
fn exited<R: Runtime>(app: &AppHandle<R>, pane: &str) {
    let Some(term) = lock(&app.state::<Terminals>().terms).remove(pane) else {
        return;
    };

    keep_screen(app, pane, &term);
    let _ = app.emit(
        TERMINAL_EXITED,
        json!({ "session": term.session, "pane": pane }),
    );
    changed(app);
}

/// Что делает терминал: какой агент на переднем плане и работает ли он.
/// Отвечает, поменялось ли это, взялся ли агент только что за работу
/// и вышел ли из него человек, так что продолжать больше нечего.
fn look(term: &Term) -> (bool, bool, bool) {
    let front = term.pty.foreground();
    let mut watch = lock(&term.watch);
    let before = (watch.agent, watch.answering);

    match (front, watch.group) {
        (None, _) => {
            watch.group = None;
            watch.agent = None;
        }
        (Some(group), Some((seen, since)))
            if group == seen && (watch.agent.is_some() || since.elapsed() > SETTLE) => {}
        (Some(group), seen) => {
            let since = match seen {
                Some((old, since)) if old == group => since,
                _ => Instant::now(),
            };

            watch.group = Some((group, since));
            watch.agent = command_line(group).as_deref().and_then(agent_of);
        }
    }

    if watch.agent != before.0 {
        // Агент только что пришёл или ушёл: его заставка и прощание
        // не работа, а прежнее имя не его.
        watch.worked = long_ago();
        watch.title = None;
    }

    watch.answering = watch.agent.is_some() && watch.worked.elapsed() < QUIET;

    // На переднем плане снова оболочка: из агента вышли. Агент, которого
    // остановило приложение, свой разговор помнит.
    let left = before.0.is_some() && watch.agent.is_none() && front.is_none() && !watch.closing;
    let forgot = left && watch.conversation.take().is_some();

    (
        (watch.agent, watch.answering) != before,
        watch.answering && !before.1,
        forgot,
    )
}

/// Интеграция агента сообщила разговор панели: панель продолжит его после
/// перезапуска.
fn reported<R: Runtime>(app: &AppHandle<R>, report: Report) {
    let Some(term) = app.state::<Terminals>().find(&report.pane) else {
        return;
    };

    {
        let mut watch = lock(&term.watch);

        if !accepts(watch.conversation.as_ref(), &report) {
            return;
        }

        watch.conversation = Some(report.conversation.clone());
    }

    let _ = sessions(app).and_then(|store| {
        store.save_conversation(&term.session, &report.pane, Some(&report.conversation))
    });
}

/// Сторож терминалов: узнаёт агентов и их работу, поднимает сессию,
/// в которой агент взялся за дело, и останавливает терминал закрытой
/// вкладки, в котором давно ничего не происходит.
fn watch<R: Runtime>(app: &AppHandle<R>) {
    loop {
        std::thread::sleep(TICK);

        let terms: Vec<(String, Arc<Term>)> = lock(&app.state::<Terminals>().terms)
            .iter()
            .map(|(pane, term)| (pane.clone(), term.clone()))
            .collect();
        let mut news = false;

        for (pane, term) in terms {
            let (different, started, forgot) = look(&term);

            news |= different;

            if started {
                let _ = sessions(app)
                    .and_then(|store| use_case::touch(&store, &term.session, None, durable::now()));
            }

            if forgot {
                let _ = sessions(app)
                    .and_then(|store| store.save_conversation(&term.session, &pane, None));
            }

            let resume = {
                let mut watch = lock(&term.watch);
                let ready = watch.printed.is_some_and(|at| at.elapsed() > READY);

                ready.then(|| watch.resume.take()).flatten()
            };

            if let Some(resume) = resume {
                let _ = term.pty.write(format!("{resume}\r").as_bytes());
            }

            let idle = {
                let watch = lock(&term.watch);

                !watch.answering && watch.worked.elapsed() > SILENCE
            };

            if idle && lock(&term.output).closed {
                term.halt();
            }
        }

        if news {
            changed(app);
        }
    }
}

/// Дверь для запуска приложения: сторож терминалов и сокет интеграций
/// агентов. Без сокета терминалы работают, а разговоры агентов после
/// перезапуска не продолжаются.
pub fn start_terminals<R: Runtime>(app: &AppHandle<R>) {
    let watched = app.clone();
    let told = app.clone();

    match data_dir(app).map(|data| hooks::listen(&data, move |report| reported(&told, report))) {
        Ok(Ok(socket)) => {
            let _ = app.state::<Terminals>().socket.set(socket);
        }
        _ => log::warn!("сокет интеграций агентов не открылся"),
    }

    std::thread::spawn(move || watch(&watched));
}

/// Дверь для выхода из приложения: экраны остаются панелям, а оболочки
/// и всё, что в них идёт, уходят с приложением. Разговоры агентов панели
/// продолжат при следующем запуске.
pub fn stop_terminals<R: Runtime>(app: &AppHandle<R>) {
    let terms = std::mem::take(&mut *lock(&app.state::<Terminals>().terms));

    for (pane, term) in terms {
        keep_screen(app, &pane, &term);
        term.halt();
    }
}

/// Дверь для подкоманды `sapien hook <агент>`: хук агента в панели
/// сообщает приложению её разговор.
pub fn hook(agent: &str) {
    hooks::forward(
        agent,
        std::io::stdin(),
        std::env::var_os("SAPIEN_SOCKET"),
        std::env::var("SAPIEN_PANE").ok(),
        std::env::var("CODEX_THREAD_ID").ok(),
    );
}

/// Сессии всех проектов, свежие первыми.
#[tauri::command]
pub fn agent_sessions(
    app: AppHandle,
    terminals: State<'_, Terminals>,
) -> Result<Vec<SessionInfo>, AppError> {
    use_case::sessions(&sessions(&app)?, |id| terminals.agents(id))
}

#[tauri::command]
pub fn agent_session_new(app: AppHandle, project: String) -> Result<SessionInfo, AppError> {
    use_case::new_session(
        &sessions(&app)?,
        &ProjectFolders(app.clone()),
        &project,
        durable::fresh_id(),
        durable::now(),
    )
}

#[tauri::command]
pub fn agent_session_delete(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    id: String,
) -> Result<(), AppError> {
    use_case::delete_session(
        &sessions(&app)?,
        |id| terminals.answering(id),
        |id| terminals.stop(id),
        &id,
    )
}

/// Человек назвал сессию `id` сам, пустое имя отдаёт её агенту.
#[tauri::command]
pub fn agent_session_rename(app: AppHandle, id: String, title: String) -> Result<(), AppError> {
    use_case::rename_session(&sessions(&app)?, &id, &title)?;
    changed(&app);
    Ok(())
}

/// Дверь для модуля projects: стирает сессии проекта, который убирают
/// из списка, и останавливает их терминалы. Хоть в одной из них работает
/// агент, значит, `agent_busy`, и не стирается ни одна.
pub fn forget_project<R: Runtime>(app: &AppHandle<R>, project: &str) -> Result<(), AppError> {
    let terminals = app.state::<Terminals>();

    use_case::forget_project(
        &sessions(app)?,
        |id| terminals.answering(id),
        |id| terminals.stop(id),
        project,
    )
}

// Команды терминала асинхронные: синхронная команда идёт в главном потоке,
// а через него же канал отдаёт вывод окну.

/// Терминал панели `pane` сессии `session` размером `cols` на `rows`.
/// Оболочка панели уже идёт, например окно перезагрузили или её запустили
/// без вкладки, и вывод переключается в `on_data`, начиная с того, что уже
/// на экране. Иначе она запускается.
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    session: String,
    pane: String,
    cols: u16,
    rows: u16,
    on_data: Channel,
) -> Result<(), AppError> {
    let mut terms = lock(&terminals.terms);

    let Some(term) = terms.get(&pane).cloned() else {
        return start(
            &app,
            &mut terms,
            (&session, &pane),
            Some(on_data),
            (cols, rows),
        );
    };

    {
        let mut output = lock(&term.output);

        // Первым сообщением, как и у новой оболочки, идёт уже написанное.
        let _ = on_data.send(InvokeResponseBody::Raw(output.screen.clone()));
        output.channel = Some(on_data);
        output.closed = false;
    }

    {
        let mut watch = lock(&term.watch);

        watch.poked = Instant::now();
        watch.closing = false;
    }

    // Два новых размера заставляют полноэкранную программу перерисоваться
    // в новом окне.
    term.pty.resize(cols.saturating_sub(1).max(1), rows);
    term.pty.resize(cols, rows);
    Ok(())
}

/// Оболочка панели `pane` сессии `session` запускается без вкладки:
/// при запуске приложения поднимаются все открытые вкладки, и агенты
/// в них продолжают разговоры. Идущую оболочку не трогает.
#[tauri::command]
pub async fn terminal_start(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    session: String,
    pane: String,
) -> Result<(), AppError> {
    let mut terms = lock(&terminals.terms);

    if terms.contains_key(&pane) {
        return Ok(());
    }

    start(&app, &mut terms, (&session, &pane), None, BACKGROUND_SIZE)
}

/// Ввод с клавиатуры в панель `pane`. Оболочка уже кончилась, значит,
/// `terminal_missing`.
#[tauri::command]
pub async fn terminal_write(
    terminals: State<'_, Terminals>,
    pane: String,
    data: String,
) -> Result<(), AppError> {
    let term = terminals
        .find(&pane)
        .ok_or(AppError::not_found("terminal_missing"))?;

    {
        let mut watch = lock(&term.watch);

        watch.poked = Instant::now();

        // Человек начал набирать сам: команда продолжения легла бы в его
        // строку. Ответы терминала на запросы оболочки начинаются с ESC.
        if !data.starts_with('\x1b') {
            watch.resume = None;
        }
    }

    term.pty.write(data.as_bytes())
}

#[tauri::command]
pub async fn terminal_resize(
    terminals: State<'_, Terminals>,
    pane: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    if let Some(term) = terminals.find(&pane) {
        lock(&term.watch).poked = Instant::now();
        term.pty.resize(cols, rows);
    }

    Ok(())
}

/// Панель закрыли, сама или с вкладкой. Агент работает, и терминал
/// доживает до конца его работы, иначе останавливается сразу.
#[tauri::command]
pub async fn terminal_close(terminals: State<'_, Terminals>, pane: String) -> Result<(), AppError> {
    if let Some(term) = terminals.find(&pane) {
        {
            let mut output = lock(&term.output);

            output.channel = None;
            output.closed = true;
        }

        let mut watch = lock(&term.watch);

        // Вкладку могут открыть снова: агент в ней продолжит разговор.
        watch.closing = true;

        if !watch.answering {
            drop(watch);
            term.pty.stop();
        }
    }

    Ok(())
}

/// Интеграции агентов в их настройках.
#[tauri::command]
pub fn agent_integrations(app: AppHandle) -> Result<Vec<Integration>, AppError> {
    Ok(integrations(&app)?.list())
}

#[tauri::command]
pub fn agent_integration_install(app: AppHandle, agent: String) -> Result<(), AppError> {
    integrations(&app)?.install(&agent)
}

#[tauri::command]
pub fn agent_integration_remove(app: AppHandle, agent: String) -> Result<(), AppError> {
    integrations(&app)?.remove(&agent)
}

fn integrations<R: Runtime>(app: &AppHandle<R>) -> Result<Integrations, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))?;

    Ok(Integrations::new(&home))
}

/// Есть ли Claude Code, какой версии и как выполнен вход.
#[tauri::command]
pub async fn agent_claude_status(app: AppHandle) -> Result<ClaudeStatus, AppError> {
    Ok(claude(&app)?.status().await)
}
