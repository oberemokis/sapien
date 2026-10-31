use crate::error::AppError;
use crate::modules::agent::domain::{ClaudeState, ClaudeStatus, Stamp, claude_failure};
use crate::modules::agent::ports::{Claude, Run};
use serde_json::{Value, json};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
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
const PASSED: [&str; 5] = ["USER", "LOGNAME", "TMPDIR", "LANG", "CLAUDE_CONFIG_DIR"];

/// Без CLAUDE.md, `@`-упоминаний файлов, автопамяти, необязательного
/// трафика и автообновления.
const ISOLATION: [(&str, &str); 5] = [
    ("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1"),
    ("CLAUDE_CODE_DISABLE_FILE_MENTIONS", "1"),
    ("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1"),
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
/// Разбор длинной встречи с размышлениями идёт минутами.
const ANSWER: Duration = Duration::from_secs(600);

/// Claude Code со входом пользователя. Из его настроек не берётся ничего:
/// `--restricted` читает только настройки организации и `--settings`,
/// встроенных инструментов, серверов MCP и команд нет, рабочая папка пустая.
/// Строки Claude Code остаются здесь: в лог и в ошибки уходит только код.
pub struct ClaudeCode {
    program: Option<PathBuf>,
    home: PathBuf,
    work: PathBuf,
}

impl ClaudeCode {
    /// `work` это пустая папка приложения, она уже есть.
    pub fn new(home: &Path, work: &Path) -> Self {
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
            work: work.to_owned(),
        }
    }

    /// Запуск Claude Code в пустой рабочей папке, с окружением только
    /// из разрешённого списка. Ввод и оба вывода через трубы.
    fn spawn(&self, args: &[&str], env: &[(&str, &str)]) -> Result<Child, AppError> {
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
            .current_dir(&self.work)
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

    async fn run(
        &self,
        args: &[&str],
        input: Option<&str>,
        limit: Duration,
    ) -> Result<Output, AppError> {
        let mut child = self.spawn(args, &[])?;
        let stdin = child.stdin.take();
        // Ввод пишется вместе с ожиданием ответа: иначе полный вывод
        // процесса и недописанный ввод ждали бы друг друга.
        let feed = async move {
            if let (Some(input), Some(mut stdin)) = (input, stdin) {
                // Отказал до чтения ввода: причину скажет его ответ.
                let _ = stdin.write_all(input.as_bytes()).await;
            }
        };
        let (_, output) = timeout(limit, async {
            tokio::join!(feed, child.wait_with_output())
        })
        .await
        .map_err(|_| AppError::unavailable("claude_failed"))?;

        output.map_err(|_| AppError::unavailable("claude_failed"))
    }
}

impl Claude for ClaudeCode {
    type Talk = Talk;

    async fn status(&self) -> ClaudeStatus {
        let version = match self.run(&["--version"], None, CHECK).await {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).into_owned()
            }
            Err(error) if error.code == "claude_missing" => {
                return ClaudeStatus::of_state(ClaudeState::Missing);
            }
            _ => return ClaudeStatus::of_state(ClaudeState::Outdated),
        };
        let auth = self
            .run(&["auth", "status"], None, CHECK)
            .await
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| serde_json::from_slice::<Value>(&output.stdout).ok());

        ClaudeStatus::of(&version, auth.as_ref())
    }

    async fn structured(
        &self,
        model: &str,
        system: &str,
        schema: &Value,
        message: &str,
    ) -> Result<Value, AppError> {
        let schema = schema.to_string();
        let settings = json!({ "crossSessionInbound": "refuse" }).to_string();
        let args = [
            "-p",
            "--restricted",
            "--tools",
            "",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-session-persistence",
            "--settings",
            &settings,
            "--output-format",
            "json",
            "--json-schema",
            &schema,
            "--system-prompt",
            system,
            "--model",
            model,
        ];
        let output = self.run(&args, Some(message), ANSWER).await?;
        let stderr = String::from_utf8_lossy(&output.stderr);

        let Ok(result) = serde_json::from_slice::<Value>(&output.stdout) else {
            return Err(claude_failure(&stderr));
        };

        if result["subtype"] == "error_max_structured_output_retries" {
            return Err(AppError::invalid("agent_bad_answer"));
        }

        if result["subtype"] != "success" || result["is_error"] != false {
            let text = result["result"].as_str().unwrap_or_default();

            return Err(claude_failure(&format!("{text}\n{stderr}")));
        }

        result
            .get("structured_output")
            .cloned()
            .ok_or(AppError::invalid("agent_bad_answer"))
    }

    /// Встроенных инструментов нет, есть только сервер sapien: Claude Code
    /// запускает само приложение командой `mcp`, а оно ходит в сокет
    /// этого хода. Права на инструменты sapien даны заранее, остальное
    /// отклоняется без вопроса. Сессия сохраняется: её продолжают
    /// следующим сообщением и в терминале.
    async fn converse(&self, run: &Run<'_>) -> Result<Talk, AppError> {
        let failed = |_| AppError::unavailable("claude_failed");
        let socket = self.work.with_file_name("claude.sock");
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
            "--restricted",
            "--tools",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            &config,
            "--allowedTools",
            "mcp__sapien__*",
            "--permission-prompts",
            "none",
            "--disable-slash-commands",
            "--settings",
            &settings,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--max-turns",
            "30",
            "--system-prompt",
            run.system,
            "--model",
            run.model,
        ];

        if let Some(id) = run.resume {
            args.extend(["--resume", id]);

            if run.fork {
                args.push("--fork-session");
            }
        }

        let mut child = self.spawn(&args, &CHAT_ENV)?;

        // Сообщение Claude Code читает целиком до начала ответа, поэтому
        // ввод пишется сразу и закрывается.
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(run.prompt.as_bytes()).await;
        }

        Ok(Talk::new(child, listener, socket))
    }

    /// Файл сессии лежит в папке проекта Claude Code: путь рабочей папки,
    /// где всё, кроме латиницы и цифр, заменено на «-». Содержимое sapien
    /// не читает, только размер и время правки.
    fn stamp(&self, id: &str) -> Option<Stamp> {
        if !id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-')
        {
            return None;
        }

        let config = std::env::var_os("CLAUDE_CONFIG_DIR")
            .map_or_else(|| self.home.join(".claude"), PathBuf::from);
        let project: String = self
            .work
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
    /// с чем его позвали, и отвечает по сценарию `script`.
    fn fake(script: &str) -> (TempDir, ClaudeCode) {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let work = dir.path().join("work");
        let program = home.join(".local/bin/claude");

        fs::create_dir_all(program.parent().unwrap()).unwrap();
        fs::create_dir_all(&work).unwrap();
        fs::write(
            &program,
            format!("#!/bin/sh\nhere=$(dirname \"$0\")\n{script}\n"),
        )
        .unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();

        let claude = ClaudeCode::new(&home, &work);

        (dir, claude)
    }

    fn written(dir: &TempDir, name: &str) -> String {
        fs::read_to_string(dir.path().join("home/.local/bin").join(name)).unwrap()
    }

    const SUBSCRIBED: &str = r#"
printf '%s\n' "$@" > "$here/args"
env > "$here/env"
pwd -P > "$here/pwd"
case "$1" in
  --version) echo "2.1.316 (Claude Code)" ;;
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai"}' ;;
  *) cat > "$here/stdin"
     echo '{"type":"result","subtype":"success","is_error":false,"result":"","structured_output":{"tasks":[]}}' ;;
