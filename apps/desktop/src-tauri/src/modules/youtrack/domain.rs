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

/// Состояние задачи для плашки над черновиком и карточки номера в тексте.
#[derive(Debug, PartialEq, Serialize)]
pub struct IssueState {
    pub id: String,
    pub summary: String,
    pub state: Option<String>,
    pub resolved: bool,
    pub assignee: Option<String>,
    /// Срок в миллисекундах от начала эпохи, как его хранит YouTrack.
    pub due: Option<i64>,
    pub links: Vec<IssueLinks>,
    pub url: String,
}

/// Связи задачи одного вида словами YouTrack: «depends on» и номера.
#[derive(Debug, PartialEq, Serialize)]
pub struct IssueLinks {
    pub kind: String,
    pub ids: Vec<String>,
}

impl IssueState {
    pub fn of(id: &str, url: String, issue: &Value) -> Self {
        let due = issue["customFields"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|field| field["name"] == "Due Date")
            .and_then(|field| field["value"].as_i64());

        Self {
            id: id.to_owned(),
            summary: issue["summary"].as_str().unwrap_or_default().to_owned(),
            state: field_value(issue, "State"),
            resolved: !issue["resolved"].is_null(),
            assignee: field_value(issue, "Assignee"),
            due,
            links: issue_links(issue),
            url,
        }
    }
}

/// Связи с задачами. Направленная связь называется со стороны этой задачи:
/// исходящая «depends on», входящая «is required for».
fn issue_links(issue: &Value) -> Vec<IssueLinks> {
    issue["links"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|link| {
            let side = match link["direction"].as_str() {
                Some("INWARD") => "targetToSource",
                _ => "sourceToTarget",
            };
            let kind = [side, "name"].into_iter().find_map(|key| {
                link["linkType"][key]
                    .as_str()
                    .filter(|name| !name.is_empty())
            })?;
            let ids: Vec<String> = link["issues"]
                .as_array()?
                .iter()
                .filter_map(|issue| issue["idReadable"].as_str().map(str::to_owned))
                .collect();

            (!ids.is_empty()).then(|| IssueLinks {
                kind: kind.to_owned(),
                ids,
            })
        })
        .collect()
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

/// Номер и название задачи: похожей на черновик, из подсказки, из сводки.
#[derive(Debug, PartialEq, Serialize)]
pub struct Similar {
    pub id: String,
    pub summary: String,
}

impl Similar {
    pub fn of(issue: &Value) -> Self {
        Self {
            id: issue["idReadable"].as_str().unwrap_or_default().to_owned(),
            summary: issue["summary"].as_str().unwrap_or_default().to_owned(),
        }
    }
}

/// Подзадача эпика, у которой сменился статус: с какого и на какой.
#[derive(Debug, PartialEq, Serialize)]
pub struct Moved {
    pub id: String,
    pub summary: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

/// Незакрытая подзадача, которая встала, и почему.
#[derive(Debug, PartialEq, Serialize)]
pub struct Stuck {
    pub id: String,
    pub summary: String,
    /// Незакрытые задачи, от которых она зависит.
    pub blocked_by: Vec<String>,
    pub no_assignee: bool,
    pub overdue: bool,
}

/// Связь, которая появилась у подзадачи за период.
#[derive(Debug, PartialEq, Serialize)]
pub struct NewLink {
    pub id: String,
    pub kind: String,
    pub with: String,
}

/// Что случилось с подзадачами эпика с начала периода: для сводки агента.
#[derive(Debug, PartialEq, Serialize)]
pub struct EpicChanges {
    pub epic: Similar,
    pub since: String,
    pub closed: Vec<Similar>,
    pub created: Vec<Similar>,
    pub moved: Vec<Moved>,
    pub stuck: Vec<Stuck>,
    pub links: Vec<NewLink>,
}

/// Полночь даты ГГГГ-ММ-ДД по UTC в миллисекундах, как время в YouTrack.
pub fn date_ms(date: &str) -> Option<i64> {
    let mut parts = date
        .trim()
        .splitn(3, '-')
        .map(|part| part.parse::<i64>().ok());
    let (year, month, day) = (parts.next()??, parts.next()??, parts.next()??);

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    // Дни от начала эпохи по григорианскому календарю, год с марта.
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let days = era * 146_097 + of_era * 365 + of_era / 4 - of_era / 100 + of_year - 719_468;

    Some(days * 86_400_000)
}

fn field_of<'a>(issue: &'a Value, name: &str) -> &'a Value {
    issue["customFields"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|field| field["name"] == name)
        .map_or(&Value::Null, |field| &field["value"])
}

