use crate::error::AppError;
use crate::modules::agent::domain::{
    ClaudeState, ClaudeStatus, INIT_REQUEST, USAGE_REQUEST, Usage, usage_reply,
};
use serde_json::{Value, json};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
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

/// Версия и вход отвечают за секунды.
const CHECK: Duration = Duration::from_secs(15);

/// Ответ на `initialize` дольше: до него Claude Code поднимает настройки,
/// плагины и серверы MCP человека.
const INIT_WAIT: Duration = Duration::from_secs(20);

/// Claude Code со входом пользователя. Строки Claude Code остаются здесь:
/// в лог и в ошибки уходит только код.
pub struct ClaudeCode {
    program: Option<PathBuf>,
    home: PathBuf,
    /// Папка данных приложения: в ней запускаются проверки и лимиты.
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

    /// Запуск Claude Code в папке данных, с окружением только из
    /// разрешённого списка. Ввод и оба вывода через трубы.
    fn spawn(&self, args: &[&str]) -> Result<Child, AppError> {
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
            .current_dir(&self.data)
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
        let child = self.spawn(args)?;

        timeout(CHECK, child.wait_with_output())
            .await
            .map_err(|_| AppError::unavailable("claude_failed"))?
            .map_err(|_| AppError::unavailable("claude_failed"))
    }

    pub async fn status(&self) -> ClaudeStatus {
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

    /// Запрос `get_usage`, как `/usage` в терминале. Управляющие запросы
    /// протокола stream-json идут, как их шлёт Agent SDK: первым
    /// `initialize`. Сообщения Claude Code не уходит, поэтому ни ответа
    /// модели, ни расхода подписки нет. Разбор расхода по скилам и плагинам
    /// не нужен, а без него Claude Code не читает журналы сессий за неделю.
    /// Ввод открыт до ответа: закрытый ввод Claude Code понял бы как конец.
    pub async fn usage(&self) -> Result<Usage, AppError> {
        let failed = || AppError::unavailable("claude_failed");
        let mut child = self.spawn(&[
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
        ])?;
        let mut stdin = child.stdin.take().ok_or_else(failed)?;
        let stdout = child.stdout.take().ok_or_else(failed)?;
        let requests = [
            (INIT_REQUEST, json!({ "subtype": "initialize" })),
            (
                USAGE_REQUEST,
                json!({ "subtype": "get_usage", "skip_behaviors": true }),
            ),
        ];

        for (id, request) in requests {
            let line = json!({ "type": "control_request", "request_id": id, "request": request });

            stdin
                .write_all(format!("{line}\n").as_bytes())
                .await
                .map_err(|_| failed())?;
        }

        // ponytail: stderr не читается. Короткий запуск в трубу почти
        // ничего не пишет, а Claude Code снимается вместе с `child`.
        let mut lines = BufReader::new(stdout).lines();
        let answer = async {
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(line) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };

                if let Some(answer) = usage_reply(&line) {
                    return answer;
                }
            }

            Err(failed())
        };

        timeout(INIT_WAIT, answer).await.map_err(|_| failed())?
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::modules::agent::domain::Limit;
    use std::collections::HashSet;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;
    use tauri::async_runtime::block_on;
    use tempfile::TempDir;

    /// Запуск по одному: свежий скрипт, открытый на запись в момент чужого
    /// fork, не запускается («Text file busy»).
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

