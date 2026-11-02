use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Номер запроса `initialize`, которым sapien спрашивает Claude Code.
pub const INIT_REQUEST: &str = "sapien-init";

/// Номер запроса `get_usage`.
pub const USAGE_REQUEST: &str = "sapien-usage";

/// Ответ Claude Code на управляющий запрос `id`, если строка это он.
/// Остальные строки дают `None`.
fn control_reply<'a>(line: &'a Value, id: &str) -> Option<Result<&'a Value, AppError>> {
    let response = &line["response"];

    if line["type"] != "control_response" || response["request_id"] != id {
        return None;
    }

    if response["subtype"] != "success" {
        return Some(Err(AppError::unavailable("claude_failed")));
    }

    Some(Ok(&response["response"]))
}

/// Окно лимита подписки: сколько процентов израсходовано и когда оно
/// сбросится, время ISO 8601 как у claude.ai.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub used: f64,
    pub resets: Option<String>,
}

impl Limit {
    /// Окно без процента неизвестно, его нет.
    fn of(info: &Value) -> Option<Self> {
        Some(Self {
            used: info["utilization"].as_f64()?,
            resets: info["resets_at"].as_str().map(str::to_owned),
        })
    }
}

/// Лимиты подписки Claude за пять часов и за неделю. `available` ложно,
/// когда вход не по подписке и лимитов подписки у него нет.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub available: bool,
    pub five_hour: Option<Limit>,
    pub seven_day: Option<Limit>,
}

/// Ответ на `get_usage` из строки Claude Code, если это он. Из ответа
/// берутся только окна лимитов: расход сессии и разбор по скилам
/// sapien не нужны.
pub fn usage_reply(line: &Value) -> Option<Result<Usage, AppError>> {
    Some(control_reply(line, USAGE_REQUEST)?.map(|usage| {
        let limits = &usage["rate_limits"];

        Usage {
            available: usage["rate_limits_available"] == true,
            five_hour: Limit::of(&limits["five_hour"]),
            seven_day: Limit::of(&limits["seven_day"]),
        }
    }))
}

/// Claude Code на устройстве: через него агент расходует подписку Claude.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeState {
    /// Пока только macOS.
    Unsupported,
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

/// Сессия sapien: отдельный разговор с агентом в папке проекта `project`.
/// Сам разговор хранит Claude Code, а здесь его id `claude`: без него
/// сессия ещё не говорила. Заголовок пустой до первого сообщения. Время
/// в миллисекундах Unix.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project: String,
    pub title: String,
    pub created: u64,
    pub updated: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude: Option<String>,
}

/// Сессия в списке окна. Список читает её прямо из файла сессии.
/// `answering`: в ней сейчас отвечает агент. `stalled`: действие
/// по расписанию запустило Claude Code, а задание не ушло, например он
/// ждёт ответа о доверии к папке. Этих двух в файле нет. `claude` окну
/// не нужен и не уходит в него.
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
    pub stalled: bool,
    #[serde(default, skip_serializing)]
    pub claude: Option<String>,
}

impl Session {
    /// Пустая сессия `id` в проекте `project`, заведённая в `now`.
    pub fn new(id: String, project: &str, now: u64) -> Self {
        Self {
            id,
            project: project.to_owned(),
            title: String::new(),
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
            stalled: false,
            claude: self.claude.clone(),
        }
    }
}

/// Сколько знаков заголовка сессии берётся из первого сообщения.
const TITLE_LIMIT: usize = 60;

/// Заголовок сессии по первому сообщению человека: его первая строка.
pub fn title(text: &str) -> String {
    let line = text.trim().lines().next().unwrap_or_default().trim();

    line.chars().take(TITLE_LIMIT).collect()
}

/// id разговора Claude Code годится в аргумент: uuid, без флага и чужих
/// знаков.
pub fn valid_claude(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && id
            .chars()
            .all(|char| char.is_ascii_hexdigit() || char == '-')
}

