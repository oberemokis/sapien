use super::domain::{
    ClaudeStatus, Live, SessionInfo, TASK_VAR, Titles, agent_of, session_title, shell_args,
};
use super::infrastructure::claude_code::ClaudeCode;
use super::infrastructure::neighbours::ProjectFolders;
use super::infrastructure::sessions_dir::SessionsDir;
use super::infrastructure::terminal::{Command, Pty, command_line, shell_environment, user_shell};
use super::use_case;
use crate::durable;
use crate::error::AppError;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
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
/// вернуть курсор, выключить мышь и вставку скобками, сбросить цвет.
/// Новая оболочка начинается с чистой строки. Второй экран закрывает 1047,
/// а не 1049: тот ставит курсор туда, где его никто не сохранял, и новая
/// оболочка писала бы поверх прежнего экрана.
const RESET: &[u8] =
    b"\x1b[?1047l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m\r\n";

/// Размер терминала действия по расписанию, пока его не открыли.
const BACKGROUND_SIZE: (u16, u16) = (120, 40);

/// Вывод терминала: куда он идёт и что из него помнится.
struct Output {
    /// Канал вкладки. Без неё вывод только помнится.
    channel: Option<Channel>,
    screen: Vec<u8>,
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
}

/// Давно прошедший миг: с него агент ещё не работал.
fn long_ago() -> Instant {
    Instant::now()
        .checked_sub(QUIET)
        .unwrap_or_else(Instant::now)
}

/// Оболочка сессии в псевдотерминале.
struct Term {
    pty: Pty,
    output: Arc<Mutex<Output>>,
    watch: Arc<Mutex<Watch>>,
}

/// Терминалы по сессиям.
#[derive(Default)]
pub struct Terminals {
    terms: Mutex<HashMap<String, Arc<Term>>>,
}

impl Terminals {
    fn find(&self, session: &str) -> Option<Arc<Term>> {
        lock(&self.terms).get(session).cloned()
    }

    fn live(&self, session: &str) -> Option<Live> {
        let term = self.find(session)?;
        let watch = lock(&term.watch);

        Some(Live {
            agent: watch.agent,
            answering: watch.answering,
        })
    }

    fn answering(&self, session: &str) -> bool {
        self.live(session).is_some_and(|live| live.answering)
    }

    /// Сессию удаляют: терминал уходит из реестра сразу, чтобы его конец
    /// не сохранил экран удалённой сессии.
    fn stop(&self, session: &str) {
        if let Some(term) = lock(&self.terms).remove(session) {
            term.pty.stop();
        }
    }
}

fn changed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(SESSIONS_CHANGED, ());
}

