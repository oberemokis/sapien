use crate::error::AppError;
use crate::modules::agent::domain::{
    AgentModel, ClaudeState, ClaudeStatus, Commands, INIT_REQUEST, Init, Oversight, Stamp,
    init_reply,
};
use crate::modules::agent::ports::{Claude, Run};
use serde_json::{Value, json};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::timeout;

pub use talk::Talk;

/// Куда `claude` кладут родной установщик, Homebrew и npm на macOS.
/// Приложение из Finder не видит PATH оболочки, поэтому пути абсолютные.
const PLACES: [&str; 4] = [
    "~/.local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "~/.claude/local/claude",
];

/// Установка через npm запускает `node` по PATH.
const PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/// Что из окружения приложения доходит до Claude Code, кроме HOME и PATH.
/// Остальное вычищено: ключ API в окружении важнее входа по подписке.
/// По SHELL Claude Code снимает окружение оболочки человека для своих
/// команд, а SSH_AUTH_SOCK нужен git по ssh.
const PASSED: [&str; 7] = [
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "SHELL",
    "SSH_AUTH_SOCK",
    "CLAUDE_CONFIG_DIR",
];

/// Без необязательного трафика и автообновления: обновляет Claude Code
/// человек, а не приложение посреди ответа.
const ISOLATION: [(&str, &str); 2] = [
    ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
    ("DISABLE_AUTOUPDATER", "1"),
];

/// Чату ещё: вызов инструмента не уходит в фон, а сервер sapien говорит
/// по протоколу до ревизии 2026-07-28, в котором другое рукопожатие.
const CHAT_ENV: [(&str, &str); 2] = [
    ("CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS", "0"),
    ("MCP_PROTOCOL_NEGOTIATION", "legacy"),
];

/// Срок одного вызова инструмента в миллисекундах: вопрос человеку ждёт
/// десять минут, и Claude Code не должен оборвать его раньше.
const TOOL_WAIT: u64 = 900_000;

/// Версия и вход отвечают за секунды.
const CHECK: Duration = Duration::from_secs(15);

/// Ответ на `initialize` дольше: до него Claude Code поднимает настройки,
/// плагины и серверы MCP человека.
const INIT_WAIT: Duration = Duration::from_secs(20);

/// Сколько ходов Claude Code делает за один ответ. Работа в проекте идёт
/// десятками вызовов, а дальше это уже цикл, а не ответ.
const MAX_TURNS: &str = "200";

/// Флаги разрешений. Человек проверяет вызовы: Claude Code спрашивает
/// разрешения через `approve` sapien, а вопрос агента разрешён заранее.
/// Без проверки вызовы идут без вопросов.
fn access(oversight: Oversight) -> &'static [&'static str] {
    match oversight {
        Oversight::Ask => &[
            "--permission-mode",
            "default",
            "--permission-prompt-tool",
            "mcp__sapien__approve",
            "--allowedTools",
            "mcp__sapien__ask_user",
        ],
        Oversight::Trust | Oversight::Away => &["--permission-mode", "bypassPermissions"],
    }
}

/// Claude Code со входом пользователя. Работает в папке проекта с его
/// настройками, CLAUDE.md, серверами MCP и встроенными инструментами,
/// как в терминале. Строки Claude Code остаются здесь: в лог и в ошибки
/// уходит только код.
pub struct ClaudeCode {
    program: Option<PathBuf>,
    home: PathBuf,
    /// Папка данных приложения: там сокет сервера MCP и там же
    /// запускаются проверки версии и входа.
    data: PathBuf,
}

impl ClaudeCode {
    /// `data` это папка данных приложения, она уже есть.
    pub fn new(home: &Path, data: &Path) -> Self {
        let program = PLACES
            .iter()
            .map(|place| match place.strip_prefix("~/") {
                Some(rest) => home.join(rest),
                None => PathBuf::from(place),
            })
            .find(|path| path.is_file());

        Self {
            program,
            home: home.to_owned(),
            data: data.to_owned(),
        }
    }

