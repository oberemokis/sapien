use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

/// Адрес сервера YouTrack, как его ввёл человек: облачный
/// `*.youtrack.cloud` или свой, в том числе с путём вроде `/youtrack`.
/// Схему дописываем сами, косую черту в конце обрезаем. Только https:
/// по http токен ушёл бы по сети открытым текстом.
pub fn parse_host(input: &str) -> Result<String, AppError> {
    let input = input.trim();

    if input.trim_end_matches('/').is_empty() {
        return Err(AppError::invalid("youtrack_host_empty"));
    }

    let full = if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let url = Url::parse(&full).map_err(|_| AppError::invalid("youtrack_host_invalid"))?;

    if url.scheme() != "https" {
        return Err(AppError::invalid("youtrack_host_insecure"));
    }

    let plain = url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none();

    if url.host_str().is_none() || !plain {
        return Err(AppError::invalid("youtrack_host_invalid"));
    }

    Ok(url.as_str().trim_end_matches('/').to_owned())
}

/// Номер задачи вроде `SAP-12` или внутренний `2-345`. Он встаёт в путь
/// запроса, и `/` или `..` увели бы запрос с токеном на другой адрес API.
pub fn parse_issue_id(id: &str) -> Option<&str> {
    let id = id.trim();
    let plain = id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');

    (!id.is_empty() && plain).then_some(id)
}

/// Почему YouTrack не ответил тем, кем назвался токен.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ApiError {
    /// Нет сети, сервер не отвечает или сломался.
    Unreachable,
    /// Отвечает что-то, но не YouTrack: другой сайт или неверный путь.
    NotYoutrack,
    /// Токен неверный, истёк или отозван.
    TokenRejected,
    /// YouTrack не принял запрос: нет такого значения поля, команды и т. п.
    Rejected,
    /// Нет того, к чему обратились: задачи, проекта.
    Missing,
}

impl ApiError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unreachable => "youtrack_unreachable",
            Self::NotYoutrack => "youtrack_not_youtrack",
            Self::TokenRejected => "youtrack_token_rejected",
            Self::Rejected => "youtrack_rejected",
            Self::Missing => "youtrack_missing",
        }
    }
}

impl From<ApiError> for AppError {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::Unreachable => AppError::unavailable(error.code()),
            ApiError::Missing => AppError::not_found(error.code()),
            ApiError::NotYoutrack | ApiError::TokenRejected | ApiError::Rejected => {
                AppError::invalid(error.code())
            }
        }
    }
}

/// Поле задачи по имени в YouTrack: Type, Priority, Assignee или своё
/// поле проекта.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Field {
    pub name: String,
    pub value: String,
}

/// Связь черновика с задачей YouTrack.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkKind {
    /// Подзадача эпика.
    Parent,
    DependsOn,
    Blocks,
    RelatesTo,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Link {
    pub kind: LinkKind,
    pub id: String,
}

/// Черновик задачи, как его разобрало окно из шапки и текста заметки.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Draft {
    /// Короткое имя проекта, например SAP.
    pub project: String,
    pub summary: String,
    pub description: String,
    pub fields: Vec<Field>,
    pub links: Vec<Link>,
}

/// Что ушло в задачу при прошлой публикации.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sent {
    pub summary: String,
    pub description: String,
    pub fields: Vec<Field>,
}

/// Команда YouTrack, которая ставит поле: «Priority Major».
pub fn field_command(field: &Field) -> String {
    format!("{} {}", field.name.trim(), field.value.trim())
}

/// Команда YouTrack, которая ставит связь: «depends on SAP-3».
pub fn link_command(link: &Link) -> String {
    let kind = match link.kind {
        LinkKind::Parent => "subtask of",
        LinkKind::DependsOn => "depends on",
        LinkKind::Blocks => "is required for",
        LinkKind::RelatesTo => "relates to",
    };

    format!("{kind} {}", link.id.trim())
}

/// Обязательные поля проекта, которым черновик не дал значения. Поле
/// обязательно, когда оно не может быть пустым и у него нет значения
/// по умолчанию. Имена сравниваются без регистра, как в YouTrack.
pub fn missing_fields(project_fields: &Value, draft: &Draft) -> Vec<String> {
    project_fields
        .as_array()
        .into_iter()
        .flatten()
        .filter(|field| field["canBeEmpty"] == false)
        .filter(|field| {
            field["defaultValues"]
                .as_array()
                .is_none_or(|values| values.is_empty())
        })
        .filter_map(|field| field["field"]["name"].as_str())
        .filter(|name| {
            !draft.fields.iter().any(|field| {
                field.name.trim().eq_ignore_ascii_case(name) && !field.value.trim().is_empty()
            })
        })
        .map(str::to_owned)
        .collect()
}