/// Первый статус до периода и последний за ним по изменениям поля State.
fn state_move(activities: &Value) -> Option<(Option<String>, Option<String>)> {
    let changes: Vec<&Value> = activities
        .as_array()?
        .iter()
        .filter(|item| {
            ["name", "presentation"]
                .iter()
                .any(|key| item["field"][key] == "State")
        })
        .collect();
    let name = |value: &Value| value[0]["name"].as_str().map(str::to_owned);
    let from = name(&changes.first()?["removed"]);
    let to = name(&changes.last()?["added"]);

    (from != to).then_some((from, to))
}

/// Изменения подзадач эпика с `since_ms`: подзадачи с полями и связями
/// как их отдаёт YouTrack и история полей и связей у тех, что менялись.
/// Встала задача, которая ждёт незакрытую, без исполнителя или после срока.
pub fn epic_changes(
    epic: Similar,
    since: &str,
    since_ms: i64,
    now: i64,
    subtasks: &Value,
    activities: &[(String, Value)],
) -> EpicChanges {
    let subtasks = subtasks.as_array().map(Vec::as_slice).unwrap_or_default();
    let after = |value: &Value| value.as_i64().is_some_and(|at| at >= since_ms);
    let history = |id: &str| {
        activities
            .iter()
            .find(|(known, _)| known == id)
            .map(|(_, items)| items)
    };
    let mut changes = EpicChanges {
        epic,
        since: since.to_owned(),
        closed: vec![],
        created: vec![],
        moved: vec![],
        stuck: vec![],
        links: vec![],
    };

    for issue in subtasks {
        let brief = Similar::of(issue);
        let open = issue["resolved"].is_null();

        if after(&issue["resolved"]) {
            changes.closed.push(Similar::of(issue));
        }

        if after(&issue["created"]) {
            changes.created.push(Similar::of(issue));
        }

        if let Some((from, to)) = history(&brief.id).and_then(state_move) {
            changes.moved.push(Moved {
                id: brief.id.clone(),
                summary: brief.summary.clone(),
                from,
                to,
            });
        }

        let kinds = issue_links(issue);

        for item in history(&brief.id)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|item| item["category"]["id"] == "LinksCategory")
        {
            for added in item["added"].as_array().into_iter().flatten() {
                let Some(with) = added["idReadable"].as_str() else {
                    continue;
                };

                // Вид связи берётся из нынешних связей: удалённая с тех пор
                // в сводку не идёт.
                if let Some(link) = kinds
                    .iter()
                    .find(|link| link.ids.iter().any(|id| id == with))
                {
                    changes.links.push(NewLink {
                        id: brief.id.clone(),
                        kind: link.kind.clone(),
                        with: with.to_owned(),
                    });
                }
            }
        }

        let blocked_by: Vec<String> = issue["links"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|link| link["direction"] == "OUTWARD" && link["linkType"]["name"] == "Depend")
            .flat_map(|link| link["issues"].as_array().into_iter().flatten())
            .filter(|other| other["resolved"].is_null())
            .filter_map(|other| other["idReadable"].as_str().map(str::to_owned))
            .collect();
        let no_assignee = field_of(issue, "Assignee").is_null();
        let overdue = field_of(issue, "Due Date")
            .as_i64()
            .is_some_and(|due| due < now);

        if open && (!blocked_by.is_empty() || no_assignee || overdue) {
            changes.stuck.push(Stuck {
                id: brief.id,
                summary: brief.summary,
                blocked_by,
                no_assignee,
                overdue,
            });
        }
    }

    changes
}

/// Человек, которого можно назначить исполнителем в проекте.
#[derive(Debug, PartialEq, Serialize)]
pub struct Person {
    pub login: String,
    pub name: String,
}