/// Событие хука Claude Code, которое передаёт подкоманда `sapien hook`.
#[derive(Debug, Clone, PartialEq)]
pub enum Hook {
    /// Разговор начался: запуск, `/clear`, `/resume` или сжатие (`compact`).
    Start { claude: String, compact: bool },
    /// Человек отправил сообщение.
    Prompt { text: String },
    /// Ответ кончился, в том числе отказом.
    Stop,
    /// Claude Code ждёт человека: разрешения или, `idle`, следующего
    /// сообщения.
    Notification { idle: bool },
}

impl Hook {
    /// Событие из JSON хука. Незнакомое или без нужного поля даёт `None`.
    pub fn of(event: &Value) -> Option<Self> {
        match event["hook_event_name"].as_str()? {
            "SessionStart" => Some(Self::Start {
                claude: event["session_id"]
                    .as_str()
                    .filter(|id| valid_claude(id))?
                    .to_owned(),
                compact: event["source"] == "compact",
            }),
            "UserPromptSubmit" => Some(Self::Prompt {
                text: event["prompt"].as_str().unwrap_or_default().to_owned(),
            }),
            "Stop" | "StopFailure" => Some(Self::Stop),
            "Notification" => Some(Self::Notification {
                idle: event["notification_type"] == "idle_prompt",
            }),
            _ => None,
        }
    }
}

/// Что sapien знает о Claude Code, запущенном в терминале.
#[derive(Debug, Clone, PartialEq)]
pub struct Tracked {
    /// Сессия sapien, в которой он говорит сейчас: после `/clear` другая.
    pub session: String,
    pub answering: bool,
    /// Вкладка сессии открыта в окне.
    pub open: bool,
    /// Запущен действием по расписанию, без вкладки.
    pub background: bool,
    /// Хоть одно сообщение или задание уже ушло.
    pub prompted: bool,
    /// Первый `SessionStart` этого процесса уже пришёл.
    pub started: bool,
    /// Запущен по расписанию, а задание так и не ушло.
    pub stalled: bool,
}

impl Tracked {
    /// Claude Code сессии `session`: во вкладке или, без неё, по расписанию.
    pub fn new(session: String, open: bool) -> Self {
        Self {
            session,
            answering: false,
            open,
            background: !open,
            prompted: false,
            started: false,
            stalled: false,
        }
    }
}

/// Что делать после события хука.
#[derive(Debug, PartialEq)]
pub enum Effect {
    /// Окну перечитать сессии.
    Changed,
    /// Разговор в терминале сменился: вкладка переходит к сессии `to`.
    Moved { from: String, to: String },
    /// Процесс больше не нужен: вкладку закрыли, а ответ кончился.
    Stop,
}

/// События Claude Code, о которых узнаёт sapien.
const HOOKED: [&str; 5] = [
    "SessionStart",
    "UserPromptSubmit",
    "Stop",
    "StopFailure",
    "Notification",
];

/// Сколько секунд Claude Code ждёт хук sapien. Хук только передаёт
/// событие и ответа не ждёт.
const HOOK_TIMEOUT: u64 = 5;

/// Строка в одинарных кавычках для sh: команду хука Claude Code запускает
/// оболочкой, а в пути к приложению бывают пробелы и кавычки.
pub fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// `--settings` терминала: хуки sapien, их Claude Code складывает с хуками
/// человека и проекта. Действие по расписанию идёт без человека, и Claude
/// Code не спрашивает, согласен ли он на режим без разрешений.
pub fn settings(exe: &str, background: bool) -> String {
    let hook = json!([{
        "hooks": [{
            "type": "command",
            "command": format!("{} hook", quoted(exe)),
            "timeout": HOOK_TIMEOUT,
        }],
    }]);
    let hooks: serde_json::Map<String, Value> = HOOKED
        .iter()
        .map(|event| ((*event).to_owned(), hook.clone()))
        .collect();
    let mut settings = json!({ "hooks": hooks });

    if background {
        settings["skipDangerousModePermissionPrompt"] = true.into();
    }

    settings.to_string()
}

