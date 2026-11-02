use super::domain::{ClaudeState, ClaudeStatus, Effect, Hook, SessionInfo, Tracked};
use super::infrastructure::claude_code::ClaudeCode;
use super::infrastructure::neighbours::ProjectFolders;
use super::infrastructure::sessions_dir::SessionsDir;
use super::infrastructure::terminal::{Command, Pty};
use super::use_case::{self, Start};
use crate::durable;
use crate::error::AppError;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use uuid::Uuid;

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

fn sessions<R: Runtime>(app: &AppHandle<R>) -> Result<SessionsDir, AppError> {
    Ok(SessionsDir::new(&data_dir(app)?))
}

/// Подписка Claude через Claude Code пока только на macOS.
const CLAUDE_SUPPORTED: bool = cfg!(target_os = "macos");

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

/// Разговор терминала сменился, вкладка переходит к другой сессии.
const TERMINAL_MOVED: &str = "terminal-moved";

/// Claude Code терминала кончился.
const TERMINAL_EXITED: &str = "terminal-exited";

/// Действие по расписанию запустило Claude Code, а задание за это время
/// не ушло: скорее всего, он ждёт ответа в терминале.
const STALL: Duration = Duration::from_secs(30);

/// Сколько живёт Claude Code закрытой вкладки, который молчит посреди
/// ответа: дальше это зависший процесс.
const SILENCE: Duration = Duration::from_secs(600);

/// Размер терминала действия по расписанию, пока его не открыли.
const BACKGROUND_SIZE: (u16, u16) = (120, 40);

/// Куда идёт вывод терминала и когда он был последний раз.
struct Output {
    /// Канал вкладки. Без неё вывод читается и пропадает.
    channel: Mutex<Option<Channel>>,
    last: Mutex<Instant>,
}

/// Claude Code в псевдотерминале и что о нём известно.
struct Term {
    tracked: Mutex<Tracked>,
    pty: Pty,
    output: Arc<Output>,
    spawned: Instant,
}

/// Терминалы по меткам процессов. Метка уходит в хуки, а сессия, в которой
/// говорит процесс, меняется с `/clear`.
#[derive(Default)]
pub struct Terminals {
    terms: Mutex<HashMap<String, Arc<Term>>>,
    /// Сокет хуков. Не открылся, и Claude Code работает без них.
    hooks: Mutex<Option<PathBuf>>,
}

impl Terminals {
    fn find(&self, session: &str) -> Option<Arc<Term>> {
        lock(&self.terms)
            .values()
            .find(|term| lock(&term.tracked).session == session)
            .cloned()
    }

    fn live(&self, session: &str) -> Option<Tracked> {
        Some(lock(&self.find(session)?.tracked).clone())
    }

    fn answering(&self, session: &str) -> bool {
        self.live(session).is_some_and(|tracked| tracked.answering)
    }

    fn stop(&self, session: &str) {
        if let Some(term) = self.find(session) {
            term.pty.stop();
        }
    }

    /// Приложение закрывается: Claude Code всех терминалов уходит с ним.
    pub fn stop_all(&self) {
        for term in lock(&self.terms).values() {
            term.pty.stop();
        }
    }
}

fn changed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(SESSIONS_CHANGED, ());
}

/// Как открылся терминал: подключился к идущему Claude Code, запустил
/// новый разговор, продолжил прежний или начал заново, потому что Claude
/// Code прежнего не помнит.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Opened {
    Attached,
    Started,
    Resumed,
    Lost,
}