esac"#;

    #[test]
    fn запуск_отгорожен_от_настроек_и_окружения() {
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
        assert_eq!(
            block_on(claude.structured(
                "claude-sonnet-5-5",
                "Система",
                &json!({ "type": "object" }),
                "Запись встречи",
            )),
            Ok(json!({ "tasks": [] }))
        );

        let args = written(&dir, "args");
        let args: Vec<_> = args.lines().collect();
        let pairs: Vec<_> = args.windows(2).collect();

        for flag in [
            "-p",
            "--restricted",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-session-persistence",
        ] {
            assert!(args.contains(&flag), "{flag}");
        }

        for pair in [
            ["--tools", ""],
            ["--model", "claude-sonnet-5-5"],
            ["--system-prompt", "Система"],
            ["--output-format", "json"],
        ] {
            assert!(pairs.contains(&&pair[..]), "{pair:?}");
        }

        assert_eq!(written(&dir, "stdin"), "Запись встречи");
        assert_eq!(
            written(&dir, "pwd").trim(),
            dir.path()
                .join("work")
                .canonicalize()
                .unwrap()
                .to_str()
                .unwrap()
        );

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

        assert!(env.contains("CLAUDE_CODE_DISABLE_CLAUDE_MDS=1"));
        assert!(env.contains(&format!("HOME={}", dir.path().join("home").display())));
    }

    #[test]
    fn отказ_claude_code_разобран_по_причине() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let ask = |claude: &ClaudeCode| {
            block_on(claude.structured("claude-sonnet-5-5", "", &json!({}), "Текст"))
                .map_err(|error| error.code)
        };

        let (_dir, claude) = fake(
            r#"cat > /dev/null
echo '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}'"#,
        );
        assert_eq!(ask(&claude), Err("claude_logged_out"));

        let (_dir, claude) = fake("echo \"error: unknown option '--restricted'\" >&2\nexit 1");
        assert_eq!(ask(&claude), Err("claude_incompatible"));

        // Claude Code пропал после того, как его нашли.
        let (dir, claude) = fake("exit 0");
        fs::remove_file(dir.path().join("home/.local/bin/claude")).unwrap();
        assert_eq!(ask(&claude), Err("claude_missing"));
        assert_eq!(block_on(claude.status()).state, ClaudeState::Missing);
    }

    const TALKING: &str = r#"
