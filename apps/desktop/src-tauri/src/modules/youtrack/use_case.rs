use super::domain::{
    ApiError, Checked, Draft, IssueFacts, IssueState, Person, Published, Sent, Similar,
    YoutrackStatus, field_command, link_command, missing_fields, parse_host, parse_issue_id,
    project_assignees, search_words,
};
use super::ports::{HostPlace, Ledger, YoutrackApi};
use crate::error::AppError;
use crate::secrets::{SecretName, Secrets};
use serde_json::{Value, json};

/// Подключает сервер. Адрес и токен сохраняются, только когда YouTrack
/// по адресу принял токен: неработающее подключение не остаётся.
pub async fn connect(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    host: &str,
    token: &str,
) -> Result<YoutrackStatus, AppError> {
    let host = parse_host(host)?;
    let token = token.trim();

    if token.is_empty() {
        return Err(AppError::invalid("youtrack_token_empty"));
    }

    let name = api.me(&host, token).await?;

    secrets.set(SecretName::YoutrackToken, token)?;
    place.save(&host)?;

    Ok(YoutrackStatus::Connected { host, name })
}

/// Работает ли подключение прямо сейчас.
pub async fn status(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
) -> YoutrackStatus {
    let Some(host) = place.load() else {
        return YoutrackStatus::None;
    };

    // Без системного хранилища паролей токен не переживает перезапуск.
    let Some(token) = secrets.get(SecretName::YoutrackToken) else {
        return YoutrackStatus::Broken {
            host,
            code: "youtrack_token_missing",
        };
    };

    match api.me(&host, &token).await {
        Ok(name) => YoutrackStatus::Connected { host, name },
        Err(error) => YoutrackStatus::Broken {
            host,
            code: error.code(),
        },
    }
}

/// Стирает токен с устройства и забывает адрес.
pub fn disconnect(place: &impl HostPlace, secrets: &Secrets) -> Result<(), AppError> {
    secrets.delete(SecretName::YoutrackToken)?;
    place.clear()
}

// Поля задач для агента: в списке коротко, у одной задачи всё, что нужно
// прочитать её как человек.
const BRIEF: &str = "idReadable,summary,resolved,updated,project(shortName)";
const FULL: &str = "idReadable,summary,description,resolved,created,updated,project(name),\
reporter(fullName),customFields(name,value(name,fullName,text,presentation)),\
comments(text,author(fullName),created)";

/// Адрес и токен подключённого сервера.
fn connection(place: &impl HostPlace, secrets: &Secrets) -> Result<(String, String), AppError> {
    let host = place
        .load()
        .ok_or(AppError::not_found("youtrack_not_connected"))?;
    let token = secrets
        .get(SecretName::YoutrackToken)
        .ok_or(AppError::not_found("youtrack_token_missing"))?;

    Ok((host, token))
}

async fn read(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    path: &str,
    query: &[(&str, &str)],
) -> Result<String, AppError> {
    let (host, token) = connection(place, secrets)?;

    Ok(api.get(&host, &token, path, query).await?)
}

fn json_of(body: &str) -> Result<Value, AppError> {
    serde_json::from_str(body).map_err(|_| AppError::invalid("youtrack_not_youtrack"))
}

/// Внутренний номер проекта по короткому имени, без учёта регистра.
async fn project_id(
    api: &impl YoutrackApi,
    host: &str,
    token: &str,
    short: &str,
) -> Result<String, AppError> {
    let short = short.trim();
    let query = [
        ("fields", "id,shortName"),
        ("query", short),
        ("$top", "100"),
    ];
    let projects = json_of(&api.get(host, token, "/api/admin/projects", &query).await?)?;

    projects
        .as_array()
        .into_iter()
        .flatten()
        .find(|project| {
            project["shortName"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case(short))
        })
        .and_then(|project| project["id"].as_str())
        // Номер встаёт в путь запроса: только знакомые знаки.
        .and_then(parse_issue_id)
        .map(str::to_owned)
        .ok_or(AppError::invalid("youtrack_project_missing"))
}

async fn command(api: &impl YoutrackApi, host: &str, token: &str, id: &str, query: &str) -> bool {
    let body = json!({ "query": query, "issues": [{ "idReadable": id }] });

    api.post(host, token, "/api/commands", &[], &body)
        .await
        .is_ok()
}

/// Обязательные поля проекта, которых нет в черновике.
async fn missing_in(
    api: &impl YoutrackApi,
    host: &str,
    token: &str,
    project: &str,
    draft: &Draft,
) -> Result<Vec<String>, AppError> {
    let query = [
        ("fields", "field(name),canBeEmpty,defaultValues(name)"),
        ("$top", "200"),
    ];
    let path = format!("/api/admin/projects/{project}/customFields");
    let fields = json_of(&api.get(host, token, &path, &query).await?)?;

    Ok(missing_fields(&fields, draft))
}

