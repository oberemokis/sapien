use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Claude Code на устройстве: через него агент расходует подписку Claude.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeState {
    Missing,
    /// Старше версии, которая знает все нужные флаги, или версию не разобрать.
    Outdated,
    LoggedOut,
    /// Вход ключом API или через облако: расходовал бы не подписку.
    NotSubscription,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClaudeStatus {
    pub state: ClaudeState,
    pub version: Option<String>,
}

/// Самая ранняя версия Claude Code, которая знает все нужные флаги.
const CLAUDE_MIN: [u32; 3] = [2, 1, 299];

/// Номер из вывода `claude --version`, например «2.1.316 (Claude Code)».
fn claude_version(output: &str) -> Option<(&str, [u32; 3])> {
    let text = output.split_whitespace().next()?;
    let mut parts = text.split('.').map(|part| part.parse::<u32>().ok());
    let number = [parts.next()??, parts.next()??, parts.next()??];

    parts.next().is_none().then_some((text, number))
}

impl ClaudeStatus {
    pub fn of_state(state: ClaudeState) -> Self {
        Self {
            state,
            version: None,
        }
    }

    /// По выводу `claude --version` и JSON из `claude auth status`. Без входа
    /// команда входа кончается ошибкой, и JSON нет.
    pub fn of(version: &str, auth: Option<&Value>) -> Self {
        let Some((text, number)) = claude_version(version) else {
            return Self::of_state(ClaudeState::Outdated);
        };
        let state = if number < CLAUDE_MIN {
            ClaudeState::Outdated
        } else {
            match auth.and_then(|auth| auth["authMethod"].as_str()) {
                Some("claude.ai" | "oauth_token") => ClaudeState::Ready,
                None | Some("none") => ClaudeState::LoggedOut,
                Some(_) => ClaudeState::NotSubscription,
            }
        };

        Self {
            state,
            version: Some(text.to_owned()),
        }
    }
}

/// Сессия sapien: терминал в папке проекта `project`, в котором человек
/// запускает агентов. Заголовок пустой, пока его не дал агент или человек.
/// Время в миллисекундах Unix.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project: String,
    pub title: String,
    /// Заголовок дал человек: заголовки терминала его больше не меняют.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub named: bool,
    pub created: u64,
    pub updated: u64,
    /// Разговор Claude Code из версий, где сессия сама его запускала.
    /// Хранится, чтобы его можно было продолжить: `claude --resume <id>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude: Option<String>,
}

/// Сессия в списке окна. Список читает её прямо из файла сессии.
/// `agents`: агенты на переднем плане её панелей, `answering`: хоть один
/// из них работает. Этих двух в файле нет.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub project: String,
    pub title: String,
    pub updated: u64,
    #[serde(skip_deserializing)]
    pub answering: bool,
    #[serde(skip_deserializing)]
    pub agents: Vec<PaneAgent>,
}

/// Агент в панели `pane` сессии и работает ли он.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneAgent {
    pub pane: String,
    pub agent: String,
    pub answering: bool,
}

impl Session {
    /// Пустая сессия `id` в проекте `project`, заведённая в `now`.
    pub fn new(id: String, project: &str, now: u64) -> Self {
        Self {
            id,
            project: project.to_owned(),
            title: String::new(),
            named: false,
            created: now,
            updated: now,
            claude: None,
        }
    }

    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            id: self.id.clone(),
            project: self.project.clone(),
            title: self.title.clone(),
            updated: self.updated,
            answering: false,
            agents: vec![],
        }
    }
}

/// Агенты, которых sapien узнаёт в терминале. id совпадает с командой.
pub const AGENTS: [&str; 5] = ["claude", "codex", "pi", "opencode", "gemini"];

/// Агент по командной строке процесса на переднем плане терминала.
/// Поставленный через npm агент идёт скриптом node, поэтому смотрится
/// и программа, и следующие за ней слова.
pub fn agent_of(command: &str) -> Option<&'static str> {
    command.split_whitespace().take(3).find_map(|word| {
        let name = word.rsplit('/').next()?;

        AGENTS.into_iter().find(|agent| *agent == name)
    })
}

/// Сколько знаков заголовка сессии берётся у агента.
const TITLE_LIMIT: usize = 60;

/// Имя сессии из заголовка, который агент поставил терминалу: без значков
/// работы в начале вроде «✳ » и «⠂ ». Заголовок с одним именем агента
/// ничего о сессии не говорит, как и пустой.
pub fn session_title(raw: &str) -> Option<String> {
    let text = raw
        .trim_start_matches(|char: char| !char.is_alphanumeric())
        .trim();
    let lower = text.to_lowercase();
    let generic = lower == "claude code" || AGENTS.contains(&lower.as_str());

    (!text.is_empty() && !generic).then(|| text.chars().take(TITLE_LIMIT).collect())
}

