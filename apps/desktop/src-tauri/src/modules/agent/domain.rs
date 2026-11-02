use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::time::Duration;

/// Модели на выбор в настройках, первая по умолчанию.
pub const MODELS: [&str; 3] = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];

pub fn parse_model(model: &str) -> Option<&'static str> {
    MODELS.into_iter().find(|known| *known == model)
}

/// Что Claude Code получает к своему системному промпту. Остальное
/// он знает сам: CLAUDE.md проекта и настройки человека работают.
pub const APPEND: &str = "Человек пишет тебе из окна приложения sapien, а не из терминала. \
Если без решения человека не обойтись, спроси его инструментом mcp__sapien__ask_user \
и дождись ответа. Отвечай на языке человека.";

/// Самый длинный ответ инструмента sapien. Разрешение возвращает вход
/// вызова целиком, а у записи файла это весь файл: Claude Code не должен
/// уносить такой ответ в файл.
const RESULT_LIMIT: usize = 500_000;

/// Инструменты сервера MCP sapien. `ask_user` зовёт модель, а `approve`
/// сам Claude Code, когда вызову нужно разрешение человека
/// (`--permission-prompt-tool`).
pub fn mcp_tools() -> Value {
    let string = json!({ "type": "string" });
    let meta = json!({ "anthropic/maxResultSizeChars": RESULT_LIMIT });

    json!([
        {
            "name": "ask_user",
            "description": "Спрашивает человека и ждёт ответа. options это два-четыре коротких \
                варианта, человек выбирает один или пишет свой ответ. Ответ приходит текстом. \
                Человека может не быть: тогда ответ скажет решить самому.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "question": string,
                    "options": { "type": "array", "items": string },
                },
                "required": ["question", "options"],
                "additionalProperties": false,
            },
            "_meta": meta,
        },
        {
            "name": "approve",
            "description": "Служебный: его зовёт сам Claude Code, чтобы спросить у человека \
                разрешение на вызов инструмента. Не вызывай его.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tool_name": string,
                    "input": { "type": "object" },
                    "tool_use_id": string,
                },
                "required": ["tool_name", "input"],
            },
            "_meta": meta,
        },
    ])
}

/// Сколько агент ждёт ответа на вопрос.
pub const ANSWER_WAIT: Duration = Duration::from_secs(600);

/// Сколько Claude Code может молчать посреди ответа, прежде чем сторож
/// снимет ход. Размышления и текст идут событиями, поэтому столько тишины
/// это зависший процесс.
pub const SILENCE: Duration = Duration::from_secs(600);

/// Ответы инструментов, когда человек не ответил или не разрешил.
pub const AWAY: &str =
    "Человека нет рядом: это действие по расписанию. Реши сам и в ответе напиши, что выбрал.";
const NO_ANSWER: &str = "Человек не ответил за 10 минут. Реши сам и в ответе напиши, что выбрал.";
const DENIED: &str = "Человек не разрешил этот вызов. Не повторяй его.";
const NOT_ALLOWED: &str = "Человек не ответил за 10 минут, вызов не выполнен. Не повторяй его.";
pub const STOPPED: &str = "Человек остановил ответ, вызов не выполнен.";

/// Кто следит за ответом агента.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Oversight {
    /// Человек у окна, вызовы инструментов с его разрешения.
    Ask,
    /// Человек у окна, вызовы без вопросов.
    Trust,
    /// Человека нет: действие по расписанию. Вызовы без вопросов,
    /// на вопрос агент решает сам.
    Away,
}

/// Вопрос человеку посреди ответа. `id` это номер вызова инструмента.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Question {
    /// Вопрос агента с вариантами.
    Choice {
        id: String,
        question: String,
        options: Vec<String>,
    },
    /// Разрешение на вызов инструмента `tool` Claude Code. `target` тот же,
    /// что у строки инструмента в истории.
    Permission {
        id: String,
        tool: String,
        target: String,
    },
}

impl Question {
    pub fn id(&self) -> &str {
        match self {
            Self::Choice { id, .. } | Self::Permission { id, .. } => id,
        }
    }
}

