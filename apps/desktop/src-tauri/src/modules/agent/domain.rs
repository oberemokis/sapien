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

/// Агенты, которых sapien узнаёт в терминале.
pub const AGENTS: [&str; 6] = ["claude", "codex", "pi", "opencode", "gemini", "cursor"];

/// Команды агентов. У остальных id совпадает с командой, а CLI Cursor
/// ставит себя и как `cursor-agent`, и как `agent`.
const PROGRAMS: [(&str, &str); 7] = [
    ("claude", "claude"),
    ("codex", "codex"),
    ("pi", "pi"),
    ("opencode", "opencode"),
    ("gemini", "gemini"),
    ("cursor-agent", "cursor"),
    ("agent", "cursor"),
];

/// Агент по командной строке процесса на переднем плане терминала.
/// Поставленный через npm агент идёт скриптом node, поэтому смотрится
/// и программа, и следующие за ней слова.
pub fn agent_of(command: &str) -> Option<&'static str> {
    command.split_whitespace().take(3).find_map(|word| {
        let name = word.rsplit('/').next()?;

        PROGRAMS
            .into_iter()
            .find_map(|(program, agent)| (program == name).then_some(agent))
    })
}

/// Интеграция агента в его настройках. `Missing`: агента на устройстве
/// нет, нет и папки его настроек.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationState {
    Missing,
    Off,
    On,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Integration {
    pub agent: &'static str,
    pub state: IntegrationState,
}

/// Разговор агента в панели: его продолжает панель после перезапуска.
/// `cwd`: папка, где агент работал, разговор ищется по ней. `transcript`:
/// файл разговора. Пока его нет, агент разговор не записал и продолжить
/// его не сможет.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Conversation {
    pub agent: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
}

/// Весть от интеграции агента: в панели `pane` идёт разговор. `source`:
/// с чего он начался, как его называет агент («startup», «resume», «clear»).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub pane: String,
    #[serde(flatten)]
    pub conversation: Conversation,
    #[serde(default)]
    pub source: String,
}

/// Сменил ли агент разговор сам: новый id с таким началом заменяет
/// прежний. С другим началом новый id приходит от агента, которого агент
/// панели запустил сам, а разговор панели остаётся прежним. Pi и OpenCode
/// сообщают только о разговоре своего окна.
fn switches(agent: &str, source: &str) -> bool {
    matches!(
        (agent, source),
        ("claude", "clear" | "resume" | "compact")
            | ("codex", "startup" | "clear" | "resume" | "compact")
            | ("pi" | "opencode" | "cursor", _)
    )
}

/// Принимает ли панель разговор из `report`, когда у неё уже есть
/// `current`. id и папка идут в набранную команду, поэтому управляющих
/// знаков в них быть не может.
pub fn accepts(current: Option<&Conversation>, report: &Report) -> bool {
    let next = &report.conversation;
    let clean = |text: &str| !text.is_empty() && !text.chars().any(char::is_control);

    if !AGENTS.contains(&next.agent.as_str())
        || !clean(&next.id)
        || !next.cwd.as_deref().is_none_or(clean)
    {
        return false;
    }

    match current {
        Some(current) if current.agent == next.agent && current.id != next.id => {
            switches(&next.agent, &report.source)
        }
        Some(current) => current != next,
        None => true,
    }
}

/// Строка в одинарных кавычках для оболочки: zsh, bash и fish читают её
/// как есть.
pub fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// Команда, которую панель набирает в новой оболочке, чтобы агент
/// продолжил разговор. Сначала переход в папку, где он работал.
pub fn resume_command(conversation: &Conversation) -> Option<String> {
    let id = quoted(&conversation.id);
    let program = match conversation.agent.as_str() {
        "claude" => format!("claude --resume {id}"),
        "codex" => format!("codex resume {id}"),
        "pi" => format!("pi --session {id}"),
        "opencode" => format!("opencode --session {id}"),
        "cursor" => format!("cursor-agent --resume {id}"),
        _ => return None,
    };

    Some(match &conversation.cwd {
        Some(cwd) => format!("cd {} && {program}", quoted(cwd)),
        None => program,
    })
}