/// Сколько знаков в имени сессии, которое дал человек.
const NAME_LIMIT: usize = 100;

/// Имя сессии, которое дал человек, без пробелов по краям. Длинное или
/// с управляющими знаками не годится: `None`. Пустое годится, оно отдаёт
/// имя обратно агенту.
pub fn session_name(raw: &str) -> Option<String> {
    let text = raw.trim();

    (text.chars().count() <= NAME_LIMIT && !text.chars().any(char::is_control))
        .then(|| text.to_owned())
}

/// Состояние разбора заголовков в выводе.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
enum Osc {
    #[default]
    Text,
    Esc,
    Kind,
    Title,
    TitleEsc,
}

/// Самый длинный заголовок, который ещё дочитывается.
const OSC_LIMIT: usize = 1024;

/// Заголовки терминала (OSC 0 и OSC 2) из потока вывода. Последовательность
/// может прийти разрезанной между кусками, поэтому разбор помнит, где
/// остановился.
#[derive(Debug, Default)]
pub struct Titles {
    state: Osc,
    kind: Vec<u8>,
    text: Vec<u8>,
}

impl Titles {
    /// Последний целый заголовок из куска вывода.
    pub fn feed(&mut self, bytes: &[u8]) -> Option<String> {
        let mut found = None;

        for &byte in bytes {
            self.state = match (self.state, byte) {
                (Osc::Title, 0x07) | (Osc::TitleEsc, b'\\') => {
                    found = Some(String::from_utf8_lossy(&self.text).into_owned());
                    Osc::Text
                }
                (Osc::Title, 0x1b) => Osc::TitleEsc,
                (Osc::Title, _) if self.text.len() < OSC_LIMIT => {
                    self.text.push(byte);
                    Osc::Title
                }
                (_, 0x1b) => Osc::Esc,
                (Osc::Esc, b']') => {
                    self.kind.clear();
                    Osc::Kind
                }
                (Osc::Kind, b'0'..=b'9') if self.kind.len() < 4 => {
                    self.kind.push(byte);
                    Osc::Kind
                }
                (Osc::Kind, b';') if matches!(self.kind.as_slice(), b"0" | b"2") => {
                    self.text.clear();
                    Osc::Title
                }
                _ => Osc::Text,
            };
        }

        found
    }
}

/// Переменная, в которой задание действия доходит до оболочки: так его
/// не нужно экранировать ни для zsh, ни для bash, ни для fish.
pub const TASK_VAR: &str = "SAPIEN_TASK";