    /// Запуск Claude Code в папке `dir`, с окружением только из разрешённого
    /// списка. Ввод и оба вывода через трубы.
    fn spawn(&self, dir: &Path, args: &[&str], env: &[(&str, &str)]) -> Result<Child, AppError> {
        let program = self
            .program
            .as_deref()
            .ok_or(AppError::not_found("claude_missing"))?;
        let mut command = Command::new(program);

        command
            .env_clear()
            .env("HOME", &self.home)
            .env("PATH", PATH)
            .envs(ISOLATION)
            .envs(env.iter().copied())
            .args(args)
            .current_dir(dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        for name in PASSED {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }

        command.spawn().map_err(|error| match error.kind() {
            ErrorKind::NotFound => AppError::not_found("claude_missing"),
            _ => AppError::unavailable("claude_failed"),
        })
    }

    /// Короткая команда без ввода: ввод закрывается сразу.
    async fn check(&self, args: &[&str]) -> Result<Output, AppError> {
        let child = self.spawn(&self.data, args, &[])?;

        timeout(CHECK, child.wait_with_output())
            .await
            .map_err(|_| AppError::unavailable("claude_failed"))?
            .map_err(|_| AppError::unavailable("claude_failed"))
    }

    /// Модели, команды и субагенты Claude Code отдаёт в ответ на запрос
    /// `initialize` протокола stream-json, как Agent SDK в
    /// `supportedModels()`. Запуск идёт в папке `dir`: команды и плагины
    /// у проекта свои. Сообщения ему не уходит, поэтому ни ответа модели,
    /// ни расхода подписки нет. Ввод открыт до ответа: закрытый ввод
    /// Claude Code понял бы как конец.
    async fn initialize(&self, dir: &Path) -> Result<Init, AppError> {
        let failed = || AppError::unavailable("claude_failed");
        let mut child = self.spawn(
            dir,
            &[
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
            ],
            &[],
        )?;
        let mut stdin = child.stdin.take().ok_or_else(failed)?;
        let stdout = child.stdout.take().ok_or_else(failed)?;
        let request = json!({
            "type": "control_request",
            "request_id": INIT_REQUEST,
            "request": { "subtype": "initialize" },
        });

        stdin
            .write_all(format!("{request}\n").as_bytes())
            .await
            .map_err(|_| failed())?;

        // ponytail: stderr не читается. Короткий запуск в трубу почти
        // ничего не пишет, а Claude Code снимается вместе с `child`.
        let mut lines = BufReader::new(stdout).lines();
        let reply = async {
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(line) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };

                if let Some(reply) = init_reply(&line) {
                    return reply;
                }
            }

            Err(failed())
        };

        timeout(INIT_WAIT, reply).await.map_err(|_| failed())?
    }
}

impl Claude for ClaudeCode {
    type Talk = Talk;

