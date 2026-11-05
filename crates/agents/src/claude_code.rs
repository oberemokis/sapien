use super::domain::{AgentsCode, ClaudeState, ClaudeStatus};
use sapien_kernel::{AppError, ErrorCode};
use serde_json::Value;
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::Duration;
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

    /// Где лежит `claude`. Не нашёлся, значит, `claude_missing`.
    fn program(&self) -> Result<&Path, AppError> {
        self.program
            .as_deref()
            .ok_or(AppError::not_found(AgentsCode::ClaudeMissing))
    }

    /// Окружение проверки только из разрешённого списка.
    fn environment(&self) -> Vec<(OsString, OsString)> {
        let fixed = [("HOME", self.home.as_os_str()), ("PATH", PATH.as_ref())]
            .into_iter()
            .chain(ISOLATION.map(|(name, value)| (name, value.as_ref())))
            .map(|(name, value)| (name.into(), value.to_owned()));
        let passed = PASSED
            .iter()
            .filter_map(|name| Some(((*name).into(), std::env::var_os(name)?)));

        fixed.chain(passed).collect()
    }

    /// Запуск Claude Code в папке данных, с окружением только из
    /// разрешённого списка. Ввод и оба вывода через трубы.
    fn spawn(&self, args: &[&str]) -> Result<Child, AppError> {
        let mut command = Command::new(self.program()?);

        command
            .env_clear()
            .envs(self.environment())
            .args(args)
            .current_dir(&self.data)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        command.spawn().map_err(|error| match error.kind() {
            ErrorKind::NotFound => AppError::not_found(AgentsCode::ClaudeMissing),
            _ => AppError::unavailable(AgentsCode::ClaudeFailed),
        })
    }

    /// Короткая команда без ввода: ввод закрывается сразу.
    async fn check(&self, args: &[&str]) -> Result<Output, AppError> {
        let child = self.spawn(args)?;

        timeout(CHECK, child.wait_with_output())
            .await
            .map_err(|_| AppError::unavailable(AgentsCode::ClaudeFailed))?
            .map_err(|_| AppError::unavailable(AgentsCode::ClaudeFailed))
    }

    pub async fn status(&self) -> ClaudeStatus {
        let version = match self.check(&["--version"]).await {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).into_owned()
            }
            Err(error) if error.code == AgentsCode::ClaudeMissing.as_str() => {
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
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;
    use tempfile::TempDir;

    /// Запуск по одному: свежий скрипт, открытый на запись в момент чужого
    /// fork, не запускается («Text file busy»).
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

    /// Проверка ждёт процесс и свой срок: однопоточному исполнителю tokio
    /// нужны ввод-вывод и часы, приложение для теста не нужно.
    fn block_on<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

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
}