/// Ответ человека: вариант или свой текст, а на разрешение да или нет.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Answer {
    Text { text: String },
    Allow,
    Deny,
}

/// Что агент получит в ответ на свой вопрос.
pub fn choice_result(answer: Option<Answer>) -> Result<String, String> {
    match answer {
        Some(Answer::Text { text }) => Ok(text),
        Some(Answer::Allow) => Ok("Да.".to_owned()),
        Some(Answer::Deny) => Ok("Нет.".to_owned()),
        None => Err(NO_ANSWER.to_owned()),
    }
}

/// Можно ли выполнить вызов, а нельзя, что агент получит вместо него.
/// Текст вместо кнопки это отказ со словами человека.
pub fn permission_result(answer: Option<Answer>) -> Result<(), String> {
    match answer {
        Some(Answer::Allow) => Ok(()),
        Some(Answer::Deny) => Err(DENIED.to_owned()),
        Some(Answer::Text { text }) => Err(format!("{DENIED} Человек написал: «{text}»")),
        None => Err(NOT_ALLOWED.to_owned()),
    }
}

/// Ответ `approve` для Claude Code: JSON-текст с решением. Разрешённый
/// вызов идёт с тем входом, с каким пришёл.
pub fn approval(answer: Option<Answer>, input: &Value) -> String {
    match permission_result(answer) {
        Ok(()) => json!({ "behavior": "allow", "updatedInput": input }),
        Err(message) => json!({ "behavior": "deny", "message": message }),
    }
    .to_string()
}

/// Добавляет блоки от человека. Если последнее сообщение уже его (ответ
/// оборвался, или это результаты инструментов), блоки дописываются в него:
/// так сообщения человека и модели чередуются.
pub fn push_user(messages: &mut Vec<Value>, blocks: Vec<Value>) {
    push(messages, "user", blocks);
}

/// Блоки ответа: Claude Code шлёт ответ сообщениями по одному блоку.
pub fn push_assistant(messages: &mut Vec<Value>, blocks: Vec<Value>) {
    push(messages, "assistant", blocks);
}

fn push(messages: &mut Vec<Value>, role: &str, blocks: Vec<Value>) {
    if let Some(last) = messages.last_mut()
        && last["role"] == role
        && let Some(content) = last["content"].as_array_mut()
    {
        content.extend(blocks);
        return;
    }

    messages.push(json!({ "role": role, "content": blocks }));
}

/// Отметка в конце истории: ответ не вышел с кодом `code` (у лимита
/// подписки `resets`, когда он сбросится, в секундах Unix) или Claude Code
/// начал разговор заново. Встаёт в последнее сообщение, Claude не уходит.
pub fn notice(messages: &mut [Value], code: &str, resets: Option<u64>) {
    if let Some(content) = messages
        .last_mut()
        .and_then(|last| last["content"].as_array_mut())
    {
        content.push(json!({ "type": "notice", "code": code, "resets": resets }));
    }
}

/// Продолжение ответа, который оборвался после вызовов инструментов.
const CONTINUE: &str = "Продолжай с того места, где остановился.";