    async fn status(&self) -> ClaudeStatus {
        let version = match self.check(&["--version"]).await {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).into_owned()
            }
            Err(error) if error.code == "claude_missing" => {
                return ClaudeStatus::of_state(ClaudeState::Missing);
            }
            _ => return ClaudeStatus::of_state(ClaudeState::Outdated),
        };
        let auth = self
            .check(&["auth", "status"])
            .await
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| serde_json::from_slice::<Value>(&output.stdout).ok());

        ClaudeStatus::of(&version, auth.as_ref())
    }

    async fn models(&self) -> Result<Vec<AgentModel>, AppError> {
        Ok(self.initialize(&self.data).await?.models)
    }

    async fn commands(&self, dir: &Path) -> Result<Commands, AppError> {
        Ok(self.initialize(dir).await?.commands)
    }

    /// К инструментам Claude Code добавляется сервер sapien: Claude Code
    /// запускает само приложение командой `mcp`, а оно ходит в сокет этого
    /// хода. Через него идут вопросы агента и разрешения на вызовы. Сессия
    /// сохраняется: её продолжают следующим сообщением и в терминале.
    async fn converse(&self, run: &Run<'_>) -> Result<Talk, AppError> {
        // Ходы разных сессий идут параллельно, поэтому сокет у каждого свой.
        // Имя короткое: путь сокета unix не длиннее 104 байт.
        static TURNS: AtomicU64 = AtomicU64::new(0);

        let failed = |_| AppError::unavailable("claude_failed");
        let turn = TURNS.fetch_add(1, Ordering::Relaxed);
        let socket = self.data.join(format!("claude-{turn}.sock"));
        let listener = talk::listen(&socket)?;
        let bridge = std::env::current_exe().map_err(failed)?;
        let config = json!({
            "mcpServers": {
                "sapien": {
                    "type": "stdio",
                    "command": bridge,
                    "args": ["mcp", socket],
                    "alwaysLoad": true,
                    "timeout": TOOL_WAIT,
                },
            },
        })
        .to_string();
        let settings = json!({ "crossSessionInbound": "refuse" }).to_string();
        let mut args = vec![
            "-p",
            "--mcp-config",
            &config,
            "--settings",
            &settings,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--max-turns",
            MAX_TURNS,
            "--append-system-prompt",
            run.append,
        ];

        if let Some(model) = run.model {
            args.extend(["--model", model]);
        }

        if let Some(effort) = run.effort {
            args.extend(["--effort", effort]);
        }

        args.extend(access(run.oversight));

        if let Some(id) = run.resume {
            args.extend(["--resume", id]);

            if run.fork {
                args.push("--fork-session");
            }
        }

        let mut child = self.spawn(run.dir, &args, &CHAT_ENV)?;

        // Сообщение Claude Code читает целиком до начала ответа, поэтому
        // ввод пишется сразу и закрывается.
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(run.prompt.as_bytes()).await;
        }

        Ok(Talk::new(child, listener, socket))
    }

    /// Файл сессии лежит в папке проекта Claude Code: настоящий путь папки,
    /// где всё, кроме латиницы и цифр, заменено на «-». Содержимое sapien
    /// не читает, только размер и время правки.
    fn stamp(&self, dir: &Path, id: &str) -> Option<Stamp> {
        if !id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-')
        {
            return None;
        }

        // Claude Code видит папку без ссылок, как её отдаёт система.
        let dir = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_owned());
        let config = std::env::var_os("CLAUDE_CONFIG_DIR")
            .map_or_else(|| self.home.join(".claude"), PathBuf::from);
        let project: String = dir
            .to_string_lossy()
            .chars()
            .map(|char| {
                if char.is_ascii_alphanumeric() {
                    char
                } else {
                    '-'
                }
            })
            .collect();
        let file = config
            .join("projects")
            .join(project)
            .join(format!("{id}.jsonl"));
        let meta = std::fs::metadata(file).ok()?;
        let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;

        Some(Stamp {
            len: meta.len(),
            modified: u64::try_from(modified.as_millis()).ok()?,
        })
    }
}

/// Идущий ответ Claude Code: его потоки, сокет сервера MCP и остановка.
#[cfg(unix)]
mod talk {
    use crate::error::AppError;
    use crate::modules::agent::infrastructure::mcp::{self, Request};
    use crate::modules::agent::ports::{Conversation, Incoming};
    use serde_json::Value;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
    use tokio::net::UnixListener;
    use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
    use tokio::process::{Child, ChildStderr, ChildStdout};
    use tokio::time::{Instant, sleep_until, timeout};

    /// Сколько Claude Code даётся, чтобы выйти после SIGINT и после SIGTERM.
    const GRACE: Duration = Duration::from_secs(5);

    /// Сколько stderr держится для разбора отказа.
    const ERRORS_LIMIT: usize = 64 * 1024;

