use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
/// `answering`: по ней сейчас отвечает агент, в файле этого нет.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub project: String,
    pub title: String,
    pub updated: u64,
    #[serde(skip_deserializing)]
    pub answering: bool,
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