printf '%s\n' "$@" > "$here/args"
env > "$here/env"
cat > "$here/stdin"
echo '{"type":"system","subtype":"init","session_id":"s1"}'
echo 'не json'
echo 'журнал' >&2
while [ ! -f "$here/go" ]; do sleep 0.02; done
echo '{"type":"result","subtype":"success","is_error":false}'"#;

    fn run(resume: Option<&'static str>) -> Run<'static> {
        Run {
            model: "claude-opus-5-5",
            system: "Система",
            prompt: "Привет",
            resume,
            fork: true,
        }
    }

    #[test]
    fn ответ_идёт_потоком_а_инструменты_через_сокет_хода() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixStream;

        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (dir, claude) = fake(TALKING);
        let socket = dir.path().join("claude.sock");
        let bin = dir.path().join("home/.local/bin");

        block_on(async {
            let mut talk = claude.converse(&run(Some("s0"))).await.unwrap();

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
                            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_note","arguments":{"path":"план.md"}}}"#,
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
                    name: "read_note".into(),
                    input: json!({ "path": "план.md" }),
                })
            );
            talk.reply(json!(1), Ok("# План".into())).await;

            let [shaken, answered] = bridge.join().unwrap();

            assert_eq!(shaken["result"]["serverInfo"]["name"], "sapien");
            assert_eq!(answered["result"]["content"][0]["text"], "# План");

            fs::write(bin.join("go"), "").unwrap();

            assert_eq!(
                talk.next().await,
                Some(Incoming::Line(
                    json!({ "type": "result", "subtype": "success", "is_error": false })
                ))
            );
            assert_eq!(talk.next().await, None);
            assert_eq!(talk.errors(), "журнал\n");
        });

        // Сокет живёт только пока идёт ход.
        assert!(!socket.exists());

        let args = written(&dir, "args");
        let args: Vec<_> = args.lines().collect();
        let pairs: Vec<_> = args.windows(2).collect();

        for flag in [
            "-p",
            "--restricted",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--verbose",
            "--include-partial-messages",
            "--fork-session",
        ] {
            assert!(args.contains(&flag), "{flag}");
        }

        // Сессия сохраняется: её продолжат следующим сообщением.
        assert!(!args.contains(&"--no-session-persistence"));

        for pair in [
            ["--tools", ""],
            ["--allowedTools", "mcp__sapien__*"],
            ["--permission-prompts", "none"],
            ["--output-format", "stream-json"],
            ["--max-turns", "30"],
            ["--resume", "s0"],
            ["--model", "claude-opus-5-5"],
            ["--system-prompt", "Система"],
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
        assert!(env.contains("CLAUDE_CODE_DISABLE_CLAUDE_MDS=1"));
        assert!(!env.contains("ANTHROPIC_API_KEY"));
    }

    #[test]
    fn стоп_прерывает_claude_code_а_не_вышел_он_снимается() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        let (_dir, claude) = fake(
            r#"cat > /dev/null
trap 'echo "{\"type\":\"stopped\"}"; exit 130' INT
echo '{"type":"system"}'
while true; do sleep 0.02; done"#,
        );

        block_on(async {
            let mut talk = claude.converse(&run(None)).await.unwrap();

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
        let (_dir, claude) = fake(
            r#"cat > /dev/null
trap '' INT
echo '{"type":"system"}'
while true; do sleep 0.02; done"#,
        );

        block_on(async {
            let mut talk = claude.converse(&run(None)).await.unwrap();

            assert_eq!(
                talk.next().await,
                Some(Incoming::Line(json!({ "type": "system" })))
            );
            talk.interrupt();
            assert_eq!(talk.next().await, None);
        });
    }

    #[test]
    fn файл_сессии_берётся_из_папки_проекта_claude_code() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (dir, claude) = fake("exit 0");
        let project: String = dir
            .path()
            .join("work")
            .to_string_lossy()
            .replace(|char: char| !char.is_ascii_alphanumeric(), "-");
        let sessions = dir.path().join("home/.claude/projects").join(project);

        assert_eq!(claude.stamp("4f1c-9a"), None);

        fs::create_dir_all(&sessions).unwrap();
        fs::write(sessions.join("4f1c-9a.jsonl"), "{}\n{}\n").unwrap();

        assert_eq!(claude.stamp("4f1c-9a").map(|stamp| stamp.len), Some(6));
        assert_eq!(claude.stamp("../4f1c-9a"), None);
    }
}