    /// Сокет хода, открытый только владельцу. Сокет от прошлого запуска,
    /// оборванного вместе с приложением, убирается.
    pub fn listen(socket: &Path) -> Result<UnixListener, AppError> {
        let failed = |_| AppError::unavailable("claude_failed");
        let _ = std::fs::remove_file(socket);
        let listener = UnixListener::bind(socket).map_err(failed)?;

        std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600)).map_err(failed)?;
        Ok(listener)
    }

    type Peer = (Lines<BufReader<OwnedReadHalf>>, OwnedWriteHalf);

    pub struct Talk {
        child: Child,
        out: Option<Lines<BufReader<ChildStdout>>>,
        err: Option<Lines<BufReader<ChildStderr>>>,
        listener: UnixListener,
        socket: PathBuf,
        peer: Option<Peer>,
        errors: String,
        /// Сколько сигналов уже ушло и когда последний.
        stopping: Option<(u8, Instant)>,
    }

    impl Talk {
        pub fn new(mut child: Child, listener: UnixListener, socket: PathBuf) -> Self {
            Self {
                out: child.stdout.take().map(|out| BufReader::new(out).lines()),
                err: child.stderr.take().map(|err| BufReader::new(err).lines()),
                child,
                listener,
                socket,
                peer: None,
                errors: String::new(),
                stopping: None,
            }
        }

        fn signal(&self, signal: libc::c_int) {
            if let Some(pid) = self
                .child
                .id()
                .and_then(|pid| libc::pid_t::try_from(pid).ok())
            {
                // SAFETY: kill только шлёт сигнал своему дочернему процессу,
                // память он не трогает.
                unsafe {
                    libc::kill(pid, signal);
                }
            }
        }

        /// Не вышел после SIGINT, получает SIGTERM, а после него снимается.
        fn escalate(&mut self) {
            match self.stopping {
                Some((1, _)) => {
                    self.signal(libc::SIGTERM);
                    self.stopping = Some((2, Instant::now()));
                }
                _ => {
                    let _ = self.child.start_kill();
                    self.stopping = Some((3, Instant::now()));
                }
            }
        }

        async fn send(&mut self, message: &Value) {
            if let Some((_, write)) = &mut self.peer
                && write
                    .write_all(format!("{message}\n").as_bytes())
                    .await
                    .is_err()
            {
                self.peer = None;
            }
        }
    }

    async fn line<R: tokio::io::AsyncBufRead + Unpin>(
        lines: &mut Option<Lines<R>>,
    ) -> Option<String> {
        match lines {
            Some(lines) => lines.next_line().await.ok().flatten(),
            None => std::future::pending().await,
        }
    }

    async fn asked(peer: &mut Option<Peer>) -> Option<String> {
        match peer {
            Some((lines, _)) => lines.next_line().await.ok().flatten(),
            None => std::future::pending().await,
        }
    }

    async fn until(deadline: Option<Instant>) {
        match deadline {
            Some(deadline) => sleep_until(deadline).await,
            None => std::future::pending().await,
        }
    }

    impl Conversation for Talk {
        async fn next(&mut self) -> Option<Incoming> {
            loop {
                if self.out.is_none() && self.err.is_none() {
                    // Потоки закрыты: процесс кончился или вот-вот кончится.
                    if timeout(GRACE, self.child.wait()).await.is_err() {
                        let _ = self.child.start_kill();
                    }

                    return None;
                }

                let deadline = self
                    .stopping
                    .filter(|(sent, _)| *sent < 3)
                    .map(|(_, at)| at + GRACE);

                tokio::select! {
                    read = line(&mut self.out) => match read {
                        Some(read) => {
                            // Строка не JSON это не событие потока.
                            if let Ok(value) = serde_json::from_str(&read) {
                                return Some(Incoming::Line(value));
                            }
                        }
                        None => self.out = None,
                    },
                    read = line(&mut self.err) => match read {
                        Some(read) if self.errors.len() < ERRORS_LIMIT => {
                            self.errors.push_str(&read);
                            self.errors.push('\n');
                        }
                        Some(_) => {}
                        None => self.err = None,
                    },
                    accepted = self.listener.accept() => {
                        if let Ok((stream, _)) = accepted {
                            let (read, write) = stream.into_split();

                            self.peer = Some((BufReader::new(read).lines(), write));
                        }
                    }
                    read = asked(&mut self.peer) => match read.as_deref().map(mcp::request) {
                        Some(Request::Call { id, name, input }) => {
                            return Some(Incoming::Call { id, name, input });
                        }
                        Some(Request::Reply(reply)) => self.send(&reply).await,
                        Some(Request::Ignore) => {}
                        None => self.peer = None,
                    },
                    () = until(deadline) => self.escalate(),
                }
            }
        }

        async fn reply(&mut self, id: Value, result: Result<String, String>) {
            self.send(&mcp::call_result(id, result)).await;
        }

        fn interrupt(&mut self) {
            if self.stopping.is_none() {
                self.signal(libc::SIGINT);
                self.stopping = Some((1, Instant::now()));
            }
        }

        fn errors(&self) -> &str {
            &self.errors
        }
    }

    impl Drop for Talk {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.socket);
        }
    }
}

/// Без сокетов unix чата через Claude Code нет: ответ не начинается.
#[cfg(not(unix))]
mod talk {
    use crate::error::AppError;
    use crate::modules::agent::ports::{Conversation, Incoming};
    use serde_json::Value;
    use std::path::Path;

    pub enum Talk {}

    pub fn listen(_socket: &Path) -> Result<std::convert::Infallible, AppError> {
        Err(AppError::invalid("claude_unsupported"))
    }

    impl Talk {
        pub fn new(
            _: tokio::process::Child,
            never: std::convert::Infallible,
            _: std::path::PathBuf,
        ) -> Self {
            match never {}
        }
    }

    impl Conversation for Talk {
        async fn next(&mut self) -> Option<Incoming> {
            match *self {}
        }