/// Исполнители проекта из ответа о его полях: пользователи набора
/// поля Assignee.
pub fn project_assignees(fields: &Value) -> Vec<Person> {
    fields
        .as_array()
        .into_iter()
        .flatten()
        .filter(|field| {
            field["field"]["name"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case("Assignee"))
        })
        .flat_map(|field| {
            field["bundle"]["aggregatedUsers"]
                .as_array()
                .into_iter()
                .flatten()
        })
        .filter_map(|user| {
            Some(Person {
                login: user["login"].as_str()?.to_owned(),
                name: user["fullName"].as_str().unwrap_or_default().to_owned(),
            })
        })
        .collect()
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

/// Что случилось с отслеживаемой задачей.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedKind {
    State,
    Comment,
    Assigned,
    Mentioned,
    /// Закрылась задача, от которой эта зависела.
    Unblocked,
    /// До срока меньше суток.
    DueSoon,
    Overdue,
}

/// Событие ленты. Номер события постоянный: тот же ответ YouTrack при
/// следующем опросе даёт тот же номер, и лента не покажет событие дважды.
#[derive(Debug, PartialEq, Serialize)]
pub struct FeedEvent {
    pub id: String,
    pub kind: FeedKind,
    pub issue: String,
    pub summary: String,
    pub project: String,
    /// Когда случилось, миллисекунды от начала эпохи.
    pub at: i64,
    pub author: Option<String>,
    /// Статус «было → стало», текст комментария, номер закрывшейся задачи.
    pub detail: Option<String>,
}

const DAY_MS: i64 = 86_400_000;

fn event(issue: &Value, id: String, kind: FeedKind, at: i64) -> FeedEvent {
    let brief = Similar::of(issue);

    FeedEvent {
        id,
        kind,
        issue: brief.id,
        summary: brief.summary,
        project: issue["project"]["shortName"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        at,
        author: None,
        detail: None,
    }
}

/// Событие из записи истории задачи. Своё человек и так знает: его правки
/// в ленту не идут.
fn activity_event(me: &str, issue: &Value, item: &Value) -> Option<FeedEvent> {
    if item["author"]["login"] == me {
        return None;
    }

    let field = ["name", "presentation"]
        .iter()
        .find_map(|key| item["field"][key].as_str())
        .unwrap_or_default();
    let added = &item["added"][0];
    let (kind, detail) = match item["category"]["id"].as_str()? {
        "CommentsCategory" => {
            let text = added["text"].as_str()?;
            let mentioned = text.contains(&format!("@{me}"));
            let kind = if mentioned {
                FeedKind::Mentioned
            } else {
                FeedKind::Comment
            };

            (kind, Some(text.chars().take(300).collect()))
        }
        "CustomFieldCategory" if field == "State" => {
            let name = |value: &Value| value[0]["name"].as_str().unwrap_or("—").to_owned();

            (
                FeedKind::State,
                Some(format!(
                    "{} → {}",
                    name(&item["removed"]),
                    name(&item["added"])
                )),
            )
        }
        "CustomFieldCategory"
            if field == "Assignee"
                && item["added"]
                    .as_array()
                    .is_some_and(|people| people.iter().any(|person| person["login"] == me)) =>
        {
            (FeedKind::Assigned, None)
        }
        _ => return None,
    };

    let mut found = event(
        issue,
        item["id"].as_str()?.to_owned(),
        kind,
        item["timestamp"].as_i64()?,
    );

    found.author = ["fullName", "login"]
        .iter()
        .find_map(|key| item["author"][key].as_str())
        .map(str::to_owned);
    found.detail = detail;

    Some(found)
}

/// События отслеживаемых задач с `since`: смена статуса, комментарий,
/// назначение и упоминание из истории задач, разблокировка по связям
/// и срок по полю Due Date. `me` это логин владельца токена.
pub fn feed_events(
    me: &str,
    since: i64,
    now: i64,
    issues: &Value,
    activities: &[(String, Value)],
) -> Vec<FeedEvent> {
    let mut events = vec![];

    for issue in issues.as_array().into_iter().flatten() {
        let id = issue["idReadable"].as_str().unwrap_or_default();

        for (_, items) in activities.iter().filter(|(known, _)| known == id) {
            events.extend(
                items
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|item| activity_event(me, issue, item)),
            );
        }

        if !issue["resolved"].is_null() {
            continue;
        }

        for blocker in issue["links"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|link| link["direction"] == "OUTWARD" && link["linkType"]["name"] == "Depend")
            .flat_map(|link| link["issues"].as_array().into_iter().flatten())
        {
            let (Some(other), Some(resolved)) =
                (blocker["idReadable"].as_str(), blocker["resolved"].as_i64())
            else {
                continue;
            };

            if resolved >= since {
                let mut found = event(
                    issue,
                    format!("unblocked:{id}:{other}"),
                    FeedKind::Unblocked,
                    resolved,
                );

                found.detail = Some(other.to_owned());
                events.push(found);
            }
        }

        if let Some(due) = field_of(issue, "Due Date").as_i64() {
            if due <= now {
                events.push(event(
                    issue,
                    format!("overdue:{id}:{due}"),
                    FeedKind::Overdue,
                    due,
                ));
            } else if due - now <= DAY_MS {
                events.push(event(
                    issue,
                    format!("due_soon:{id}:{due}"),
                    FeedKind::DueSoon,
                    now,
                ));
            }
        }
    }

    events.sort_by_key(|event| std::cmp::Reverse(event.at));
    events
}