/// Итог публикации для окна.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Published {
    /// Задача есть в YouTrack. `failed` это команды полей и связей, которые
    /// YouTrack не принял: задача создана без них.
    Done { id: String, failed: Vec<String> },
    /// Обязательные поля проекта без значения: задача не создана.
    Missing { fields: Vec<String> },
    /// Название или описание задачи поменяли в YouTrack после прошлой
    /// публикации. Ничего не отправлено, их версия здесь.
    Diverged {
        summary: String,
        description: String,
    },
}

/// Состояние опубликованной задачи для плашки над черновиком.
#[derive(Debug, PartialEq, Serialize)]
pub struct IssueState {
    pub id: String,
    pub state: Option<String>,
    pub assignee: Option<String>,
    pub url: String,
}

/// Значение поля задачи из ответа YouTrack: имя у значений справочников
/// и полное имя у людей.
pub fn field_value(issue: &Value, name: &str) -> Option<String> {
    let value = &issue["customFields"]
        .as_array()?
        .iter()
        .find(|field| field["name"] == name)?["value"];

    ["fullName", "name", "login"]
        .into_iter()
        .find_map(|key| value[key].as_str())
        .map(str::to_owned)
}

/// Что проверка черновика узнала у YouTrack о задаче, на которую он ссылается.
#[derive(Debug, PartialEq, Serialize)]
pub struct IssueFacts {
    pub id: String,
    /// Задача есть: номер верный, её не удалили, и токену она видна.
    pub found: bool,
    pub resolved: bool,
    pub sprint: Option<String>,
    /// Срок в миллисекундах от начала эпохи, как его хранит YouTrack.
    pub due: Option<i64>,
}

impl IssueFacts {
    pub fn of(id: &str, issue: &Value) -> Self {
        let field = |names: &[&str]| {
            issue["customFields"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|field| names.iter().any(|name| field["name"] == *name))
                .map(|field| field["value"].clone())
        };
        // У поля спринтов значений бывает несколько: берётся первое.
        let sprint = field(&["Sprint", "Sprints"]).and_then(|value| {
            value["name"]
                .as_str()
                .or_else(|| value[0]["name"].as_str())
                .map(str::to_owned)
        });

        Self {
            id: id.to_owned(),
            found: true,
            resolved: !issue["resolved"].is_null(),
            sprint,
            due: field(&["Due Date"]).and_then(|value| value.as_i64()),
        }
    }

    pub fn missing(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            found: false,
            resolved: false,
            sprint: None,
            due: None,
        }
    }
}

/// Итог проверки черновика у YouTrack.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checked {
    /// Проект с таким коротким именем есть, и токену он виден.
    pub project_found: bool,
    /// Обязательные поля проекта, которых в черновике нет.
    pub missing: Vec<String>,
    pub issues: Vec<IssueFacts>,
}

/// Задача проекта, похожая на черновик.
#[derive(Debug, PartialEq, Serialize)]
pub struct Similar {
    pub id: String,
    pub summary: String,
}

/// Слова названия для поиска похожих задач: буквы и цифры, от трёх знаков.
/// Остальное язык запросов YouTrack прочёл бы как свои знаки.
pub fn search_words(summary: &str) -> Vec<String> {
    summary
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 2)
        .map(str::to_lowercase)
        .collect()
}

/// Подключение к YouTrack, как его видит окно. Токена здесь нет.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum YoutrackStatus {
    None,
    Connected {
        host: String,
        name: String,
    },
    /// Подключение задано, но сейчас не работает. Код говорит почему:
    /// агент и лента говорят о нём, а не молча ничего не находят.
    Broken {
        host: String,
        code: &'static str,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn адрес_дописывается_и_обрезается_сам() {
        assert_eq!(
            parse_host(" acme.youtrack.cloud/ ").unwrap(),
            "https://acme.youtrack.cloud"
        );
        assert_eq!(
            parse_host("https://youtrack.company.com/youtrack/").unwrap(),
            "https://youtrack.company.com/youtrack"
        );
        assert_eq!(
            parse_host("https://yt.company.com:8443").unwrap(),
            "https://yt.company.com:8443"
        );
    }

    #[test]
    fn адрес_без_https_или_с_лишним_не_принимается() {
        let code = |input| parse_host(input).unwrap_err().code;

        assert_eq!(code("   "), "youtrack_host_empty");
        assert_eq!(code("http://yt.company.com"), "youtrack_host_insecure");
        assert_eq!(code("ftp://yt.company.com"), "youtrack_host_insecure");
        assert_eq!(code("https://me@yt.company.com"), "youtrack_host_invalid");
        assert_eq!(
            code("https://yt.company.com/?next=x"),
            "youtrack_host_invalid"
        );
        assert_eq!(code("https://"), "youtrack_host_invalid");
    }
}
