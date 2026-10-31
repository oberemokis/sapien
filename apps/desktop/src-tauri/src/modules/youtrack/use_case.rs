use super::domain::{YoutrackStatus, parse_host};
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