    /// Ввод ещё открыт: закрытый настоящий Claude Code понимает как конец
    /// и выходит без ответа. Остаток ввода читает фоновый `cat`: жив он,
    /// значит, конца ввода нет. Фоновой команде sh даёт пустой ввод, поэтому
    /// настоящий передаётся через третий дескриптор.
    const OPEN_INPUT: &str = r#"open_input() {
    exec 3<&0
    cat <&3 >/dev/null &
    sleep 0.1
    kill -0 $! 2>/dev/null
}"#;

    /// Поддельный `claude` на месте родного установщика: пишет рядом с собой,
    /// с чем его позвали, и отвечает по сценарию `script`. Рядом папка
    /// данных приложения.
    fn fake(script: &str) -> (TempDir, ClaudeCode) {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let program = home.join(".local/bin/claude");

        fs::create_dir_all(program.parent().unwrap()).unwrap();
        fs::create_dir_all(dir.path().join("data")).unwrap();
        fs::write(
            &program,
            format!("#!/bin/sh\nhere=$(dirname \"$0\")\n{OPEN_INPUT}\n{script}\n"),
        )
        .unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();

        let claude = ClaudeCode::new(&home, &dir.path().join("data"));

        (dir, claude)
    }

    fn written(dir: &TempDir, name: &str) -> String {
        fs::read_to_string(dir.path().join("home/.local/bin").join(name)).unwrap()
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
        assert_eq!(
            block_on(claude.usage()),
            Err(AppError::not_found("claude_missing"))
        );

        // Отвечает не версией: такой Claude Code не годится.
        let (_dir, claude) = fake("echo 'команда не найдена'");
        assert_eq!(block_on(claude.status()).state, ClaudeState::Outdated);
    }

    /// Claude Code отвечает своими строками, чужим ответом и ответом
    /// на `initialize` вместе с аккаунтом, а за ним на `get_usage` с расходом
    /// сессии и окнами лимитов, если ввод остался открытым. Потом ждёт
    /// следующего ввода.
    const USAGE: &str = r#"
printf '%s\n' "$@" > "$here/args"
pwd -P > "$here/pwd"
read -r first
read -r second
printf '%s\n%s\n' "$first" "$second" > "$here/request"
open_input || exit 0
echo '{"type":"system","subtype":"init"}'
echo 'не json'
echo '{"type":"control_response","response":{"subtype":"success","request_id":"чужой","response":{"rate_limits_available":false}}}'
echo '{"type":"control_response","response":{"subtype":"success","request_id":"sapien-init","response":{"account":{"email":"me@example.com"}}}}'
echo '{"type":"control_response","response":{"subtype":"success","request_id":"sapien-usage","response":{"session":{"total_cost_usd":1},"subscription_type":"max","rate_limits_available":true,"rate_limits":{"five_hour":{"utilization":15,"resets_at":"2026-11-02T16:00:00Z"},"seven_day":{"utilization":24.5,"resets_at":null},"seven_day_opus":{"utilization":3,"resets_at":null}},"behaviors":null}}}'
while true; do sleep 0.02; done"#;

    #[test]
    fn лимиты_подписки_claude_code_отдаёт_на_get_usage_после_initialize() {
        let _one = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (dir, claude) = fake(USAGE);

        assert_eq!(
            block_on(claude.usage()),
            Ok(Usage {
                available: true,
                five_hour: Some(Limit {
                    used: 15.0,
                    resets: Some("2026-11-02T16:00:00Z".into()),
                }),
                seven_day: Some(Limit {
                    used: 24.5,
                    resets: None,
                }),
            })
        );
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
            written(&dir, "request")
                .lines()
                .map(|line| serde_json::from_str::<Value>(line).unwrap())
                .collect::<Vec<_>>(),
            [
                json!({ "type": "control_request", "request_id": "sapien-init", "request": { "subtype": "initialize" } }),
                json!({ "type": "control_request", "request_id": "sapien-usage", "request": { "subtype": "get_usage", "skip_behaviors": true } }),
            ]
        );
        assert_eq!(written(&dir, "pwd").trim(), real(&dir.path().join("data")));

        // Вход не по подписке: лимитов подписки нет.
        let (_dir, api) = fake(
            r#"read -r first
read -r second
echo '{"type":"control_response","response":{"subtype":"success","request_id":"sapien-usage","response":{"rate_limits_available":false,"rate_limits":null}}}'"#,
        );
        assert_eq!(
            block_on(api.usage()),
            Ok(Usage {
                available: false,
                five_hour: None,
                seven_day: None,
            })
        );

        let failed = Some(AppError::unavailable("claude_failed"));

        // Claude Code, который не знает `get_usage`, отказывает на него.
        let (_dir, old) = fake(
            r#"read -r first
read -r second
echo '{"type":"control_response","response":{"subtype":"error","request_id":"sapien-usage","error":"Unknown subtype"}}'"#,
        );
        assert_eq!(block_on(old.usage()).err(), failed);

        // Вывод кончился без ответа.
        let (_dir, silent) = fake("read -r first\necho '{\"type\":\"system\"}'");
        assert_eq!(block_on(silent.usage()).err(), failed);
    }
}