/// Запускает Claude Code сессии `session` в её папке. Без канала это
/// действие по расписанию: вывод никто не смотрит, пока сессию не откроют.
fn start(
    app: &AppHandle,
    terms: &mut HashMap<String, Arc<Term>>,
    session: &str,
    task: Option<&str>,
    channel: Option<Channel>,
    (cols, rows): (u16, u16),
) -> Result<Opened, AppError> {
    if !CLAUDE_SUPPORTED {
        return Err(AppError::invalid("claude_unsupported"));
    }

    let claude = claude(app)?;
    let program = claude.program()?.to_owned();
    let exe = std::env::current_exe().map_err(|_| AppError::unavailable("terminal_failed"))?;
    let background = channel.is_none();
    let plan = use_case::plan(
        &sessions(app)?,
        &ProjectFolders(app.clone()),
        |dir, id| claude.remembers(dir, id),
        Start {
            session,
            exe: &exe.to_string_lossy(),
            task,
            background,
        },
        || Uuid::new_v4().to_string(),
    )?;
    let token = Uuid::new_v4().to_string();
    let mut env = claude.environment();
    let hooks = lock(&app.state::<Terminals>().hooks).clone();

    env.extend([
        ("TERM".into(), "xterm-256color".into()),
        ("COLORTERM".into(), "truecolor".into()),
        ("SAPIEN_TERMINAL".into(), OsString::from(&token)),
    ]);

    if let Some(hooks) = hooks {
        env.push(("SAPIEN_HOOKS".into(), hooks.into()));
    }

    let output = Arc::new(Output {
        channel: Mutex::new(channel),
        last: Mutex::new(Instant::now()),
    });
    let into = output.clone();
    let ended = app.clone();
    let gone = token.clone();
    let pty = Pty::spawn(
        Command {
            program: &program,
            args: &plan.args,
            env,
            dir: &plan.dir,
            cols,
            rows,
        },
        move |bytes| {
            *lock(&into.last) = Instant::now();

            if let Some(channel) = &*lock(&into.channel) {
                // Окно перезагружают: вывод до нового канала пропадает.
                let _ = channel.send(InvokeResponseBody::Raw(bytes.to_vec()));
            }
        },
        move || exited(&ended, &gone),
    )?;

    terms.insert(
        token,
        Arc::new(Term {
            tracked: Mutex::new(Tracked::new(session.to_owned(), !background)),
            pty,
            output,
            spawned: Instant::now(),
        }),
    );

    Ok(match (plan.resumed, plan.lost) {
        (true, _) => Opened::Resumed,
        (false, true) => Opened::Lost,
        (false, false) => Opened::Started,
    })
}

/// Claude Code терминала `token` кончился. Реестр держит запуск до конца
/// вставки, поэтому процесс, который кончился сразу, тоже уходит из него.
fn exited<R: Runtime>(app: &AppHandle<R>, token: &str) {
    let Some(term) = lock(&app.state::<Terminals>().terms).remove(token) else {
        return;
    };
    let session = lock(&term.tracked).session.clone();

    let _ = app.emit(TERMINAL_EXITED, json!({ "session": session }));
    changed(app);
}

/// Событие хука от Claude Code терминала `token`. Незнакомая метка
/// и событие сессии, которой уже нет, ничего не меняют.
fn hooked<R: Runtime>(app: &AppHandle<R>, token: &str, event: &Value) {
    let Some(hook) = Hook::of(event) else {
        return;
    };
    let terminals = app.state::<Terminals>();
    let (term, owned) = {
        let terms = lock(&terminals.terms);
        let Some(term) = terms.get(token).cloned() else {
            return;
        };
        let owned: Vec<String> = terms
            .iter()
            .filter(|(other, _)| *other != token)
            .map(|(_, term)| lock(&term.tracked).session.clone())
            .collect();

        (term, owned)
    };
    let Ok(store) = sessions(app) else {
        return;
    };
    let effect = use_case::on_hook(
        &store,
        &mut lock(&term.tracked),
        hook,
        &owned,
        durable::fresh_id,
        durable::now(),
    );

    match effect {
        Ok(Some(Effect::Changed)) => changed(app),
        Ok(Some(Effect::Moved { from, to })) => {
            let _ = app.emit(TERMINAL_MOVED, json!({ "from": from, "to": to }));
            changed(app);
        }
        Ok(Some(Effect::Stop)) => term.pty.stop(),
        Ok(None) | Err(_) => {}
    }
}

/// Сторож терминалов: отмечает действия, задание которых не ушло,
/// и останавливает Claude Code закрытой вкладки, который давно молчит.
fn watch<R: Runtime>(app: &AppHandle<R>) {
    loop {
        std::thread::sleep(Duration::from_secs(5));

        let terms: Vec<Arc<Term>> = lock(&app.state::<Terminals>().terms)
            .values()
            .cloned()
            .collect();
        let mut stalled = false;

        for term in terms {
            let mut tracked = lock(&term.tracked);

            if tracked.background
                && !tracked.prompted
                && !tracked.stalled
                && term.spawned.elapsed() > STALL
            {
                tracked.stalled = true;
                stalled = true;
            }

            if !tracked.open && tracked.prompted && lock(&term.output.last).elapsed() > SILENCE {
                term.pty.stop();
            }
        }

        if stalled {
            changed(app);
        }
    }
}