/// Что уходит Claude Code: последний текст человека. История кончается
/// результатами инструментов, значит, ответ оборвался, и Claude просят
/// его продолжить.
pub fn prompt(messages: &[Value]) -> String {
    messages
        .last()
        .and_then(|last| last["content"].as_array())
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .next_back()
        .map_or_else(|| CONTINUE.to_owned(), str::to_owned)
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

/// Почему Claude Code не ответил, по тексту его ошибки. Тексты взяты
/// из справочника ошибок Claude Code, незнакомый это `claude_failed`.
pub fn claude_failure(text: &str) -> AppError {
    let text = text.to_lowercase();
    let has = |markers: &[&str]| markers.iter().any(|marker| text.contains(marker));

    // Запертая связка ключей тоже просит войти заново, поэтому она раньше
    // входа. Пропавший разговор `--resume` сценарий начинает заново.
    if has(&["no conversation found"]) {
        AppError::not_found("claude_session_missing")
    } else if has(&["keychain"]) {
        AppError::invalid("claude_keychain_locked")
    } else if has(&["hit your", "usage limit", "spend limit"]) {
        AppError::unavailable("claude_limit")
    } else if has(&[
        "not logged in",
        "/login",
        "sign in again",
        "login expired",
        "oauth token",
    ]) {
        AppError::invalid("claude_logged_out")
    } else if has(&[
        "unable to connect",
        "timed out",
        "no response from api",
        "connection lost",
        "connection closed",
        "went to sleep",
    ]) {
        AppError::unavailable("agent_unreachable")
    } else if has(&["unknown option", "unknown command", "unexpected argument"]) {
        AppError::invalid("claude_incompatible")
    } else {
        AppError::unavailable("claude_failed")
    }
}

/// Так Claude Code называет инструменты сервера sapien.
const OURS: &str = "mcp__sapien__";

/// Имя инструмента для окна: свои без префикса сервера, встроенные
/// и чужие серверы MCP как есть.
pub fn short_name(name: &str) -> &str {
    name.strip_prefix(OURS).unwrap_or(name)
}

/// Годится ли запуск Claude Code по его событию `system/init`: вход
/// по подписке, а сервер sapien подключён, иначе вопросы и разрешения
/// не дойдут до человека.
pub fn claude_init_problem(init: &Value) -> Option<AppError> {
    let connected = init["mcp_servers"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|server| server["name"] == "sapien" && server["status"] == "connected");

    if init["apiKeySource"] != "none" {
        Some(AppError::invalid("claude_not_subscription"))
    } else if !connected {
        Some(AppError::unavailable("claude_tools_missing"))
    } else {
        None
    }
}

/// Поля входа, из которых берётся цель строки инструмента, по порядку.
const TARGETS: [&str; 7] = [
    "file_path",
    "path",
    "pattern",
    "command",
    "url",
    "query",
    "description",
];

/// Сколько знаков команды показывает строка инструмента.
const COMMAND_LIMIT: usize = 120;

/// Цель вызова: поле входа и его текст. У команды только первая строка.
fn target_field(input: &Value) -> Option<(&'static str, String)> {
    let (field, text) = TARGETS
        .into_iter()
        .find_map(|field| Some((field, input[field].as_str()?)))?;
    let text = if field == "command" {
        let line = text.lines().next().unwrap_or_default();

        line.chars().take(COMMAND_LIMIT).collect()
    } else {
        text.to_owned()
    };

    Some((field, text))
}

/// Строка в чате: что агент сделал инструментом и с чем.
pub fn tool_target(input: &Value) -> String {
    target_field(input)
        .map(|(_, text)| text)
        .unwrap_or_default()
}

/// Сколько знаков результата инструмента держит история. Окну из него
/// нужен только ответ человека на вопрос агента, а целые файлы
/// и выводы команд раздували бы сессию, которая пишется на диск целиком
/// после каждого сообщения.
const RESULT_KEPT: usize = 4_000;

/// Блоки сообщения Claude Code в том виде, в каком их держит история:
/// текст, вызовы инструментов и результаты текстом. От входа вызова
/// остаётся только цель, кроме вопроса агента: его окно показывает
/// целиком. Размышления окно не показывает.
pub fn claude_blocks(message: &Value) -> Vec<Value> {
    message["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| match block["type"].as_str()? {
            "text" if block["text"].as_str().is_some_and(|text| !text.is_empty()) => {
                Some(json!({ "type": "text", "text": block["text"] }))
            }
            "tool_use" => {
                let name = short_name(block["name"].as_str()?);
                let input = if name == "ask_user" {
                    block["input"].clone()
                } else {
                    target_field(&block["input"])
                        .map_or_else(|| json!({}), |(field, text)| json!({ field: text }))
                };

                Some(json!({ "type": "tool_use", "id": block["id"], "name": name, "input": input }))
            }
            "tool_result" => Some(json!({
                "type": "tool_result",
                "tool_use_id": block["tool_use_id"],
                "content": result_text(&block["content"]).chars().take(RESULT_KEPT).collect::<String>(),
                "is_error": block["is_error"] == true,
            })),
            _ => None,
        })
        .collect()
}