/// Новая задача: проект по короткому имени, обязательные поля проекта,
/// потом сама задача с названием и описанием. Номер новой задачи или
/// обязательные поля, которых не хватило.
async fn create(
    api: &impl YoutrackApi,
    host: &str,
    token: &str,
    draft: &Draft,
) -> Result<Result<String, Published>, AppError> {
    let project = project_id(api, host, token, &draft.project).await?;
    let missing = missing_in(api, host, token, &project, draft).await?;

    if !missing.is_empty() {
        return Ok(Err(Published::Missing { fields: missing }));
    }

    let body = json!({
        "project": { "id": project },
        "summary": draft.summary,
        "description": draft.description,
    });
    let created = json_of(
        &api.post(
            host,
            token,
            "/api/issues",
            &[("fields", "idReadable")],
            &body,
        )
        .await?,
    )?;

    created["idReadable"]
        .as_str()
        .map(|id| Ok(id.to_owned()))
        .ok_or(AppError::invalid("youtrack_not_youtrack"))
}

/// Обновляет название и описание задачи. Если их поменяли в YouTrack после
/// прошлой публикации, ничего не отправляет и возвращает их версию: молча
/// затереть чужую правку нельзя. `force` отправляет поверх.
async fn update(
    api: &impl YoutrackApi,
    host: &str,
    token: &str,
    last: Option<&Sent>,
    draft: &Draft,
    id: &str,
    force: bool,
) -> Result<Option<Published>, AppError> {
    let path = format!("/api/issues/{id}");
    let issue = json_of(
        &api.get(host, token, &path, &[("fields", "summary,description")])
            .await?,
    )?;
    let summary = issue["summary"].as_str().unwrap_or_default().trim();
    let description = issue["description"].as_str().unwrap_or_default().trim();
    let same = summary == draft.summary.trim() && description == draft.description.trim();
    // Без памяти о прошлой публикации (другое устройство) не видно, кто
    // правил: спрашиваем человека.
    let changed_there = last.is_none_or(|sent| {
        summary != sent.summary.trim() || description != sent.description.trim()
    });

    if same {
        return Ok(None);
    }

    if changed_there && !force {
        return Ok(Some(Published::Diverged {
            summary: summary.to_owned(),
            description: description.to_owned(),
        }));
    }

    let body = json!({ "summary": draft.summary, "description": draft.description });

    api.post(host, token, &path, &[], &body).await?;
    Ok(None)
}

/// Публикует черновик. Без номера создаёт задачу, с номером обновляет её
/// (`update`). Поля и связи ставятся командами YouTrack по одной: у какой
/// команды не вышло, та возвращается в `failed`, а задача уже есть, и её
/// номер нужен заметке, чтобы повтор не создал вторую. Поле, которое
/// не менялось с прошлой публикации, не отправляется: так правка
/// исполнителя в YouTrack не перетирается старым значением из заметки.
pub async fn publish(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    ledger: &impl Ledger,
    draft: &Draft,
    id: Option<&str>,
    force: bool,
) -> Result<Published, AppError> {
    let (host, token) = connection(place, secrets)?;

    if draft
        .links
        .iter()
        .any(|link| parse_issue_id(&link.id).is_none())
    {
        return Err(AppError::invalid("youtrack_issue_invalid"));
    }

    let id = match id {
        Some(id) => {
            let id = parse_issue_id(id).ok_or(AppError::invalid("youtrack_issue_invalid"))?;
            let last = ledger.load(id);

            if let Some(diverged) =
                update(api, &host, &token, last.as_ref(), draft, id, force).await?
            {
                return Ok(diverged);
            }

            id.to_owned()
        }
        None => match create(api, &host, &token, draft).await? {
            Ok(id) => id,
            Err(missing) => return Ok(missing),
        },
    };
    let last = ledger.load(&id);
    let mut applied = vec![];
    let mut failed = vec![];

    for field in &draft.fields {
        let unchanged = last
            .as_ref()
            .is_some_and(|sent| sent.fields.contains(field));

        if unchanged || command(api, &host, &token, &id, &field_command(field)).await {
            applied.push(field.clone());
        } else {
            failed.push(field_command(field));
        }
    }

    for link in &draft.links {
        let query = link_command(link);

        if !command(api, &host, &token, &id, &query).await {
            failed.push(query);
        }
    }

    let sent = Sent {
        summary: draft.summary.clone(),
        description: draft.description.clone(),
        fields: applied,
    };

    // Задача уже есть, и её номер важнее памяти: без памяти следующая
    // публикация спросит человека, как с другого устройства, а без номера
    // повтор создал бы вторую задачу.
    if ledger.save(&id, &sent).is_err() {
        log::warn!("память опубликованного не записана для {id}");
    }

    Ok(Published::Done { id, failed })
}