/// Дверь для запуска приложения: сокет хуков и сторож терминалов.
/// Без сокета терминал работает, но не знает, отвечает ли агент.
pub fn start_terminals<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(unix)]
    if let Ok(data) = data_dir(app) {
        let events = app.clone();
        let _ = std::fs::create_dir_all(&data);

        match super::infrastructure::hooks::listen(&data, move |token, event| {
            hooked(&events, &token, &event);
        }) {
            Ok(socket) => *lock(&app.state::<Terminals>().hooks) = Some(socket),
            Err(error) => log::warn!("сокет хуков Claude Code не открылся: {error}"),
        }
    }

    let watched = app.clone();

    std::thread::spawn(move || watch(&watched));
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
/// из списка, и останавливает их Claude Code. Хоть в одной из них отвечает
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

/// Терминал вкладки сессии `session` размером `cols` на `rows`. Claude Code
/// сессии уже идёт, например окно перезагрузили или действие по расписанию
/// работает без вкладки, и вывод переключается в `on_data`. Иначе он
/// запускается, с заданием `task` первым сообщением, если оно есть.
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    session: String,
    cols: u16,
    rows: u16,
    task: Option<String>,
    on_data: Channel,
) -> Result<Opened, AppError> {
    let mut terms = lock(&terminals.terms);
    let found = terms
        .values()
        .find(|term| lock(&term.tracked).session == session)
        .cloned();

    if let Some(term) = found {
        *lock(&term.output.channel) = Some(on_data);
        lock(&term.tracked).open = true;
        // Новое окно не видело прежнего вывода: два новых размера
        // заставляют Claude Code перерисовать экран.
        term.pty.resize(cols.saturating_sub(1).max(1), rows);
        term.pty.resize(cols, rows);
        return Ok(Opened::Attached);
    }

    start(
        &app,
        &mut terms,
        &session,
        task.as_deref(),
        Some(on_data),
        (cols, rows),
    )
}

/// Действие по расписанию: Claude Code сессии `session` с заданием `task`
/// без вкладки и без разрешений. Открытая потом вкладка подключается к нему.
#[tauri::command]
pub async fn terminal_run(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    session: String,
    task: String,
) -> Result<(), AppError> {
    let mut terms = lock(&terminals.terms);

    if terms
        .values()
        .any(|term| lock(&term.tracked).session == session)
    {
        return Err(AppError::conflict("agent_busy"));
    }

    start(
        &app,
        &mut terms,
        &session,
        Some(&task),
        None,
        BACKGROUND_SIZE,
    )?;
    Ok(())
}

/// Ввод с клавиатуры вкладки. Claude Code уже кончился, значит,
/// `terminal_missing`.
#[tauri::command]
pub async fn terminal_write(
    terminals: State<'_, Terminals>,
    session: String,
    data: String,
) -> Result<(), AppError> {
    terminals
        .find(&session)
        .ok_or(AppError::not_found("terminal_missing"))?
        .pty
        .write(data.as_bytes())
}

#[tauri::command]
pub async fn terminal_resize(
    terminals: State<'_, Terminals>,
    session: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    if let Some(term) = terminals.find(&session) {
        term.pty.resize(cols, rows);
    }

    Ok(())
}

/// Вкладку закрыли. Агент отвечает, и Claude Code доживает до конца
/// ответа, иначе останавливается сразу.
#[tauri::command]
pub async fn terminal_close(
    terminals: State<'_, Terminals>,
    session: String,
) -> Result<(), AppError> {
    if let Some(term) = terminals.find(&session) {
        let mut tracked = lock(&term.tracked);

        tracked.open = false;
        *lock(&term.output.channel) = None;

        if !tracked.answering {
            term.pty.stop();
        }
    }

    Ok(())
}

/// Есть ли Claude Code, какой версии и как выполнен вход.
#[tauri::command]
pub async fn agent_claude_status(app: AppHandle) -> Result<ClaudeStatus, AppError> {
    if !CLAUDE_SUPPORTED {
        return Ok(ClaudeStatus::of_state(ClaudeState::Unsupported));
    }

    Ok(claude(&app)?.status().await)
}