/// Аргументы `claude` терминала. Разговор `claude` уже есть у Claude Code,
/// значит, `--resume`, иначе он начинается с этим же id. Действие
/// по расписанию идёт без разрешений: человека рядом нет. Задание стоит
/// после `--` и флагом не станет.
pub fn launch(
    claude: &str,
    resume: bool,
    settings: String,
    task: Option<&str>,
    background: bool,
) -> Vec<String> {
    let mut args = vec![
        if resume { "--resume" } else { "--session-id" }.to_owned(),
        claude.to_owned(),
        "--settings".to_owned(),
        settings,
    ];

    if background {
        args.extend([
            "--permission-mode".to_owned(),
            "bypassPermissions".to_owned(),
        ]);
    }

    if let Some(task) = task {
        args.extend(["--".to_owned(), task.to_owned()]);
    }

    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn хук_разбирается_по_имени_события() {
        let hook = |event: Value| Hook::of(&event);

        assert_eq!(
            hook(
                json!({ "hook_event_name": "SessionStart", "session_id": "4f1c-9a", "source": "clear" })
            ),
            Some(Hook::Start {
                claude: "4f1c-9a".into(),
                compact: false
            })
        );
        assert_eq!(
            hook(
                json!({ "hook_event_name": "SessionStart", "session_id": "4f1c", "source": "compact" })
            ),
            Some(Hook::Start {
                claude: "4f1c".into(),
                compact: true
            })
        );
        // id, который стал бы флагом, не годится.
        assert_eq!(
            hook(json!({ "hook_event_name": "SessionStart", "session_id": "--help" })),
            None
        );
        assert_eq!(
            hook(json!({ "hook_event_name": "UserPromptSubmit", "prompt": "Почини" })),
            Some(Hook::Prompt {
                text: "Почини".into()
            })
        );
        assert_eq!(hook(json!({ "hook_event_name": "Stop" })), Some(Hook::Stop));
        assert_eq!(
            hook(json!({ "hook_event_name": "StopFailure", "error": "rate_limit" })),
            Some(Hook::Stop)
        );
        assert_eq!(
            hook(json!({ "hook_event_name": "Notification", "notification_type": "idle_prompt" })),
            Some(Hook::Notification { idle: true })
        );
        assert_eq!(
            hook(
                json!({ "hook_event_name": "Notification", "notification_type": "permission_prompt" })
            ),
            Some(Hook::Notification { idle: false })
        );
        assert_eq!(hook(json!({ "hook_event_name": "SessionEnd" })), None);
        assert_eq!(hook(json!("не событие")), None);
    }

    #[test]
    fn claude_запускается_с_хуками_sapien_а_задание_не_становится_флагом() {
        let exe = "/Applications/O'Brien sapien.app/Contents/MacOS/sapien";
        let tab: Value = serde_json::from_str(&settings(exe, false)).unwrap();
        let command = &tab["hooks"]["Stop"][0]["hooks"][0];

        assert_eq!(
            command["command"],
            r"'/Applications/O'\''Brien sapien.app/Contents/MacOS/sapien' hook"
        );
        assert_eq!(command["timeout"], 5);
        assert_eq!(tab["hooks"].as_object().unwrap().len(), HOOKED.len());
        assert_eq!(tab.get("skipDangerousModePermissionPrompt"), None);

        let background: Value = serde_json::from_str(&settings(exe, true)).unwrap();

        assert_eq!(background["skipDangerousModePermissionPrompt"], true);

        assert_eq!(
            launch("4f1c", true, "{}".into(), None, false),
            ["--resume", "4f1c", "--settings", "{}"]
        );
        assert_eq!(
            launch("4f1c", false, "{}".into(), Some("--help"), true),
            [
                "--session-id",
                "4f1c",
                "--settings",
                "{}",
                "--permission-mode",
                "bypassPermissions",
                "--",
                "--help"
            ]
        );
    }

    #[test]
    fn заголовок_сессии_это_первая_строка_первого_сообщения() {
        assert_eq!(title("\n  Почини сборку\nпадает на CI"), "Почини сборку");
        assert_eq!(title(&"я".repeat(80)).chars().count(), TITLE_LIMIT);
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