/// Задача для плашки над черновиком и карточки номера в тексте: название,
/// статус, исполнитель, срок и связи.
pub async fn issue_state(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    id: &str,
) -> Result<IssueState, AppError> {
    let (host, token) = connection(place, secrets)?;
    let id = parse_issue_id(id).ok_or(AppError::invalid("youtrack_issue_invalid"))?;
    let query = [(
        "fields",
        "summary,resolved,customFields(name,value(name,login,fullName)),\
links(direction,linkType(name,sourceToTarget,targetToSource),issues(idReadable))",
    )];
    let issue = json_of(
        &api.get(&host, &token, &format!("/api/issues/{id}"), &query)
            .await?,
    )?;

    Ok(IssueState::of(id, format!("{host}/issue/{id}"), &issue))
}

/// Короткие имена проектов: с них начинаются номера задач.
pub async fn projects(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
) -> Result<Vec<String>, AppError> {
    let query = [("fields", "shortName"), ("$top", "500")];
    let projects = json_of(&read(api, place, secrets, "/api/admin/projects", &query).await?)?;

    Ok(projects
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|project| project["shortName"].as_str().map(str::to_owned))
        .collect())
}

/// Последние сто задач проекта, свежие первыми: подсказка после «SAP-».
pub async fn project_issues(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    project: &str,
) -> Result<Vec<Similar>, AppError> {
    let project = parse_issue_id(project).ok_or(AppError::invalid("youtrack_project_missing"))?;

    briefs(
        api,
        place,
        secrets,
        &format!("project: {{{project}}} sort by: updated desc"),
        "100",
    )
    .await
}

/// Номера и названия задач по запросу на языке поиска YouTrack.
async fn briefs(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    query: &str,
    top: &str,
) -> Result<Vec<Similar>, AppError> {
    let query = [
        ("query", query),
        ("fields", "idReadable,summary"),
        ("$top", top),
    ];
    let found = json_of(&read(api, place, secrets, "/api/issues", &query).await?)?;

    Ok(found
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|issue| {
            Some(Similar {
                id: issue["idReadable"].as_str()?.to_owned(),
                summary: issue["summary"].as_str()?.to_owned(),
            })
        })
        .collect())
}

/// Задачи по запросу на языке поиска YouTrack, первые двадцать.
pub async fn search_issues(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    query: &str,
) -> Result<String, AppError> {
    let query = [("query", query), ("fields", BRIEF), ("$top", "20")];

    read(api, place, secrets, "/api/issues", &query).await
}

/// Задача по номеру вроде `SAP-12`. Номер встаёт в путь запроса, поэтому
/// в нём только буквы, цифры, дефис и подчёркивание.
pub async fn issue(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    id: &str,
) -> Result<String, AppError> {
    let id = parse_issue_id(id).ok_or(AppError::invalid("youtrack_issue_invalid"))?;

    read(
        api,
        place,
        secrets,
        &format!("/api/issues/{id}"),
        &[("fields", FULL)],
    )
    .await
}

/// Проверка черновика у YouTrack: есть ли проект, каких обязательных полей
/// не хватает и что с задачами, на которые он ссылается. Связи на черновики
/// окно проверяет само, сюда приходят только номера задач.
pub async fn check(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    draft: &Draft,
) -> Result<Checked, AppError> {
    let (host, token) = connection(place, secrets)?;
    let missing = match project_id(api, &host, &token, &draft.project).await {
        Ok(project) => Some(missing_in(api, &host, &token, &project, draft).await?),
        Err(error) if error == AppError::invalid("youtrack_project_missing") => None,
        Err(error) => return Err(error),
    };
    let mut issues: Vec<IssueFacts> = vec![];
    let query = [("fields", "resolved,customFields(name,value(name))")];

    for id in draft
        .links
        .iter()
        .filter_map(|link| parse_issue_id(&link.id))
    {
        if issues.iter().any(|facts| facts.id == id) {
            continue;
        }

        let facts = match api
            .get(&host, &token, &format!("/api/issues/{id}"), &query)
            .await
        {
            Ok(body) => IssueFacts::of(id, &json_of(&body)?),
            Err(ApiError::Missing) => IssueFacts::missing(id),
            Err(error) => return Err(error.into()),
        };

        issues.push(facts);
    }

    Ok(Checked {
        project_found: missing.is_some(),
        missing: missing.unwrap_or_default(),
        issues,
    })
}