/// Последний экран терминала остаётся сессии до следующего запуска.
fn keep_screen<R: Runtime>(app: &AppHandle<R>, session: &str, term: &Term) {
    let screen = lock(&term.output).screen.clone();

    if let Ok(store) = sessions(app) {
        let _ = store.save_screen(session, &screen);
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

/// Запускает оболочку сессии `session` в папке её проекта, с прежним
/// экраном над ней. С заданием `task` в ней сразу идёт Claude Code. Без
/// канала это действие по расписанию: вывод никто не смотрит, пока сессию
/// не откроют.
fn start(
    app: &AppHandle,
    terms: &mut HashMap<String, Arc<Term>>,
    session: &str,
    task: Option<&str>,
    channel: Option<Channel>,
    (cols, rows): (u16, u16),
) -> Result<(), AppError> {
    let store = sessions(app)?;
    let dir = use_case::folder(&store, &ProjectFolders(app.clone()), session)?;
    let mut env = shell_environment();
    let mut screen = store.screen(session).unwrap_or_default();

    if let Some(task) = task {
        env.push((TASK_VAR.into(), task.into()));
    }

    if !screen.is_empty() {
        screen.extend_from_slice(RESET);

        if let Some(channel) = &channel {
            let _ = channel.send(InvokeResponseBody::Raw(screen.clone()));
        }
    }

    let background = channel.is_none();
    let output = Arc::new(Mutex::new(Output { channel, screen }));
    let watch = Arc::new(Mutex::new(Watch {
        agent: None,
        group: None,
        worked: long_ago(),
        poked: Instant::now(),
        answering: false,
        titles: Titles::default(),
        title: None,
    }));
    let (into, seen, events, id) = (
        output.clone(),
        watch.clone(),
        app.clone(),
        session.to_owned(),
    );
    let (ended, gone) = (app.clone(), session.to_owned());
    let pty = Pty::spawn(
        Command {
            program: &user_shell(),
            args: &shell_args(task.is_some(), background),
            env,
            dir: &dir,
            cols,
            rows,
        },
        move |bytes| {
            let title = {
                let mut watch = lock(&seen);

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

    terms.insert(session.to_owned(), Arc::new(Term { pty, output, watch }));
    Ok(())
}

/// Оболочка сессии `session` кончилась. Реестр держит запуск до конца
/// вставки, поэтому оболочка, которая кончилась сразу, тоже уходит из него.
fn exited<R: Runtime>(app: &AppHandle<R>, session: &str) {
    let Some(term) = lock(&app.state::<Terminals>().terms).remove(session) else {
        return;
    };

    keep_screen(app, session, &term);
    let _ = app.emit(TERMINAL_EXITED, json!({ "session": session }));
    changed(app);
}

/// Что делает терминал: какой агент на переднем плане и работает ли он.
/// Отвечает, поменялось ли это и взялся ли агент только что за работу.
fn look(term: &Term) -> (bool, bool) {
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

    (
        (watch.agent, watch.answering) != before,
        watch.answering && !before.1,
    )
}

/// Сторож терминалов: узнаёт агентов и их работу, поднимает сессию,
/// в которой агент взялся за дело, и останавливает терминал закрытой
/// вкладки, в котором давно ничего не происходит.
fn watch<R: Runtime>(app: &AppHandle<R>) {
    loop {
        std::thread::sleep(TICK);

        let terms: Vec<(String, Arc<Term>)> = lock(&app.state::<Terminals>().terms)
            .iter()
            .map(|(session, term)| (session.clone(), term.clone()))
            .collect();
        let mut news = false;

        for (session, term) in terms {
            let (different, started) = look(&term);

            news |= different;

            if started {
                let _ = sessions(app)
                    .and_then(|store| use_case::touch(&store, &session, None, durable::now()));
            }

            let idle = {
                let watch = lock(&term.watch);

                !watch.answering && watch.worked.elapsed() > SILENCE
            };

            if idle && lock(&term.output).channel.is_none() {
                term.pty.stop();
            }
        }

        if news {
            changed(app);
        }
    }
}

/// Дверь для запуска приложения: сторож терминалов.
pub fn start_terminals<R: Runtime>(app: &AppHandle<R>) {
    let watched = app.clone();

    std::thread::spawn(move || watch(&watched));
}

/// Дверь для выхода из приложения: экраны остаются сессиям, а оболочки
/// и всё, что в них идёт, уходят с приложением.
pub fn stop_terminals<R: Runtime>(app: &AppHandle<R>) {
    let terms = std::mem::take(&mut *lock(&app.state::<Terminals>().terms));

    for (session, term) in terms {
        keep_screen(app, &session, &term);
        term.pty.stop();
    }
}

/// Сессии всех проектов, свежие первыми.
#[tauri::command]
pub fn agent_sessions(
    app: AppHandle,
    terminals: State<'_, Terminals>,
) -> Result<Vec<SessionInfo>, AppError> {
    use_case::sessions(&sessions(&app)?, |id| terminals.live(id))
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

/// Терминал вкладки сессии `session` размером `cols` на `rows`. Оболочка
/// сессии уже идёт, например окно перезагрузили или действие по расписанию
/// работает без вкладки, и вывод переключается в `on_data`, начиная с того,
/// что уже на экране. Иначе она запускается, с Claude Code и заданием
/// `task`, если оно есть.
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    session: String,
    cols: u16,
    rows: u16,
    task: Option<String>,
    on_data: Channel,
) -> Result<(), AppError> {
    let mut terms = lock(&terminals.terms);

    let Some(term) = terms.get(&session).cloned() else {
        return start(
            &app,
            &mut terms,
            &session,
            task.as_deref(),
            Some(on_data),
            (cols, rows),
        );
    };

    {
        let mut output = lock(&term.output);

        if !output.screen.is_empty() {
            let _ = on_data.send(InvokeResponseBody::Raw(output.screen.clone()));
        }

        output.channel = Some(on_data);
    }

    lock(&term.watch).poked = Instant::now();
    // Два новых размера заставляют полноэкранную программу перерисоваться
    // в новом окне.
    term.pty.resize(cols.saturating_sub(1).max(1), rows);
    term.pty.resize(cols, rows);
    Ok(())
}

/// Действие по расписанию: Claude Code с заданием `task` в оболочке сессии
/// `session` без вкладки и без разрешений. Открытая потом вкладка
/// подключается к нему.
#[tauri::command]
pub async fn terminal_run(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    session: String,
    task: String,
) -> Result<(), AppError> {
    let mut terms = lock(&terminals.terms);

    if terms.contains_key(&session) {
        return Err(AppError::conflict("agent_busy"));
    }

    start(
        &app,
        &mut terms,
        &session,
        Some(&task),
        None,
        BACKGROUND_SIZE,
    )
}

/// Ввод с клавиатуры вкладки. Оболочка уже кончилась, значит,
/// `terminal_missing`.
#[tauri::command]
pub async fn terminal_write(
    terminals: State<'_, Terminals>,
    session: String,
    data: String,
) -> Result<(), AppError> {
    let term = terminals
        .find(&session)
        .ok_or(AppError::not_found("terminal_missing"))?;

    lock(&term.watch).poked = Instant::now();
    term.pty.write(data.as_bytes())
}

#[tauri::command]
pub async fn terminal_resize(
    terminals: State<'_, Terminals>,
    session: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    if let Some(term) = terminals.find(&session) {
        lock(&term.watch).poked = Instant::now();
        term.pty.resize(cols, rows);
    }

    Ok(())
}

/// Вкладку закрыли. Агент работает, и терминал доживает до конца его
/// работы, иначе останавливается сразу.
#[tauri::command]
pub async fn terminal_close(
    terminals: State<'_, Terminals>,
    session: String,
) -> Result<(), AppError> {
    if let Some(term) = terminals.find(&session) {
        lock(&term.output).channel = None;

        if !lock(&term.watch).answering {
            term.pty.stop();
        }
    }

    Ok(())
}

/// Есть ли Claude Code, какой версии и как выполнен вход.
#[tauri::command]
pub async fn agent_claude_status(app: AppHandle) -> Result<ClaudeStatus, AppError> {
    Ok(claude(&app)?.status().await)
}