/// Задача целиком для правой части ленты.
#[derive(Debug, PartialEq, Serialize)]
pub struct IssueDetail {
    pub id: String,
    pub summary: String,
    pub description: String,
    pub state: Option<String>,
    pub reporter: Option<String>,
    pub project: String,
    pub url: String,
    pub comments: Vec<Comment>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Comment {
    pub author: Option<String>,
    pub text: String,
    pub created: i64,
}

impl IssueDetail {
    pub fn of(id: &str, url: String, issue: &Value) -> Self {
        Self {
            id: id.to_owned(),
            summary: issue["summary"].as_str().unwrap_or_default().to_owned(),
            description: issue["description"].as_str().unwrap_or_default().to_owned(),
            state: field_value(issue, "State"),
            reporter: issue["reporter"]["fullName"].as_str().map(str::to_owned),
            project: issue["project"]["name"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            url,
            comments: issue["comments"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|comment| {
                    Some(Comment {
                        author: comment["author"]["fullName"].as_str().map(str::to_owned),
                        text: comment["text"].as_str()?.to_owned(),
                        created: comment["created"].as_i64().unwrap_or_default(),
                    })
                })
                .collect(),
        }
    }
}

/// Вид линии графа связей.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Subtask,
    Blocks,
    Relates,
}

/// Точка графа связей: задача с тем, что нужно для цвета и фильтров.
#[derive(Debug, PartialEq, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub summary: String,
    pub state: Option<String>,
    pub resolved: bool,
    pub assignee: Option<String>,
    pub project: String,
    pub url: String,
}