/// Задачи проекта, в названии или описании которых есть слова названия
/// черновика: кандидаты в дубли. Поиск YouTrack, а не модели: он ничего
/// не стоит и отвечает сразу.
pub async fn similar(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    project: &str,
    summary: &str,
) -> Result<Vec<Similar>, AppError> {
    let project = parse_issue_id(project).ok_or(AppError::invalid("youtrack_project_missing"))?;
    let words = search_words(summary);

    if words.is_empty() {
        return Ok(vec![]);
    }

    let query = format!("project: {{{project}}} ({})", words.join(" or "));

    briefs(api, place, secrets, &query, "20").await
}

/// Кого можно назначить исполнителем в проекте: по этому списку окно узнаёт
/// исполнителя, которого назвали по имени.
pub async fn assignees(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    project: &str,
) -> Result<Vec<Person>, AppError> {
    let (host, token) = connection(place, secrets)?;
    let project = project_id(api, &host, &token, project).await?;
    let query = [
        (
            "fields",
            "field(name),bundle(aggregatedUsers(login,fullName))",
        ),
        ("$top", "200"),
    ];
    let path = format!("/api/admin/projects/{project}/customFields");

    Ok(project_assignees(&json_of(
        &api.get(&host, &token, &path, &query).await?,
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::youtrack::domain::{ApiError, Field, Link, LinkKind};
    use std::collections::BTreeMap;
    use std::sync::Mutex;
    use tauri::async_runtime::block_on;

    /// Сервер, который знает один токен.
    struct FakeApi {
        token: &'static str,
        answer: Result<(), ApiError>,
    }

    impl YoutrackApi for FakeApi {
        async fn me(&self, _host: &str, token: &str) -> Result<String, ApiError> {
            self.answer?;

            if token != self.token {
                return Err(ApiError::TokenRejected);
            }

            Ok("Илья".into())
        }

        /// Отвечает тем, о чём спросили: так видно путь и параметры.
        async fn get(
            &self,
            host: &str,
            token: &str,
            path: &str,
            query: &[(&str, &str)],
        ) -> Result<String, ApiError> {
            self.me(host, token).await?;

            Ok(format!("{host}{path} {query:?}"))
        }

        async fn post(
            &self,
            host: &str,
            token: &str,
            _path: &str,
            _query: &[(&str, &str)],
            _body: &Value,
        ) -> Result<String, ApiError> {
            self.me(host, token).await.map(|_| String::new())
        }
    }

    /// YouTrack в памяти: проект SAP, у которого Subsystem обязателен
    /// и без значения по умолчанию, задачи и применённые команды.
    #[derive(Default)]
    struct Board {
        issues: Mutex<BTreeMap<String, (String, String)>>,
        commands: Mutex<Vec<String>>,
        /// Команды, которые YouTrack не примет.
        rejected: Vec<&'static str>,
        /// Решённые задачи.
        closed: Vec<&'static str>,
        /// Запросы поиска задач, по порядку.
        searches: Mutex<Vec<String>>,
    }

    impl Board {
        fn issue(&self, id: &str) -> Option<(String, String)> {
            self.issues.lock().unwrap().get(id).cloned()
        }

        fn commands(&self) -> Vec<String> {
            self.commands.lock().unwrap().clone()
        }
    }

    impl YoutrackApi for Board {
        async fn me(&self, _host: &str, _token: &str) -> Result<String, ApiError> {
            Ok("Илья".into())
        }

        async fn get(
            &self,
            _host: &str,
            _token: &str,
            path: &str,
            query: &[(&str, &str)],
        ) -> Result<String, ApiError> {
            let answer = match path {
                "/api/issues" => {
                    let search = query.iter().find(|(key, _)| *key == "query").unwrap().1;
                    let found: Vec<Value> = self
                        .issues
                        .lock()
                        .unwrap()
                        .iter()
                        .map(|(id, (summary, _))| json!({ "idReadable": id, "summary": summary }))
                        .collect();

                    self.searches.lock().unwrap().push(search.into());
                    json!(found)
                }
                "/api/admin/projects" => json!([{ "id": "0-1", "shortName": "SAP" }]),
                "/api/admin/projects/0-1/customFields" => json!([
                    { "field": { "name": "Priority" }, "canBeEmpty": false, "defaultValues": [{ "name": "Normal" }] },
                    { "field": { "name": "Subsystem" }, "canBeEmpty": false, "defaultValues": [] },
                    { "field": { "name": "Fix versions" }, "canBeEmpty": true },
                    {
                        "field": { "name": "Assignee" },
                        "canBeEmpty": true,
                        "bundle": { "aggregatedUsers": [
                            { "login": "ilya", "fullName": "Илья Оберемок" },
                            { "login": "anna" },
                        ] },
                    },
                ]),
                _ => {
                    let id = path.strip_prefix("/api/issues/").ok_or(ApiError::Missing)?;
                    let (summary, description) = self.issue(id).ok_or(ApiError::Missing)?;

                    let resolved = self.closed.contains(&id).then_some(1_767_225_600_000_i64);

                    json!({
                        "summary": summary,
                        "description": description,
                        "resolved": resolved,
                        "customFields": [
                            { "name": "State", "value": { "name": "Open" } },
                            { "name": "Assignee", "value": { "login": "ilya", "fullName": "Илья Оберемок" } },
                            { "name": "Sprints", "value": [{ "name": "Sprint 5" }] },
                            { "name": "Due Date", "value": 1_767_225_600_000_i64 },
                        ],
                    })
                }
            };

            Ok(answer.to_string())
        }

        async fn post(
            &self,
            _host: &str,
            _token: &str,
            path: &str,
            _query: &[(&str, &str)],
            body: &Value,
        ) -> Result<String, ApiError> {
            let text = |key: &str| body[key].as_str().unwrap_or_default().to_owned();

            if path == "/api/commands" {
                let query = text("query");

                if self.rejected.contains(&query.as_str()) {
                    return Err(ApiError::Rejected);
                }

                self.commands.lock().unwrap().push(query);
                return Ok(String::new());
            }

            let mut issues = self.issues.lock().unwrap();

            if path == "/api/issues" {
                let id = format!("SAP-{}", issues.len() + 1);

                issues.insert(id.clone(), (text("summary"), text("description")));
                return Ok(json!({ "idReadable": id }).to_string());
            }

            let id = path.strip_prefix("/api/issues/").unwrap();

            issues.insert(id.into(), (text("summary"), text("description")));
            Ok("{}".into())
        }
    }

    #[derive(Default)]
    struct Memory(Mutex<BTreeMap<String, Sent>>);

    impl Ledger for Memory {
        fn load(&self, id: &str) -> Option<Sent> {
            self.0.lock().unwrap().get(id).cloned()
        }

        fn save(&self, id: &str, sent: &Sent) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(id.into(), sent.clone());
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakePlace(Mutex<Option<String>>);

    impl HostPlace for FakePlace {
        fn load(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }

        fn save(&self, host: &str) -> Result<(), AppError> {
            *self.0.lock().unwrap() = Some(host.into());
            Ok(())
        }

        fn clear(&self) -> Result<(), AppError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    const TOKEN: &str = "perm:aWx5YQ==.c2FwaWVu.secret";

    fn server() -> FakeApi {
        FakeApi {
            token: TOKEN,
            answer: Ok(()),
        }
    }

    #[test]
    fn подключение_сохраняет_адрес_и_токен_и_называет_владельца() {
        let place = FakePlace::default();
        let secrets = Secrets::in_memory();

        let connected = block_on(connect(
            &server(),
            &place,
            &secrets,
            "acme.youtrack.cloud/",
            &format!(" {TOKEN}\n"),
        ));

        let expected = YoutrackStatus::Connected {
            host: "https://acme.youtrack.cloud".into(),
            name: "Илья".into(),
        };
        assert_eq!(connected, Ok(expected));
        assert_eq!(
            secrets.get(SecretName::YoutrackToken).as_deref(),
            Some(TOKEN)
        );
        assert_eq!(
            block_on(status(&server(), &place, &secrets)),
            YoutrackStatus::Connected {
                host: "https://acme.youtrack.cloud".into(),
                name: "Илья".into(),
            }
        );
    }

    #[test]
    fn отказ_сервера_ничего_не_сохраняет() {
        let place = FakePlace::default();
        let secrets = Secrets::in_memory();
        let offline = FakeApi {
            token: TOKEN,
            answer: Err(ApiError::Unreachable),
        };

        let rejected = block_on(connect(
            &server(),
            &place,
            &secrets,
            "acme.youtrack.cloud",
            "perm:чужой",
        ));
        let unreachable = block_on(connect(
            &offline,
            &place,
            &secrets,
            "acme.youtrack.cloud",
            TOKEN,
        ));

        assert_eq!(rejected, Err(AppError::invalid("youtrack_token_rejected")));
        assert_eq!(
            unreachable,
            Err(AppError::unavailable("youtrack_unreachable"))
        );
        assert_eq!(place.load(), None);
        assert_eq!(secrets.get(SecretName::YoutrackToken), None);
    }

    #[test]
    fn сломанное_подключение_называет_причину() {
        let place = FakePlace::default();
        let secrets = Secrets::in_memory();
        block_on(connect(
            &server(),
            &place,
            &secrets,
            "acme.youtrack.cloud",
            TOKEN,
        ))
        .unwrap();
        let revoked = FakeApi {
            token: "perm:новый",
            answer: Ok(()),
        };

        assert_eq!(
            block_on(status(&revoked, &place, &secrets)),
            YoutrackStatus::Broken {
                host: "https://acme.youtrack.cloud".into(),
                code: "youtrack_token_rejected",
            }
        );

        // Перезапуск без системного хранилища паролей: адрес помнится,
        // токена нет.
        assert_eq!(
            block_on(status(&server(), &place, &Secrets::in_memory())),
            YoutrackStatus::Broken {
                host: "https://acme.youtrack.cloud".into(),
                code: "youtrack_token_missing",
            }
        );
    }

    #[test]
    fn агент_читает_задачи_только_у_подключённого_сервера() {
        let place = FakePlace::default();
        let secrets = Secrets::in_memory();

        assert_eq!(
            block_on(search_issues(&server(), &place, &secrets, "#Unresolved")),
            Err(AppError::not_found("youtrack_not_connected"))
        );

        block_on(connect(
            &server(),
            &place,
            &secrets,
            "acme.youtrack.cloud",
            TOKEN,
        ))
        .unwrap();

        let found = block_on(search_issues(&server(), &place, &secrets, "#Unresolved")).unwrap();
        let one = block_on(issue(&server(), &place, &secrets, " SAP-12 ")).unwrap();

        assert!(
            found.starts_with(
                "https://acme.youtrack.cloud/api/issues [(\"query\", \"#Unresolved\")"
            )
        );
        assert!(one.starts_with("https://acme.youtrack.cloud/api/issues/SAP-12 "));
        assert_eq!(
            block_on(issue(&server(), &place, &secrets, "../admin")),
            Err(AppError::invalid("youtrack_issue_invalid"))
        );
    }

    #[test]
    fn отключение_стирает_токен_и_адрес() {
        let place = FakePlace::default();
        let secrets = Secrets::in_memory();
        block_on(connect(
            &server(),
            &place,
            &secrets,
            "acme.youtrack.cloud",
            TOKEN,
        ))
        .unwrap();

        disconnect(&place, &secrets).unwrap();

        assert_eq!(secrets.get(SecretName::YoutrackToken), None);
        assert_eq!(
            block_on(status(&server(), &place, &secrets)),
            YoutrackStatus::None
        );
    }

    fn connected() -> (FakePlace, Secrets) {
        let place = FakePlace::default();
        let secrets = Secrets::in_memory();

        place.save("https://acme.youtrack.cloud").unwrap();
        secrets.set(SecretName::YoutrackToken, TOKEN).unwrap();
        (place, secrets)
    }

    fn field(name: &str, value: &str) -> Field {
        Field {
            name: name.into(),
            value: value.into(),
        }
    }

    fn draft(fields: Vec<Field>) -> Draft {
        Draft {
            project: "sap".into(),
            summary: "Вход по ссылке".into(),
            description: "Письмо со ссылкой вместо пароля.".into(),
            fields,
            links: vec![
                Link {
                    kind: LinkKind::Parent,
                    id: "SAP-90".into(),
                },
                Link {
                    kind: LinkKind::DependsOn,
                    id: "SAP-91".into(),
                },
            ],
        }
    }

    fn publish_to(
        board: &Board,
        ledger: &Memory,
        draft: &Draft,
        id: Option<&str>,
        force: bool,
    ) -> Result<Published, AppError> {
        let (place, secrets) = connected();

        block_on(publish(board, &place, &secrets, ledger, draft, id, force))
    }

    #[test]
    fn черновик_становится_задачей_с_полями_и_связями() {
        let board = Board::default();
        let ledger = Memory::default();
        let fields = vec![field("Subsystem", "Backend"), field("Priority", "Major")];

        let published = publish_to(&board, &ledger, &draft(fields), None, false);

        assert_eq!(
            published,
            Ok(Published::Done {
                id: "SAP-1".into(),
                failed: vec![]
            })
        );
        assert_eq!(
            board.issue("SAP-1"),
            Some((
                "Вход по ссылке".into(),
                "Письмо со ссылкой вместо пароля.".into()
            ))
        );
        assert_eq!(
            board.commands(),
            [
                "Subsystem Backend",
                "Priority Major",
                "subtask of SAP-90",
                "depends on SAP-91"
            ]
        );
    }

    /// Папка данных недоступна для записи.
    struct Unwritable;

    impl Ledger for Unwritable {
        fn load(&self, _: &str) -> Option<Sent> {
            None
        }

        fn save(&self, _: &str, _: &Sent) -> Result<(), AppError> {
            Err(AppError::unavailable("youtrack_sent_unwritable"))
        }
    }

    #[test]
    fn номер_созданной_задачи_приходит_и_без_памяти_о_публикации() {
        let board = Board::default();
        let (place, secrets) = connected();
        let draft = draft(vec![field("Subsystem", "Backend")]);

        let published = block_on(publish(
            &board,
            &place,
            &secrets,
            &Unwritable,
            &draft,
            None,
            false,
        ));

        assert_eq!(
            published,
            Ok(Published::Done {
                id: "SAP-1".into(),
                failed: vec![]
            })
        );
    }

    #[test]
    fn без_обязательного_поля_или_проекта_задача_не_создаётся() {
        let board = Board::default();
        let ledger = Memory::default();
        let mut elsewhere = draft(vec![field("Subsystem", "Backend")]);

        elsewhere.project = "NOPE".into();

        assert_eq!(
            publish_to(&board, &ledger, &draft(vec![]), None, false),
            Ok(Published::Missing {
                fields: vec!["Subsystem".into()]
            })
        );
        assert_eq!(
            publish_to(&board, &ledger, &elsewhere, None, false),
            Err(AppError::invalid("youtrack_project_missing"))
        );
        assert_eq!(board.issue("SAP-1"), None);
    }

    #[test]
    fn поле_которое_youtrack_не_принял_видно_и_уходит_снова_при_обновлении() {
        let board = Board {
            rejected: vec!["Assignee nobody"],
            ..Board::default()
        };
        let ledger = Memory::default();
        let fields = vec![field("Subsystem", "Backend"), field("Assignee", "nobody")];

        assert_eq!(
            publish_to(&board, &ledger, &draft(fields.clone()), None, false),
            Ok(Published::Done {
                id: "SAP-1".into(),
                failed: vec!["Assignee nobody".into()]
            })
        );

        let fixed = vec![field("Subsystem", "Backend"), field("Assignee", "ilya")];

        board.commands.lock().unwrap().clear();

        assert_eq!(
            publish_to(&board, &ledger, &draft(fixed), Some("SAP-1"), false),
            Ok(Published::Done {
                id: "SAP-1".into(),
                failed: vec![]
            })
        );
        // Subsystem не менялся с прошлой публикации и не отправляется.
        assert_eq!(
            board.commands(),
            ["Assignee ilya", "subtask of SAP-90", "depends on SAP-91"]
        );
    }

    #[test]
    fn обновление_не_затирает_правку_в_youtrack_молча() {
        let board = Board::default();
        let ledger = Memory::default();
        let mut mine = draft(vec![field("Subsystem", "Backend")]);

        publish_to(&board, &ledger, &mine, None, false).unwrap();
        board.issues.lock().unwrap().insert(
            "SAP-1".into(),
            ("Вход по ссылке и коду".into(), "Правка в YouTrack.".into()),
        );
        mine.description = "Правка в заметке.".into();

        assert_eq!(
            publish_to(&board, &ledger, &mine, Some("SAP-1"), false),
            Ok(Published::Diverged {
                summary: "Вход по ссылке и коду".into(),
                description: "Правка в YouTrack.".into()
            })
        );
        assert_eq!(
            board.issue("SAP-1").map(|(_, description)| description),
            Some("Правка в YouTrack.".into())
        );

        publish_to(&board, &ledger, &mine, Some("SAP-1"), true).unwrap();

        assert_eq!(
            board.issue("SAP-1").map(|(_, description)| description),
            Some("Правка в заметке.".into())
        );

        // После отправки поверх их правка учтена: следующее обновление идёт.
        mine.summary = "Вход по одноразовой ссылке".into();

        assert!(matches!(
            publish_to(&board, &ledger, &mine, Some("SAP-1"), false),
            Ok(Published::Done { .. })
        ));
    }

    #[test]
    fn плашка_знает_статус_исполнителя_и_адрес() {
        let board = Board::default();
        let (place, secrets) = connected();

        publish_to(
            &board,
            &Memory::default(),
            &draft(vec![field("Subsystem", "Backend")]),
            None,
            false,
        )
        .unwrap();

        assert_eq!(
            block_on(issue_state(&board, &place, &secrets, "SAP-1")),
            Ok(IssueState {
                id: "SAP-1".into(),
                summary: "Вход по ссылке".into(),
                state: Some("Open".into()),
                resolved: false,
                assignee: Some("Илья Оберемок".into()),
                due: Some(1_767_225_600_000),
                links: vec![],
                url: "https://acme.youtrack.cloud/issue/SAP-1".into(),
            })
        );
        assert_eq!(
            block_on(issue_state(&board, &place, &secrets, "SAP-404")),
            Err(AppError::not_found("youtrack_missing"))
        );
    }

    fn with_issues(ids: &[&str], closed: Vec<&'static str>) -> Board {
        let board = Board {
            closed,
            ..Board::default()
        };

        for id in ids {
            board
                .issues
                .lock()
                .unwrap()
                .insert((*id).into(), (format!("Задача {id}"), String::new()));
        }

        board
    }

    #[test]
    fn проверка_знает_связанные_задачи_и_обязательные_поля() {
        let board = with_issues(&["SAP-90", "SAP-91"], vec!["SAP-90"]);
        let (place, secrets) = connected();
        let mut draft = draft(vec![]);

        draft.links.push(Link {
            kind: LinkKind::RelatesTo,
            id: "SAP-404".into(),
        });
        draft.links.push(Link {
            kind: LinkKind::Blocks,
            id: "SAP-91".into(),
        });

        let checked = block_on(check(&board, &place, &secrets, &draft)).unwrap();

        assert!(checked.project_found);
        assert_eq!(checked.missing, ["Subsystem"]);
        assert_eq!(
            checked.issues,
            [
                IssueFacts {
                    id: "SAP-90".into(),
                    found: true,
                    resolved: true,
                    sprint: Some("Sprint 5".into()),
                    due: Some(1_767_225_600_000),
                },
                IssueFacts {
                    id: "SAP-91".into(),
                    found: true,
                    resolved: false,
                    sprint: Some("Sprint 5".into()),
                    due: Some(1_767_225_600_000),
                },
                IssueFacts::missing("SAP-404"),
            ]
        );

        draft.project = "nope".into();

        let checked = block_on(check(&board, &place, &secrets, &draft)).unwrap();

        assert!(!checked.project_found);
        assert!(checked.missing.is_empty());
    }

    #[test]
    fn похожие_ищутся_по_словам_названия_в_проекте() {
        let board = with_issues(&["SAP-3"], vec![]);
        let (place, secrets) = connected();

        let found = block_on(similar(
            &board,
            &place,
            &secrets,
            "SAP",
            "Вход по ссылке: SAP-1",
        ));

        assert_eq!(
            found,
            Ok(vec![Similar {
                id: "SAP-3".into(),
                summary: "Задача SAP-3".into(),
            }])
        );
        assert_eq!(
            *board.searches.lock().unwrap(),
            ["project: {SAP} (вход or ссылке or sap)"]
        );
        assert_eq!(
            block_on(similar(&board, &place, &secrets, "SAP", "по и")),
            Ok(vec![])
        );
    }

    #[test]
    fn подсказка_номеров_знает_проекты_и_свежие_задачи() {
        let board = with_issues(&["SAP-3"], vec![]);
        let (place, secrets) = connected();

        assert_eq!(
            block_on(projects(&board, &place, &secrets)),
            Ok(vec!["SAP".to_owned()])
        );
        assert_eq!(
            block_on(project_issues(&board, &place, &secrets, "SAP")),
            Ok(vec![Similar {
                id: "SAP-3".into(),
                summary: "Задача SAP-3".into(),
            }])
        );
        assert_eq!(
            *board.searches.lock().unwrap(),
            ["project: {SAP} sort by: updated desc"]
        );
        // Имя проекта встаёт в запрос: скобка его бы закрыла.
        assert_eq!(
            block_on(project_issues(&board, &place, &secrets, "SAP} or {X")),
            Err(AppError::invalid("youtrack_project_missing"))
        );
    }

    #[test]
    fn исполнители_проекта_из_набора_поля_assignee() {
        let board = with_issues(&[], vec![]);
        let (place, secrets) = connected();

        assert_eq!(
            block_on(assignees(&board, &place, &secrets, "sap")),
            Ok(vec![
                Person {
                    login: "ilya".into(),
                    name: "Илья Оберемок".into(),
                },
                Person {
                    login: "anna".into(),
                    name: String::new(),
                },
            ])
        );
        assert_eq!(
            block_on(assignees(&board, &place, &secrets, "WEB")),
            Err(AppError::invalid("youtrack_project_missing"))
        );
    }
}