        async fn reply(&mut self, _id: Value, _result: Result<String, String>) {
            match *self {}
        }

        fn interrupt(&mut self) {
            match *self {}
        }

        fn errors(&self) -> &str {
            match *self {}
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::modules::agent::domain::{AgentCommand, Subagent};
    use crate::modules::agent::ports::{Conversation, Incoming};
    use std::collections::HashSet;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;
    use tauri::async_runtime::block_on;
    use tempfile::TempDir;

    /// Запуск по одному: свежий скрипт, открытый на запись в момент чужого
    /// fork, не запускается («Text file busy»).
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

    /// Поддельный `claude` на месте родного установщика: пишет рядом с собой,
    /// с чем его позвали, и отвечает по сценарию `script`. Рядом папка
    /// данных приложения и папка проекта.
    fn fake(script: &str) -> (TempDir, ClaudeCode) {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let program = home.join(".local/bin/claude");

        fs::create_dir_all(program.parent().unwrap()).unwrap();
        fs::create_dir_all(dir.path().join("data")).unwrap();
        fs::create_dir_all(dir.path().join("проект")).unwrap();
        fs::write(
            &program,
            format!("#!/bin/sh\nhere=$(dirname \"$0\")\n{script}\n"),
        )
        .unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();

        let claude = ClaudeCode::new(&home, &dir.path().join("data"));

        (dir, claude)
    }

    fn written(dir: &TempDir, name: &str) -> String {
        fs::read_to_string(dir.path().join("home/.local/bin").join(name)).unwrap()
    }

    /// Сокеты ходов в папке данных.
    fn sockets(dir: &TempDir) -> Vec<PathBuf> {
        fs::read_dir(dir.path().join("data"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension() == Some("sock".as_ref()))
            .collect()
    }

    fn real(path: &Path) -> String {
        path.canonicalize().unwrap().to_string_lossy().into_owned()
    }

    const SUBSCRIBED: &str = r#"
env > "$here/env"
pwd -P > "$here/pwd"
case "$1" in
  --version) echo "2.1.316 (Claude Code)" ;;
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai"}' ;;
esac"#;

    #[test]
    fn проверка_идёт_без_ключа_api_и_чужого_окружения() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (dir, claude) = fake(SUBSCRIBED);

        assert_eq!(
            block_on(claude.status()),
            ClaudeStatus {
                state: ClaudeState::Ready,
                version: Some("2.1.316".into()),
            }
        );
        assert_eq!(written(&dir, "pwd").trim(), real(&dir.path().join("data")));

        // Ключ API и прочее окружение приложения до процесса не доходят.
        let env = written(&dir, "env");
        let allowed: HashSet<_> = ["HOME", "PATH", "PWD", "OLDPWD", "SHLVL", "_"]
            .into_iter()
            .chain(PASSED)
            .chain(ISOLATION.map(|(name, _)| name))
            .collect();

        for line in env.lines() {
            let name = line.split('=').next().unwrap_or_default();

            assert!(allowed.contains(name), "{name}");
        }

        // CLAUDE.md, упоминания файлов и память Claude Code работают.
        assert!(!env.contains("CLAUDE_CODE_DISABLE_CLAUDE_MDS"));
        assert!(env.contains("DISABLE_AUTOUPDATER=1"));
        assert!(env.contains(&format!("HOME={}", dir.path().join("home").display())));
    }

    #[test]
    fn пропавший_claude_code_это_claude_missing() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        // Claude Code пропал после того, как его нашли.
        let (dir, claude) = fake("exit 0");
        fs::remove_file(dir.path().join("home/.local/bin/claude")).unwrap();
        assert_eq!(block_on(claude.status()).state, ClaudeState::Missing);

        // Отвечает не версией: такой Claude Code не годится.
        let (_dir, claude) = fake("echo 'команда не найдена'");
        assert_eq!(block_on(claude.status()).state, ClaudeState::Outdated);
    }

    #[test]
    fn с_проверкой_claude_code_спрашивает_разрешения_у_sapien() {
        assert_eq!(
            access(Oversight::Ask),
            [
                "--permission-mode",
                "default",
                "--permission-prompt-tool",
                "mcp__sapien__approve",
                "--allowedTools",
                "mcp__sapien__ask_user",
            ]
        );

        for oversight in [Oversight::Trust, Oversight::Away] {
            assert_eq!(
                access(oversight),
                ["--permission-mode", "bypassPermissions"]
            );
        }
    }

