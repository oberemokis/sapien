use crate::error::AppError;
use crate::modules::agent::domain::{ClaudeState, ClaudeStatus, claude_failure};
use crate::modules::agent::ports::Claude;
use serde_json::{Value, json};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

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

    async fn run(
        &self,
        args: &[&str],
        input: Option<&str>,
        limit: Duration,
    ) -> Result<Output, AppError> {
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
            .args(args)
            .current_dir(&self.work)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        for name in PASSED {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }

        if input.is_some() {
            command.stdin(Stdio::piped());
        }

        let mut child = command.spawn().map_err(|error| match error.kind() {
            ErrorKind::NotFound => AppError::not_found("claude_missing"),
            _ => AppError::unavailable("claude_failed"),
        })?;
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
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
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
}