impl GraphNode {
    pub fn of(id: &str, url: String, issue: &Value) -> Self {
        Self {
            id: id.to_owned(),
            summary: issue["summary"].as_str().unwrap_or_default().to_owned(),
            state: field_value(issue, "State"),
            resolved: !issue["resolved"].is_null(),
            assignee: field_value(issue, "Assignee"),
            project: issue["project"]["shortName"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            url,
        }
    }
}

/// Линия графа. Подзадача идёт от родителя к дочерней, «блокирует» от
/// блокирующей задачи к заблокированной, «связана с» от меньшего номера
/// к большему: у неё нет направления, а одна связь видна с обеих сторон.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct TaskGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Связи задачи `id` линиями графа. Связи других типов (дубль и свои
/// типы YouTrack) граф не показывает.
pub fn graph_edges(id: &str, issue: &Value) -> Vec<GraphEdge> {
    let mut edges = vec![];

    for link in issue["links"].as_array().into_iter().flatten() {
        let outward = link["direction"] != "INWARD";
        let kind = match link["linkType"]["name"].as_str() {
            Some("Subtask") => EdgeKind::Subtask,
            Some("Depend") => EdgeKind::Blocks,
            Some("Relates") => EdgeKind::Relates,
            _ => continue,
        };

        for other in link["issues"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|issue| issue["idReadable"].as_str())
        {
            // Исходящая подзадача это «родитель для», исходящая зависимость
            // это «зависит от»: блокирует другая задача.
            let (from, to) = match (kind, outward) {
                (EdgeKind::Subtask, true) | (EdgeKind::Blocks, false) => (id, other),
                (EdgeKind::Subtask, false) | (EdgeKind::Blocks, true) => (other, id),
                (EdgeKind::Relates, _) => (id.min(other), id.max(other)),
            };

            edges.push(GraphEdge {
                from: from.to_owned(),
                to: to.to_owned(),
                kind,
            });
        }
    }

    edges
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
    use serde_json::json;

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

    #[test]
    fn связи_задачи_называются_с_её_стороны() {
        let issue = json!({
            "summary": "Вход по ссылке",
            "resolved": null,
            "customFields": [{ "name": "Due Date", "value": 1_798_675_200_000_i64 }],
            "links": [
                {
                    "direction": "OUTWARD",
                    "linkType": { "name": "Depend", "sourceToTarget": "depends on", "targetToSource": "is required for" },
                    "issues": [{ "idReadable": "SAP-2" }, { "idReadable": "SAP-3" }]
                },
                {
                    "direction": "INWARD",
                    "linkType": { "name": "Depend", "sourceToTarget": "depends on", "targetToSource": "is required for" },
                    "issues": [{ "idReadable": "SAP-9" }]
                },
                {
                    "direction": "BOTH",
                    "linkType": { "name": "Relates", "sourceToTarget": "", "targetToSource": "" },
                    "issues": [{ "idReadable": "SAP-4" }]
                },
                {
                    "direction": "OUTWARD",
                    "linkType": { "name": "Duplicate", "sourceToTarget": "duplicates" },
                    "issues": []
                }
            ]
        });
        let state = IssueState::of("SAP-1", "https://yt/issue/SAP-1".into(), &issue);

        assert_eq!(state.summary, "Вход по ссылке");
        assert!(!state.resolved);
        assert_eq!(state.due, Some(1_798_675_200_000));
        assert_eq!(
            state.links,
            vec![
                IssueLinks {
                    kind: "depends on".into(),
                    ids: vec!["SAP-2".into(), "SAP-3".into()]
                },
                IssueLinks {
                    kind: "is required for".into(),
                    ids: vec!["SAP-9".into()]
                },
                IssueLinks {
                    kind: "Relates".into(),
                    ids: vec!["SAP-4".into()]
                },
            ]
        );
    }

    #[test]
    fn дата_в_миллисекунды_полуночи_utc() {
        assert_eq!(date_ms("1970-01-01"), Some(0));
        assert_eq!(date_ms("2026-10-31"), Some(1_793_404_800_000));
        assert_eq!(date_ms("2024-02-29"), Some(1_709_164_800_000));
        assert_eq!(date_ms("2026-13-01"), None);
        assert_eq!(date_ms("вчера"), None);
    }

    #[test]
    fn сводка_эпика_видит_закрытое_новое_сдвинутое_вставшее_и_связи() {
        let day = 86_400_000;
        let since = date_ms("2026-10-26").unwrap();
        let now = since + 6 * day;
        let state = |from: &str, to: &str| {
            json!({
                "category": { "id": "CustomFieldCategory" },
                "field": { "presentation": "State" },
                "removed": [{ "name": from }],
                "added": [{ "name": to }],
            })
        };
        let depend = |issues: Value| json!({ "direction": "OUTWARD", "linkType": { "name": "Depend", "sourceToTarget": "depends on" }, "issues": issues });
        let assignee = json!({ "name": "Assignee", "value": { "fullName": "Анна" } });
        let subtasks = json!([
            { "idReadable": "SAP-2", "summary": "Таблица ссылок", "created": since - 10 * day, "resolved": since + day, "customFields": [assignee] },
            {
                "idReadable": "SAP-3", "summary": "Письмо", "created": since + day, "resolved": null,
                "customFields": [{ "name": "Assignee", "value": null }],
                "links": [depend(json!([{ "idReadable": "SAP-2", "resolved": since }, { "idReadable": "SAP-5", "resolved": null }]))],
            },
            {
                "idReadable": "SAP-4", "summary": "Экран", "created": since - day, "resolved": null,
                "customFields": [assignee, { "name": "Due Date", "value": now - day }],
            },
            { "idReadable": "SAP-7", "summary": "Поиск", "created": since - day, "resolved": null, "customFields": [assignee] },
            { "idReadable": "SAP-8", "summary": "Старое", "created": since - 30 * day, "resolved": since - 20 * day, "customFields": [] },
        ]);
        let activities = vec![
            (
                "SAP-3".to_owned(),
                json!([{ "category": { "id": "LinksCategory" }, "field": { "presentation": "links" }, "added": [{ "idReadable": "SAP-5" }], "removed": [] }]),
            ),
            (
                "SAP-4".to_owned(),
                json!([state("Open", "In Progress"), state("In Progress", "Review")]),
            ),
            // Статус вернулся к прежнему: не сдвинулась.
            (
                "SAP-7".to_owned(),
                json!([state("Open", "In Progress"), state("In Progress", "Open")]),
            ),
        ];
        let brief = |id: &str, summary: &str| Similar {
            id: id.into(),
            summary: summary.into(),
        };

        let changes = epic_changes(
            brief("SAP-1", "Вход без пароля"),
            "2026-10-26",
            since,
            now,
            &subtasks,
            &activities,
        );

        assert_eq!(changes.closed, [brief("SAP-2", "Таблица ссылок")]);
        assert_eq!(changes.created, [brief("SAP-3", "Письмо")]);
        assert_eq!(
            changes.moved,
            [Moved {
                id: "SAP-4".into(),
                summary: "Экран".into(),
                from: Some("Open".into()),
                to: Some("Review".into()),
            }]
        );
        assert_eq!(
            changes.stuck,
            [
                Stuck {
                    id: "SAP-3".into(),
                    summary: "Письмо".into(),
                    blocked_by: vec!["SAP-5".into()],
                    no_assignee: true,
                    overdue: false,
                },
                Stuck {
                    id: "SAP-4".into(),
                    summary: "Экран".into(),
                    blocked_by: vec![],
                    no_assignee: false,
                    overdue: true,
                },
            ]
        );
        assert_eq!(
            changes.links,
            [NewLink {
                id: "SAP-3".into(),
                kind: "depends on".into(),
                with: "SAP-5".into(),
            }]
        );
    }

    #[test]
    fn лента_из_истории_связей_и_срока_без_своих_правок() {
        let hour = 3_600_000;
        let since = 1_000 * DAY_MS;
        let now = since + 2 * hour;
        let anna = json!({ "login": "anna", "fullName": "Анна" });
        let me = json!({ "login": "ilya", "fullName": "Илья" });
        let issues = json!([
            {
                "idReadable": "SAP-1", "summary": "Вход", "project": { "shortName": "SAP" }, "resolved": null,
                "customFields": [{ "name": "Due Date", "value": now + 3 * hour }],
                "links": [{
                    "direction": "OUTWARD", "linkType": { "name": "Depend" },
                    "issues": [{ "idReadable": "SAP-2", "resolved": since + hour }, { "idReadable": "SAP-3", "resolved": since - hour }],
                }],
            },
            {
                "idReadable": "WEB-4", "summary": "Тема", "project": { "shortName": "WEB" }, "resolved": null,
                "customFields": [{ "name": "Due Date", "value": now - DAY_MS }],
            },
            { "idReadable": "SAP-5", "summary": "Закрыта", "project": { "shortName": "SAP" }, "resolved": since, "customFields": [{ "name": "Due Date", "value": 1 }] },
        ]);
        let activities = vec![(
            "SAP-1".to_owned(),
            json!([
                { "id": "a1", "timestamp": since + 10, "author": anna, "category": { "id": "CustomFieldCategory" },
                  "field": { "name": "State" }, "removed": [{ "name": "Open" }], "added": [{ "name": "In Progress" }] },
                { "id": "a2", "timestamp": since + 20, "author": anna, "category": { "id": "CommentsCategory" },
                  "added": [{ "text": "@ilya посмотри письмо" }] },
                { "id": "a3", "timestamp": since + 30, "author": anna, "category": { "id": "CommentsCategory" },
                  "added": [{ "text": "Готово" }] },
                { "id": "a4", "timestamp": since + 40, "author": anna, "category": { "id": "CustomFieldCategory" },
                  "field": { "presentation": "Assignee" }, "added": [{ "login": "ilya" }] },
                { "id": "a5", "timestamp": since + 50, "author": me, "category": { "id": "CommentsCategory" },
                  "added": [{ "text": "свой комментарий" }] },
                { "id": "a6", "timestamp": since + 60, "author": anna, "category": { "id": "CustomFieldCategory" },
                  "field": { "name": "Priority" }, "added": [{ "name": "Major" }] },
            ]),
        )];

        let events = feed_events("ilya", since, now, &issues, &activities);
        let brief: Vec<(&str, FeedKind, &str, Option<&str>)> = events
            .iter()
            .map(|event| {
                (
                    event.id.as_str(),
                    event.kind,
                    event.issue.as_str(),
                    event.detail.as_deref(),
                )
            })
            .collect();

        assert_eq!(
            brief,
            [
                (
                    "due_soon:SAP-1:".to_owned() + &(now + 3 * hour).to_string(),
                    FeedKind::DueSoon,
                    "SAP-1",
                    None
                ),
                (
                    "unblocked:SAP-1:SAP-2".to_owned(),
                    FeedKind::Unblocked,
                    "SAP-1",
                    Some("SAP-2")
                ),
                ("a4".to_owned(), FeedKind::Assigned, "SAP-1", None),
                ("a3".to_owned(), FeedKind::Comment, "SAP-1", Some("Готово")),
                (
                    "a2".to_owned(),
                    FeedKind::Mentioned,
                    "SAP-1",
                    Some("@ilya посмотри письмо")
                ),
                (
                    "a1".to_owned(),
                    FeedKind::State,
                    "SAP-1",
                    Some("Open → In Progress")
                ),
                (
                    "overdue:WEB-4:".to_owned() + &(now - DAY_MS).to_string(),
                    FeedKind::Overdue,
                    "WEB-4",
                    None
                ),
            ]
            .iter()
            .map(|(id, kind, issue, detail)| (id.as_str(), *kind, *issue, *detail))
            .collect::<Vec<_>>()
        );
        assert_eq!(events[2].author.as_deref(), Some("Анна"));
        assert_eq!(events[6].project, "WEB");
    }

    #[test]
    fn связи_задачи_линиями_графа_с_направлением_от_родителя_и_блокирующей() {
        let link = |direction: &str, kind: &str, ids: &[&str]| {
            json!({
                "direction": direction,
                "linkType": { "name": kind },
                "issues": ids.iter().map(|id| json!({ "idReadable": id })).collect::<Vec<_>>(),
            })
        };
        let issue = json!({ "links": [
            link("OUTWARD", "Subtask", &["SAP-2", "SAP-3"]),
            link("INWARD", "Subtask", &["SAP-1"]),
            link("OUTWARD", "Depend", &["SAP-4"]),
            link("INWARD", "Depend", &["SAP-6"]),
            link("BOTH", "Relates", &["SAP-10", "WEB-1"]),
            link("BOTH", "Duplicate", &["SAP-9"]),
        ] });
        let edge = |from: &str, to: &str, kind| GraphEdge {
            from: from.into(),
            to: to.into(),
            kind,
        };

        assert_eq!(
            graph_edges("SAP-5", &issue),
            vec![
                edge("SAP-5", "SAP-2", EdgeKind::Subtask),
                edge("SAP-5", "SAP-3", EdgeKind::Subtask),
                edge("SAP-1", "SAP-5", EdgeKind::Subtask),
                edge("SAP-4", "SAP-5", EdgeKind::Blocks),
                edge("SAP-5", "SAP-6", EdgeKind::Blocks),
                edge("SAP-10", "SAP-5", EdgeKind::Relates),
                edge("SAP-5", "WEB-1", EdgeKind::Relates),
            ]
        );
    }
}