/// Результат инструмента приходит строкой или блоками текста.
fn result_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_owned();
    }

    content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Чем кончился запуск Claude Code, по его строке `result`.
pub fn claude_result(result: &Value) -> Result<(), AppError> {
    if result["subtype"] == "error_max_turns" {
        return Err(AppError::invalid("agent_too_many_steps"));
    }

    if result["subtype"] == "success" && result["is_error"] == false {
        return Ok(());
    }

    let errors: Vec<&str> = result["errors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let text = result["result"].as_str().unwrap_or_default();

    Err(claude_failure(&format!("{text}\n{}", errors.join("\n"))))
}

/// Вызов инструмента sapien, разобранный по своей схеме. Поля проверяет
/// serde: не хватает поля или оно не того типа, и вызов не выполняется.
#[derive(Debug, PartialEq, Deserialize)]
#[serde(tag = "name", content = "input", rename_all = "snake_case")]
pub enum Tool {
    AskUser {
        question: String,
        options: Vec<String>,
    },
    Approve {
        tool_name: String,
        input: Value,
        tool_use_id: Option<String>,
    },
}

impl Tool {
    pub fn parse(block: &Value) -> Option<Self> {
        serde_json::from_value(json!({ "name": block["name"], "input": block["input"] })).ok()
    }
}

/// Строка чата, как её показывает окно.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Entry {
    User {
        text: String,
    },
    Assistant {
        text: String,
    },
    Tool {
        name: String,
        target: String,
        ok: bool,
    },
    /// Вопрос агента и ответ человека. Без ответа человек не ответил вовсе
    /// или его не было.
    Question {
        id: String,
        question: String,
        options: Vec<String>,
        answer: Option<String>,
    },
    /// Отметка: ответ не вышел или разговор начат заново (`notice`).
    Notice {
        code: String,
        resets: Option<u64>,
    },
}

impl Entry {
    pub fn tool(block: &Value, ok: bool) -> Self {
        Self::Tool {
            name: block["name"].as_str().unwrap_or_default().to_owned(),
            target: tool_target(&block["input"]),
            ok,
        }
    }
}

/// История сессии: сообщения в формате Messages API и сессия Claude Code.
/// Сообщения здесь это копия показанного, а сам разговор хранит Claude Code.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Chat {
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<ClaudeSession>,
}

/// Сессия Claude Code и каким sapien оставил её файл после своего ответа.
/// Файл с тех пор менялся, значит, разговор продолжали снаружи.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClaudeSession {
    pub id: String,
    #[serde(default)]
    pub seen: Option<Stamp>,
}

/// Размер файла и время его правки в миллисекундах Unix.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Stamp {
    pub len: u64,
    pub modified: u64,
}

/// Сессия sapien: отдельный разговор с Claude Code в папке проекта
/// `project`. Заголовок пустой до первого сообщения человека. Время
/// в миллисекундах Unix.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project: String,
    pub title: String,
    pub created: u64,
    pub updated: u64,
    #[serde(default)]
    pub chat: Chat,
}

/// Сессия в списке окна: без истории.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub project: String,
    pub title: String,
    pub updated: u64,
}

