use super::domain::{YoutrackStatus, parse_host, parse_issue_id};
use super::ports::{HostPlace, YoutrackApi};
use crate::error::AppError;
use crate::secrets::{SecretName, Secrets};

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

async fn read(
    api: &impl YoutrackApi,
    place: &impl HostPlace,
    secrets: &Secrets,
    path: &str,
    query: &[(&str, &str)],
) -> Result<String, AppError> {
    let host = place
        .load()
        .ok_or(AppError::not_found("youtrack_not_connected"))?;
    let token = secrets
        .get(SecretName::YoutrackToken)
        .ok_or(AppError::not_found("youtrack_token_missing"))?;

    Ok(api.get(&host, &token, path, query).await?)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::youtrack::domain::ApiError;
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
}