/// Разговор из события хука агента `agent` (Claude Code, Codex, Cursor).
/// `None`: событие не о разговоре панели. Хук субагента Claude Code несёт
/// `agent_id`, а Cursor читает хуки Claude Code и зовёт их со своими
/// событиями. `thread`: `CODEX_THREAD_ID` окружения хука, у вложенного
/// Codex он чужой. Папку без `cwd` в событии даёт `dir` хука.
pub fn hook_report(
    agent: &str,
    event: &Value,
    pane: &str,
    thread: Option<&str>,
    dir: Option<String>,
) -> Option<Report> {
    let text = |key: &str| event[key].as_str().filter(|value| !value.is_empty());
    let (id, source) = match agent {
        "claude" if event.get("agent_id").is_some() || event.get("cursor_version").is_some() => {
            return None;
        }
        "claude" => (text("session_id")?, text("source").unwrap_or_default()),
        "codex" if text("transcript_path").is_none() => return None,
        "codex" => {
            let id = text("session_id")?;

            if thread.is_some_and(|thread| thread != id) {
                return None;
            }

            (id, text("source").unwrap_or_default())
        }
        "cursor" if event["is_background_agent"] == Value::Bool(true) => return None,
        "cursor" => (
            [
                "session_id",
                "sessionId",
                "conversation_id",
                "conversationId",
            ]
            .into_iter()
            .find_map(text)?,
            "",
        ),
        _ => return None,
    };
    let cwd = text("cwd")
        .map(str::to_owned)
        .or_else(|| event["workspace_roots"][0].as_str().map(str::to_owned))
        .or(dir);

    Some(Report {
        pane: pane.to_owned(),
        conversation: Conversation {
            agent: agent.to_owned(),
            id: id.to_owned(),
            cwd,
            transcript: text("transcript_path").map(str::to_owned),
        },
        source: source.to_owned(),
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
        assert_eq!(
            agent_of("/Users/me/.local/bin/cursor-agent"),
            Some("cursor")
        );
        assert_eq!(agent_of("agent --resume c1"), Some("cursor"));
        assert_eq!(agent_of("ssh-agent"), None);
        assert_eq!(agent_of("vim claude.md"), None);
        assert_eq!(agent_of("-zsh"), None);
        assert_eq!(agent_of("pnpm test"), None);
    }

    fn report(agent: &str, id: &str, source: &str) -> Report {
        Report {
            pane: "p".into(),
            conversation: Conversation {
                agent: agent.into(),
                id: id.into(),
                cwd: Some("/Users/me/sapien".into()),
                transcript: None,
            },
            source: source.into(),
        }
    }

    #[test]
    fn разговор_панели_меняет_только_сам_агент_а_не_запущенный_им() {
        let current = report("claude", "a1", "startup").conversation;

        assert!(accepts(None, &report("claude", "a1", "startup")));
        // /clear и /resume меняют разговор, а Claude Code, которого агент
        // запустил командой, начинает свой с startup и разговор не трогает.
        assert!(accepts(Some(&current), &report("claude", "b2", "clear")));
        assert!(accepts(Some(&current), &report("claude", "b2", "resume")));
        assert!(!accepts(Some(&current), &report("claude", "b2", "startup")));
        assert!(!accepts(Some(&current), &report("claude", "a1", "resume")));
        assert!(accepts(Some(&current), &report("codex", "c3", "startup")));
        // id и папка идут в набранную команду: перевод строки отправил бы её раньше.
        assert!(!accepts(None, &report("claude", "a1\rrm -rf ~", "startup")));
        assert!(!accepts(None, &report("vim", "a1", "startup")));
    }

    #[test]
    fn разговор_продолжается_своей_командой_агента_в_своей_папке() {
        let mut conversation = report("claude", "4f1c", "").conversation;

        assert_eq!(
            resume_command(&conversation).unwrap(),
            "cd '/Users/me/sapien' && claude --resume '4f1c'"
        );

        conversation.agent = "pi".into();
        conversation.id = "/Users/me/.pi/s/O'Brien.jsonl".into();
        conversation.cwd = None;
        assert_eq!(
            resume_command(&conversation).unwrap(),
            r"pi --session '/Users/me/.pi/s/O'\''Brien.jsonl'"
        );

        for (agent, command) in [
            ("codex", "codex resume 'x'"),
            ("opencode", "opencode --session 'x'"),
            ("cursor", "cursor-agent --resume 'x'"),
        ] {
            conversation.agent = agent.into();
            conversation.id = "x".into();
            assert_eq!(resume_command(&conversation).unwrap(), command);
        }

        conversation.agent = "gemini".into();
        assert_eq!(resume_command(&conversation), None);
    }

    #[test]
    fn хук_сообщает_разговор_панели_но_не_субагента_и_не_чужого_агента() {
        let claude = json!({ "session_id": "a1", "source": "clear", "cwd": "/w", "transcript_path": "/t/a1.jsonl" });
        let got = hook_report("claude", &claude, "p", None, None).unwrap();

        assert_eq!(got.conversation.id, "a1");
        assert_eq!(got.conversation.cwd.as_deref(), Some("/w"));
        assert_eq!(got.conversation.transcript.as_deref(), Some("/t/a1.jsonl"));
        assert_eq!(got.source, "clear");

        let subagent = json!({ "session_id": "a1", "agent_id": "x" });
        let in_cursor = json!({ "session_id": "a1", "cursor_version": "1.7" });

        assert_eq!(hook_report("claude", &subagent, "p", None, None), None);
        assert_eq!(hook_report("claude", &in_cursor, "p", None, None), None);

        // Cursor зовёт разговор по-разному, папку даёт workspace_roots.
        let cursor = json!({ "conversation_id": "c9", "workspace_roots": ["/w"] });
        let got = hook_report("cursor", &cursor, "p", None, None).unwrap();

        assert_eq!(got.conversation.id, "c9");
        assert_eq!(got.conversation.cwd.as_deref(), Some("/w"));

        // Вложенный Codex: у его хука чужой CODEX_THREAD_ID.
        let codex = json!({ "session_id": "t2", "transcript_path": "/t.jsonl" });

        assert!(hook_report("codex", &codex, "p", Some("t2"), Some("/d".into())).is_some());
        assert_eq!(hook_report("codex", &codex, "p", Some("t1"), None), None);
        assert_eq!(
            hook_report("codex", &codex, "p", None, Some("/d".into()))
                .unwrap()
                .conversation
                .cwd
                .as_deref(),
            Some("/d")
        );
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