impl Session {
    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            id: self.id.clone(),
            project: self.project.clone(),
            title: self.title.clone(),
            updated: self.updated,
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

/// История в виде строк чата. Результаты инструментов и размышления окно
/// не показывает: по результату видно только, удался ли вызов.
pub fn transcript(messages: &[Value]) -> Vec<Entry> {
    let results: HashMap<&str, &Value> = messages
        .iter()
        .flat_map(|message| message["content"].as_array().into_iter().flatten())
        .filter(|block| block["type"] == "tool_result")
        .filter_map(|block| Some((block["tool_use_id"].as_str()?, block)))
        .collect();
    let mut entries: Vec<Entry> = vec![];

    for message in messages {
        let from_user = message["role"] == "user";

        for block in message["content"].as_array().into_iter().flatten() {
            let text = block["text"].as_str().unwrap_or_default();

            match (block["type"].as_str(), from_user) {
                (Some("text"), true) => entries.push(Entry::User {
                    text: text.to_owned(),
                }),
                (Some("text"), false) => match entries.last_mut() {
                    Some(Entry::Assistant { text: last }) => {
                        last.push_str("\n\n");
                        last.push_str(text);
                    }
                    _ => entries.push(Entry::Assistant {
                        text: text.to_owned(),
                    }),
                },
                (Some("tool_use"), false) => {
                    let id = block["id"].as_str().unwrap_or_default();
                    let result = results.get(id);
                    let ok = result.is_some_and(|result| result["is_error"] != true);

                    match Tool::parse(block) {
                        Some(Tool::AskUser { question, options }) => {
                            entries.push(Entry::Question {
                                id: id.to_owned(),
                                question,
                                options,
                                answer: result
                                    .filter(|_| ok)
                                    .and_then(|result| result["content"].as_str())
                                    .map(str::to_owned),
                            });
                        }
                        // Без результата вызов ещё идёт или ответ оборвался.
                        _ => entries.push(Entry::tool(block, ok || result.is_none())),
                    }
                }
                (Some("notice"), _) => entries.push(Entry::Notice {
                    code: block["code"].as_str().unwrap_or_default().to_owned(),
                    resets: block["resets"].as_u64(),
                }),
                _ => {}
            }
        }
    }

    entries
}

/// Событие для окна, пока идёт ответ.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Event {
    /// Кусок текста ответа.
    Text { text: String },
    /// Агент зовёт инструмент: та же строка, что `Entry::Tool` в истории.
    /// Удался ли вызов, станет известно позже, история скажет честно.
    Tool {
        name: String,
        target: String,
        ok: bool,
    },
    /// Агент ждёт ответа человека.
    Asked { question: Question },
    /// Вопрос закрыт: ответом, без ответа или «Стопом». `answer` это ответ
    /// на вопрос агента, как его покажет история.
    Answered { id: String, answer: Option<String> },
}