/// Оболочка входа сессии. С заданием она сначала запускает Claude Code
/// с ним первым сообщением, после `--`, чтобы оно не стало флагом, а когда
/// Claude Code кончится, уступает место обычной оболочке без задания
/// в окружении. Действие по расписанию идёт без человека, поэтому без
/// вопросов о разрешениях и без вопроса, согласен ли он на это.
pub fn shell_args(task: bool, background: bool) -> Vec<String> {
    let flags = if background {
        r#" --permission-mode bypassPermissions --settings '{"skipDangerousModePermissionPrompt":true}'"#
    } else {
        ""
    };

    if !task {
        return vec!["-l".into()];
    }

    vec![
        "-l".into(),
        "-i".into(),
        "-c".into(),
        format!(r#"claude{flags} -- "${TASK_VAR}"; exec env -u {TASK_VAR} "$SHELL" -l"#),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn агент_узнаётся_по_команде_и_по_скрипту_node() {
        assert_eq!(agent_of("claude"), Some("claude"));
        assert_eq!(
            agent_of("/Users/me/.local/bin/claude --resume 4f1c"),
            Some("claude")
        );
        assert_eq!(agent_of("node /opt/homebrew/bin/codex"), Some("codex"));
        assert_eq!(agent_of("node --no-warnings /usr/local/bin/pi"), Some("pi"));
        assert_eq!(agent_of("opencode run"), Some("opencode"));
        assert_eq!(agent_of("vim claude.md"), None);
        assert_eq!(agent_of("-zsh"), None);
        assert_eq!(agent_of("pnpm test"), None);
    }

    #[test]
    fn заголовок_терминала_собирается_из_кусков_вывода() {
        let mut titles = Titles::default();

        assert_eq!(titles.feed(b"\x1b]0;\xe2\x9c\xb3 Fix lo"), None);
        assert_eq!(
            titles.feed(b"gin bug\x07text"),
            Some("✳ Fix login bug".into())
        );
        // OSC 2 с ESC \ в конце, OSC 7 (папка) не заголовок.
        assert_eq!(
            titles.feed(b"\x1b]7;file:///tmp\x07\x1b]2;Second\x1b\\"),
            Some("Second".into())
        );
        // Цвета и прочие последовательности заголовков не дают.
        assert_eq!(titles.feed(b"\x1b[31mred\x1b[0m"), None);
    }

    #[test]
    fn имя_сессии_из_заголовка_без_значков_работы() {
        assert_eq!(
            session_title("✳ Fix login bug"),
            Some("Fix login bug".into())
        );
        assert_eq!(
            session_title("⠂ Почини сборку  "),
            Some("Почини сборку".into())
        );
        assert_eq!(session_title("✳ Claude Code"), None);
        assert_eq!(session_title("codex"), None);
        assert_eq!(session_title(" ✳ "), None);
        assert_eq!(
            session_title(&"я".repeat(80)).unwrap().chars().count(),
            TITLE_LIMIT
        );
    }

    #[test]
    fn имя_от_человека_без_пробелов_по_краям_и_управляющих_знаков() {
        assert_eq!(session_name("  Релиз 0.3  "), Some("Релиз 0.3".into()));
        assert_eq!(session_name("   "), Some(String::new()));
        assert_eq!(
            session_name(&"я".repeat(NAME_LIMIT)).map(|name| name.chars().count()),
            Some(NAME_LIMIT)
        );
        assert_eq!(session_name(&"я".repeat(NAME_LIMIT + 1)), None);
        assert_eq!(session_name("строка\nвторая"), None);
        assert_eq!(session_name("\x1b]0;чужой заголовок\x07"), None);
    }

    /// Скрипт оболочки с заданием `task` и поддельными `claude` и `$SHELL`,
    /// которые пишут, с чем их позвали и что видят в окружении.
    #[cfg(unix)]
    fn run_shell(task: &str, background: bool) -> (String, String) {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let fake = |name: &str, script: &str| {
            let path = dir.path().join(name);

            std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        };
        let here = dir.path().display();

        fake(
            "claude",
            &format!("printf '%s|' \"$@\" > '{here}/claude.args'"),
        );
        let shell = fake(
            "shell",
            &format!("echo \"$@ ${TASK_VAR}\" > '{here}/shell.args'"),
        );
        let args = shell_args(true, background);

        // Без -l и -i: оболочка входа читала бы настройки того, кто
        // запускает тесты.
        assert_eq!(args[..3], ["-l", "-i", "-c"]);
        let status = std::process::Command::new("/bin/sh")
            .args(&args[2..])
            .env_clear()
            .env("PATH", format!("{here}:/usr/bin:/bin"))
            .env("SHELL", &shell)
            .env(TASK_VAR, task)
            .status()
            .unwrap();

        assert!(status.success());
        let read = |name| std::fs::read_to_string(dir.path().join(name)).unwrap();

        (read("claude.args"), read("shell.args"))
    }

    #[cfg(unix)]
    #[test]
    fn задание_доходит_до_claude_code_как_есть_а_дальше_идёт_оболочка() {
        assert_eq!(shell_args(false, false), ["-l"]);

        let task = "--help 'это' \"$HOME\"\nи \\ `то`";
        let (claude, shell) = run_shell(task, false);

        assert_eq!(claude, format!("--|{task}|"));
        // Оболочка после Claude Code входа, и задания в её окружении нет.
        assert_eq!(shell, "-l \n");

        let (claude, _) = run_shell("сводка", true);

        assert_eq!(
            claude,
            r#"--permission-mode|bypassPermissions|--settings|{"skipDangerousModePermissionPrompt":true}|--|сводка|"#
        );
    }

    #[test]
    fn claude_code_годится_с_новой_версией_и_входом_по_подписке() {
        let state = |version: &str, auth: Option<Value>| ClaudeStatus::of(version, auth.as_ref());
        let method = |name: &str| Some(json!({ "loggedIn": true, "authMethod": name }));

        assert_eq!(
            state("2.1.316 (Claude Code)", method("claude.ai")),
            ClaudeStatus {
                state: ClaudeState::Ready,
                version: Some("2.1.316".into()),
            }
        );
        assert_eq!(
            state("2.1.299", method("oauth_token")).state,
            ClaudeState::Ready
        );
        assert_eq!(
            state("3.0.0", method("api_key")).state,
            ClaudeState::NotSubscription
        );
        assert_eq!(
            state("2.1.316", method("none")).state,
            ClaudeState::LoggedOut
        );
        assert_eq!(state("2.1.316", None).state, ClaudeState::LoggedOut);
        assert_eq!(
            state("2.1.298 (Claude Code)", method("claude.ai")),
            ClaudeStatus {
                state: ClaudeState::Outdated,
                version: Some("2.1.298".into()),
            }
        );
        assert_eq!(
            state("Claude Code", method("claude.ai")).state,
            ClaudeState::Outdated
        );
        assert_eq!(
            state("2.1.316.1", method("claude.ai")).state,
            ClaudeState::Outdated
        );
    }
}