    /// Claude Code отвечает на `initialize` после своих строк и чужого
    /// ответа, а потом ждёт следующего ввода.
    const INITIALIZE: &str = r#"
printf '%s\n' "$@" > "$here/args"
pwd -P > "$here/pwd"
read -r line
printf '%s\n' "$line" > "$here/request"
echo '{"type":"system","subtype":"init"}'
echo 'не json'
echo '{"type":"control_response","response":{"subtype":"success","request_id":"чужой","response":{"models":[{"value":"чужая"}]}}}'
echo '{"type":"control_response","response":{"subtype":"success","request_id":"sapien-init","response":{"account":{"email":"me@example.com"},"models":[{"value":"default","displayName":"По умолчанию","description":"Рекомендуемая","supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max","ultra"]},{"value":"opus[1m]","resolvedModel":"claude-opus-5-5","displayName":"Opus","description":"","supportsEffort":false,"supportedEffortLevels":["low"]},{"value":"haiku","displayName":"Haiku","description":"Быстрая"},{"value":"--bad","displayName":"Флаг"}],"commands":[{"name":"review","description":"Ревью изменений","argumentHint":"[ветка]","aliases":["r"]},{"name":"compact","description":"Сжать разговор","builtin":true},{"description":"без имени"}],"agents":[{"name":"Explore","description":"Ищет по коду","model":"haiku"},{"name":"tester"},{"model":"opus"}]}}}'
while true; do sleep 0.02; done"#;

    #[test]
    fn модели_и_команды_claude_code_отдаёт_на_initialize_без_сообщения() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (dir, claude) = fake(INITIALIZE);
        let model =
            |id: &str, resolved: Option<&str>, name: &str, description: &str, efforts: &[&str]| {
                AgentModel {
                    id: id.into(),
                    resolved: resolved.map(str::to_owned),
                    name: name.into(),
                    description: description.into(),
                    efforts: efforts.iter().map(|effort| (*effort).to_owned()).collect(),
                }
            };

        assert_eq!(
            block_on(claude.models()),
            Ok(vec![
                model(
                    "default",
                    None,
                    "По умолчанию",
                    "Рекомендуемая",
                    &["low", "medium", "high", "xhigh", "max"]
                ),
                // Размышление модель не принимает: уровней нет.
                model("opus[1m]", Some("claude-opus-5-5"), "Opus", "", &[]),
                model("haiku", None, "Haiku", "Быстрая", &[]),
            ])
        );
        // Модели не зависят от проекта: Claude Code спрашивается из папки данных.
        assert_eq!(written(&dir, "pwd").trim(), real(&dir.path().join("data")));
        assert_eq!(
            written(&dir, "args").lines().collect::<Vec<_>>(),
            [
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose"
            ]
        );
        assert_eq!(
            serde_json::from_str::<Value>(&written(&dir, "request")).unwrap(),
            json!({ "type": "control_request", "request_id": "sapien-init", "request": { "subtype": "initialize" } })
        );

        let project = dir.path().join("проект");

        assert_eq!(
            block_on(claude.commands(&project)),
            Ok(Commands {
                commands: vec![
                    AgentCommand {
                        name: "review".into(),
                        description: "Ревью изменений".into(),
                        hint: "[ветка]".into(),
                        aliases: vec!["r".into()],
                        builtin: false,
                    },
                    AgentCommand {
                        name: "compact".into(),
                        description: "Сжать разговор".into(),
                        hint: String::new(),
                        aliases: vec![],
                        builtin: true,
                    },
                ],
                agents: vec![
                    Subagent {
                        name: "Explore".into(),
                        description: "Ищет по коду".into(),
                    },
                    Subagent {
                        name: "tester".into(),
                        description: String::new(),
                    },
                ],
            })
        );
        // Команды у проекта свои: Claude Code спрашивается из его папки.
        assert_eq!(written(&dir, "pwd").trim(), real(&project));

        let failed = Some(AppError::unavailable("claude_failed"));

        // Отказ на запрос и конец вывода без ответа.
        let (_dir, refusing) = fake(
            r#"read -r line
echo '{"type":"control_response","response":{"subtype":"error","request_id":"sapien-init","error":"нет"}}'"#,
        );
        assert_eq!(block_on(refusing.models()).err(), failed);