impl Event {
    pub fn tool(block: &Value, ok: bool) -> Self {
        Self::Tool {
            name: block["name"].as_str().unwrap_or_default().to_owned(),
            target: tool_target(&block["input"]),
            ok,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(text: &str) -> Vec<Value> {
        vec![json!({ "type": "text", "text": text })]
    }

    #[test]
    fn сообщения_человека_чередуются_с_ответами() {
        let mut messages = vec![];

        push_user(&mut messages, said("Первое"));
        push_user(&mut messages, said("Второе"));

        assert_eq!(messages.len(), 1);
        assert_eq!(
            transcript(&messages),
            [
                Entry::User {
                    text: "Первое".into()
                },
                Entry::User {
                    text: "Второе".into()
                }
            ]
        );
    }

    #[test]
    fn история_показывается_строками_чата() {
        let messages = vec![
            json!({ "role": "user", "content": [{ "type": "text", "text": "Почему падает сборка?" }] }),
            json!({ "role": "assistant", "content": [
                { "type": "text", "text": "Смотрю." },
                { "type": "tool_use", "id": "t1", "name": "Read", "input": { "file_path": "/код/Cargo.toml" } },
                { "type": "tool_use", "id": "t2", "name": "Bash", "input": { "command": "cargo build" } },
                { "type": "tool_use", "id": "t3", "name": "Grep", "input": { "pattern": "fn main" } },
            ]}),
            json!({ "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "t1", "content": "[package]" },
                { "type": "tool_result", "tool_use_id": "t2", "content": "error[E0425]", "is_error": true },
            ]}),
            json!({ "role": "assistant", "content": [{ "type": "text", "text": "Не хватает функции." }] }),
        ];

        assert_eq!(
            transcript(&messages),
            [
                Entry::User {
                    text: "Почему падает сборка?".into()
                },
                Entry::Assistant {
                    text: "Смотрю.".into()
                },
                Entry::Tool {
                    name: "Read".into(),
                    target: "/код/Cargo.toml".into(),
                    ok: true
                },
                Entry::Tool {
                    name: "Bash".into(),
                    target: "cargo build".into(),
                    ok: false
                },
                // Результата нет: вызов ещё идёт.
                Entry::Tool {
                    name: "Grep".into(),
                    target: "fn main".into(),
                    ok: true
                },
                Entry::Assistant {
                    text: "Не хватает функции.".into()
                },
            ]
        );
    }

    #[test]
    fn строка_инструмента_берёт_цель_из_первого_известного_поля() {
        let long = format!("echo {}\nls", "я".repeat(200));

        assert_eq!(
            tool_target(&json!({ "path": "src", "pattern": "TODO" })),
            "src"
        );
        assert_eq!(
            tool_target(&json!({ "file_path": "a.rs", "path": "src" })),
            "a.rs"
        );
        assert_eq!(
            tool_target(&json!({ "command": "git status\ngit diff", "description": "Статус" })),
            "git status"
        );
        assert_eq!(
            tool_target(&json!({ "command": long })).chars().count(),
            COMMAND_LIMIT
        );
        assert_eq!(
            tool_target(&json!({ "url": "https://docs.rs", "prompt": "…" })),
            "https://docs.rs"
        );
        assert_eq!(tool_target(&json!({ "query": "tauri 2" })), "tauri 2");
        assert_eq!(
            tool_target(&json!({ "description": "Разведка", "prompt": "…" })),
            "Разведка"
        );
        assert_eq!(tool_target(&json!({ "todos": [] })), "");
    }

    #[test]
    fn заголовок_сессии_это_первая_строка_первого_сообщения() {
        assert_eq!(title("  Почини сборку\nподробности ниже"), "Почини сборку");
        assert_eq!(title(&"я".repeat(100)).chars().count(), TITLE_LIMIT);
        assert_eq!(title("   "), "");
    }

    #[test]
    fn разрешение_отвечает_claude_code_решением_в_json() {
        let input = json!({ "command": "rm -rf build" });
        let decided = |answer| serde_json::from_str::<Value>(&approval(answer, &input)).unwrap();

        assert_eq!(
            decided(Some(Answer::Allow)),
            json!({ "behavior": "allow", "updatedInput": { "command": "rm -rf build" } })
        );
        assert_eq!(
            decided(Some(Answer::Deny)),
            json!({ "behavior": "deny", "message": DENIED })
        );
        assert_eq!(
            decided(Some(Answer::Text {
                text: "не сейчас".into()
            }))["message"],
            format!("{DENIED} Человек написал: «не сейчас»")
        );
        assert_eq!(
            decided(None),
            json!({ "behavior": "deny", "message": NOT_ALLOWED })
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

    #[test]
    fn ошибка_claude_code_разобрана_по_тексту() {
        let code = |text: &str| claude_failure(text).code;

        assert_eq!(
            code("You've hit your session limit · resets 3:45pm"),
            "claude_limit"
        );
        assert_eq!(
            code("Not logged in · Please run /login"),
            "claude_logged_out"
        );
        assert_eq!(
            code("Login expired · Please run /login"),
            "claude_logged_out"
        );
        assert_eq!(
            code(
                "Couldn't save your login. If your Mac's keychain is locked, unlock it and log in again."
            ),
            "claude_keychain_locked"
        );
        assert_eq!(
            code("Unable to connect to API. Check your internet connection"),
            "agent_unreachable"
        );
        assert_eq!(
            code("error: unknown option '--permission-prompt-tool'"),
            "claude_incompatible"
        );
        assert_eq!(
            code("API Error: 500 Internal server error"),
            "claude_failed"
        );
        assert_eq!(
            code("No conversation found with session ID: 4f1c"),
            "claude_session_missing"
        );
    }

    #[test]
    fn claude_code_с_ключом_api_или_без_sapien_не_годится() {
        let init = |source: &str, status: &str| {
            claude_init_problem(&json!({
                "type": "system",
                "subtype": "init",
                "apiKeySource": source,
                "mcp_servers": [
                    { "name": "github", "status": "connected" },
                    { "name": "sapien", "status": status },
                ],
                "tools": ["Bash", "Edit", "mcp__github__create_issue", "mcp__sapien__ask_user"],
            }))
            .map(|error| error.code)
        };

        // Встроенные инструменты и чужие серверы теперь на месте.
        assert_eq!(init("none", "connected"), None);
        assert_eq!(
            init("ANTHROPIC_API_KEY", "connected"),
            Some("claude_not_subscription")
        );
        assert_eq!(init("none", "failed"), Some("claude_tools_missing"));
    }

    #[test]
    fn сообщения_claude_code_ложатся_в_историю_без_лишнего() {
        let said = json!({ "content": [
            { "type": "thinking", "thinking": "…", "signature": "s" },
            { "type": "text", "text": "Читаю." },
            { "type": "text", "text": "" },
            { "type": "tool_use", "id": "toolu_1", "name": "Write", "input": { "file_path": "a.md", "content": "весь файл" } },
            { "type": "tool_use", "id": "toolu_2", "name": "mcp__sapien__ask_user", "input": { "question": "Срок?", "options": ["завтра"] } },
            { "type": "tool_use", "id": "toolu_3", "name": "mcp__github__create_issue", "input": { "title": "Баг" } },
        ] });
        let results = json!({ "content": [
            { "type": "tool_result", "tool_use_id": "toolu_1", "content": [{ "type": "text", "text": "Записано" }] },
            { "type": "tool_result", "tool_use_id": "toolu_4", "content": "я".repeat(RESULT_KEPT + 10), "is_error": true },
        ] });

        assert_eq!(
            claude_blocks(&said),
            [
                json!({ "type": "text", "text": "Читаю." }),
                json!({ "type": "tool_use", "id": "toolu_1", "name": "Write", "input": { "file_path": "a.md" } }),
                json!({ "type": "tool_use", "id": "toolu_2", "name": "ask_user", "input": { "question": "Срок?", "options": ["завтра"] } }),
                json!({ "type": "tool_use", "id": "toolu_3", "name": "mcp__github__create_issue", "input": {} }),
            ]
        );

        let results = claude_blocks(&results);

        assert_eq!(
            results[0],
            json!({ "type": "tool_result", "tool_use_id": "toolu_1", "content": "Записано", "is_error": false })
        );
        assert_eq!(
            results[1]["content"].as_str().unwrap().chars().count(),
            RESULT_KEPT
        );
        assert_eq!(results[1]["is_error"], true);
    }

    #[test]
    fn итог_запуска_claude_code_по_строке_result() {
        let code = |result: Value| claude_result(&result).map_err(|error| error.code);

        assert_eq!(
            code(json!({ "subtype": "success", "is_error": false })),
            Ok(())
        );
        assert_eq!(
            code(json!({ "subtype": "error_max_turns", "is_error": true })),
            Err("agent_too_many_steps")
        );
        assert_eq!(
            code(
                json!({ "subtype": "success", "is_error": true, "result": "Claude usage limit reached. Your limit will reset at 5pm" })
            ),
            Err("claude_limit")
        );
        assert_eq!(
            code(
                json!({ "subtype": "error_during_execution", "is_error": true, "errors": ["Not logged in · Please run /login"] })
            ),
            Err("claude_logged_out")
        );
    }

    #[test]
    fn claude_code_получает_последний_текст_человека() {
        let mut messages = vec![];

        push_user(&mut messages, said("Первое"));
        notice(&mut messages, "claude_limit", Some(1));
        push_user(&mut messages, said("Второе"));

        assert_eq!(prompt(&messages), "Второе");
        assert_eq!(
            transcript(&messages)[1],
            Entry::Notice {
                code: "claude_limit".into(),
                resets: Some(1),
            }
        );

        let mut cut = messages.clone();

        push_assistant(
            &mut cut,
            vec![json!({ "type": "tool_use", "id": "t", "name": "Read", "input": {} })],
        );
        push_user(
            &mut cut,
            vec![
                json!({ "type": "tool_result", "tool_use_id": "t", "content": "", "is_error": false }),
            ],
        );

        // Ответ оборвался после вызовов: Claude продолжает его.
        assert_eq!(prompt(&cut), CONTINUE);
    }
}