        let (_dir, silent) = fake("read -r line\necho '{\"type\":\"system\"}'");
        assert_eq!(block_on(silent.commands(&project)).err(), failed);

        // Claude Code пропал после того, как его нашли.
        fs::remove_file(dir.path().join("home/.local/bin/claude")).unwrap();
        assert_eq!(
            block_on(claude.models()),
            Err(AppError::not_found("claude_missing"))
        );
    }

    const TALKING: &str = r#"
printf '%s\n' "$@" > "$here/args"
env > "$here/env"
pwd -P > "$here/pwd"
cat > "$here/stdin"
echo '{"type":"system","subtype":"init","session_id":"s1"}'
echo 'не json'
echo 'журнал' >&2
while [ ! -f "$here/go" ]; do sleep 0.02; done
echo '{"type":"result","subtype":"success","is_error":false}'"#;

    fn run<'a>(dir: &'a Path, oversight: Oversight, resume: Option<&'static str>) -> Run<'a> {
        Run {
            dir,
            model: Some("claude-opus-5-5"),
            effort: Some("high"),
            append: "Спрашивай через sapien",
            prompt: "Привет",
            oversight,
            resume,
            fork: true,
        }
    }

    #[test]
    fn ответ_идёт_потоком_из_папки_проекта_а_вопросы_через_сокет_хода() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixStream;

        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (dir, claude) = fake(TALKING);
        let bin = dir.path().join("home/.local/bin");
        let project = dir.path().join("проект");

        let socket = block_on(async {
            let mut talk = claude
                .converse(&run(&project, Oversight::Ask, Some("s0")))
                .await
                .unwrap();
            let [socket] = &sockets(&dir)[..] else {
                panic!("у хода нет своего сокета");
            };
            let socket = socket.clone();

            assert_eq!(
                fs::metadata(&socket).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                talk.next().await,
                Some(Incoming::Line(
                    json!({ "type": "system", "subtype": "init", "session_id": "s1" })
                ))
            );

            // Мост sapien, как его запустил бы Claude Code.
            let bridge = std::thread::spawn({
                let socket = socket.clone();

                move || {
                    let stream = UnixStream::connect(socket).unwrap();
                    let mut lines = BufReader::new(stream.try_clone().unwrap()).lines();

                    (&stream)
                        .write_all(concat!(
                            r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#,
                            "\n",
                            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"approve","arguments":{"tool_name":"Bash","input":{"command":"ls"}}}}"#,
                            "\n",
                        ).as_bytes())
                        .unwrap();

                    [lines.next(), lines.next()]
                        .map(|line| serde_json::from_str::<Value>(&line.unwrap().unwrap()).unwrap())
                }
            });

            assert_eq!(
                talk.next().await,
                Some(Incoming::Call {
                    id: json!(1),
                    name: "approve".into(),
                    input: json!({ "tool_name": "Bash", "input": { "command": "ls" } }),
                })
            );
            talk.reply(json!(1), Ok(r#"{"behavior":"allow"}"#.into()))
                .await;

            let [shaken, answered] = bridge.join().unwrap();

            assert_eq!(shaken["result"]["serverInfo"]["name"], "sapien");
            assert_eq!(
                answered["result"]["content"][0]["text"],
                r#"{"behavior":"allow"}"#
            );

            fs::write(bin.join("go"), "").unwrap();

            assert_eq!(
                talk.next().await,
                Some(Incoming::Line(
                    json!({ "type": "result", "subtype": "success", "is_error": false })
                ))
            );
            assert_eq!(talk.next().await, None);
            assert_eq!(talk.errors(), "журнал\n");

            socket
        });

        // Сокет живёт только пока идёт ход.
        assert!(!socket.exists());
        assert_eq!(written(&dir, "pwd").trim(), real(&project));

        let args = written(&dir, "args");
        let args: Vec<_> = args.lines().collect();
        let pairs: Vec<_> = args.windows(2).collect();

        for flag in [
            "-p",
            "--verbose",
            "--include-partial-messages",
            "--fork-session",
        ] {
            assert!(args.contains(&flag), "{flag}");
        }

        // Claude Code работает с настройками, инструментами, навыками
        // и серверами человека, а сессия сохраняется: её продолжат следующим
        // сообщением.
        for flag in [
            "--disable-slash-commands",
            "--restricted",
            "--tools",
            "--strict-mcp-config",
            "--permission-prompts",
            "--system-prompt",
            "--no-session-persistence",
        ] {
            assert!(!args.contains(&flag), "{flag}");
        }

        for pair in [
            ["--permission-mode", "default"],
            ["--permission-prompt-tool", "mcp__sapien__approve"],
            ["--allowedTools", "mcp__sapien__ask_user"],
            ["--output-format", "stream-json"],
            ["--max-turns", "200"],
            ["--resume", "s0"],
            ["--model", "claude-opus-5-5"],
            ["--effort", "high"],
            ["--append-system-prompt", "Спрашивай через sapien"],
        ] {
            assert!(pairs.contains(&&pair[..]), "{pair:?}");
        }

        let at = args.iter().position(|arg| *arg == "--mcp-config").unwrap();
        let config: Value = serde_json::from_str(args[at + 1]).unwrap();
        let server = &config["mcpServers"]["sapien"];

        assert_eq!(server["args"], json!(["mcp", socket]));
        assert_eq!(server["command"], json!(std::env::current_exe().unwrap()));
        assert_eq!(server["alwaysLoad"], true);
        assert!(server["timeout"].as_u64() > Some(600_000));
        assert_eq!(written(&dir, "stdin"), "Привет");

        let env = written(&dir, "env");

        assert!(env.contains("CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0"));
        assert!(!env.contains("ANTHROPIC_API_KEY"));
    }

    #[test]
    fn параллельные_ходы_не_отнимают_друг_у_друга_сокет() {
        use std::os::unix::net::UnixStream;

        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (dir, claude) = fake(
            r#"cat > /dev/null
while true; do sleep 0.02; done"#,
        );
        let project = dir.path().join("проект");

        block_on(async {
            let first = claude
                .converse(&run(&project, Oversight::Ask, None))
                .await
                .unwrap();
            let second = claude
                .converse(&run(&project, Oversight::Ask, None))
                .await
                .unwrap();

            assert_eq!(sockets(&dir).len(), 2);

            // Второй ход кончился, первый слушает свой сокет дальше.
            drop(second);

            let [socket] = &sockets(&dir)[..] else {
                panic!("сокет первого хода пропал");
            };

            UnixStream::connect(socket).unwrap();
            drop(first);
        });

        assert!(sockets(&dir).is_empty());
    }

    #[test]
    fn стоп_прерывает_claude_code_а_не_вышел_он_снимается() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        let (dir, claude) = fake(
            r#"cat > /dev/null
trap 'echo "{\"type\":\"stopped\"}"; exit 130' INT
echo '{"type":"system"}'
while true; do sleep 0.02; done"#,
        );
        let project = dir.path().join("проект");

        block_on(async {
            let mut talk = claude
                .converse(&run(&project, Oversight::Trust, None))
                .await
                .unwrap();

            assert_eq!(
                talk.next().await,
                Some(Incoming::Line(json!({ "type": "system" })))
            );
            talk.interrupt();
            assert_eq!(
                talk.next().await,
                Some(Incoming::Line(json!({ "type": "stopped" })))
            );
            assert_eq!(talk.next().await, None);
        });

        // SIGINT не помог: следом идёт SIGTERM.
        let (dir, claude) = fake(
            r#"cat > /dev/null
trap '' INT
echo '{"type":"system"}'
while true; do sleep 0.02; done"#,
        );
        let project = dir.path().join("проект");

        block_on(async {
            let mut talk = claude
                .converse(&run(&project, Oversight::Trust, None))
                .await
                .unwrap();

            assert_eq!(
                talk.next().await,
                Some(Incoming::Line(json!({ "type": "system" })))
            );
            talk.interrupt();
            assert_eq!(talk.next().await, None);
        });
    }

    #[test]
    fn файл_сессии_берётся_из_папки_проекта_в_claude_code() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (dir, claude) = fake("exit 0");
        let project = dir.path().join("проект");
        let key = real(&project).replace(|char: char| !char.is_ascii_alphanumeric(), "-");
        let sessions = dir.path().join("home/.claude/projects").join(key);

        assert_eq!(claude.stamp(&project, "4f1c-9a"), None);

        fs::create_dir_all(&sessions).unwrap();
        fs::write(sessions.join("4f1c-9a.jsonl"), "{}\n{}\n").unwrap();

        assert_eq!(
            claude.stamp(&project, "4f1c-9a").map(|stamp| stamp.len),
            Some(6)
        );
        assert_eq!(claude.stamp(&project, "../4f1c-9a"), None);
    }
}
