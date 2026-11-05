use crate::domain::{Forge, ForgeCode, ForgeStatus, ForgeStatuses, parse_host};
use crate::ports::{Accounts, Api};
use crate::secrets::{SecretName, Secrets};
use sapien_kernel::AppError;

fn secret(forge: Forge) -> SecretName {
    match forge {
        Forge::Github => SecretName::GithubToken,
        Forge::Gitlab => SecretName::GitlabToken,
    }
}

/// Подключения, как их сохранили: без сети. Без системного хранилища
/// паролей токен не переживает перезапуск, и подключения без токена нет.
pub fn status(accounts: &impl Accounts, secrets: &Secrets) -> Result<ForgeStatuses, AppError> {
    let mut statuses = accounts.load()?;

    for forge in [Forge::Github, Forge::Gitlab] {
        if secrets.get(secret(forge)).is_none() {
            *statuses.of(forge) = ForgeStatus::None;
        }
    }

    Ok(statuses)
}

/// Подключает сервер по токену. Токен сохраняется, только если сервер
/// его принял.
pub async fn connect(
    api: &impl Api,
    accounts: &impl Accounts,
    secrets: &Secrets,
    forge: Forge,
    host: Option<&str>,
    token: &str,
) -> Result<ForgeStatus, AppError> {
    let host = parse_host(forge, host)?;
    let token = token.trim();

    if token.is_empty() {
        return Err(AppError::invalid(ForgeCode::TokenEmpty));
    }

    let login = api.login(forge, &host, token).await?;
    let mut statuses = accounts.load()?;
    let connected = ForgeStatus::Connected { host, login };

    secrets.set(secret(forge), token)?;
    *statuses.of(forge) = connected.clone();
    accounts.save(&statuses)?;

    Ok(connected)
}

/// Стирает токен и запись о подключении.
pub fn disconnect(
    accounts: &impl Accounts,
    secrets: &Secrets,
    forge: Forge,
) -> Result<(), AppError> {
    secrets.delete(secret(forge))?;

    let mut statuses = accounts.load()?;

    *statuses.of(forge) = ForgeStatus::None;
    accounts.save(&statuses)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Поддельный сервер отвечает сразу, сети нет: хватает однопоточного
    /// исполнителя tokio, приложение для теста не нужно.
    fn block_on<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(future)
    }

    /// Сервер, который принимает один токен и помнит, куда его спрашивали.
    struct FakeApi {
        token: &'static str,
        asked: Mutex<Vec<(Forge, String)>>,
    }

    impl FakeApi {
        fn accepting(token: &'static str) -> Self {
            Self {
                token,
                asked: Mutex::default(),
            }
        }
    }

    impl Api for FakeApi {
        async fn login(&self, forge: Forge, host: &str, token: &str) -> Result<String, AppError> {
            self.asked.lock().unwrap().push((forge, host.to_owned()));

            if token != self.token {
                return Err(AppError::invalid(ForgeCode::TokenRejected));
            }

            Ok(match forge {
                Forge::Github => "octocat".into(),
                Forge::Gitlab => "tanuki".into(),
            })
        }
    }

    #[derive(Default)]
    struct FakeAccounts(Mutex<ForgeStatuses>);

    impl Accounts for FakeAccounts {
        fn load(&self) -> Result<ForgeStatuses, AppError> {
            Ok(self.0.lock().unwrap().clone())
        }

        fn save(&self, statuses: &ForgeStatuses) -> Result<(), AppError> {
            *self.0.lock().unwrap() = statuses.clone();
            Ok(())
        }
    }

    fn connected(host: &str, login: &str) -> ForgeStatus {
        ForgeStatus::Connected {
            host: host.into(),
            login: login.into(),
        }
    }

    #[test]
    fn принятый_токен_сохраняется_а_статус_читается_без_сети() {
        let api = FakeApi::accepting("glpat-1");
        let accounts = FakeAccounts::default();
        let secrets = Secrets::in_memory();
        let connect =
            |forge, host, token| block_on(connect(&api, &accounts, &secrets, forge, host, token));

        assert_eq!(
            connect(Forge::Gitlab, Some("git.company.com/"), " glpat-1\n"),
            Ok(connected("git.company.com", "tanuki"))
        );
        assert_eq!(
            secrets.get(SecretName::GitlabToken).as_deref(),
            Some("glpat-1")
        );
        assert_eq!(
            status(&accounts, &secrets),
            Ok(ForgeStatuses {
                github: ForgeStatus::None,
                gitlab: connected("git.company.com", "tanuki"),
            })
        );
        assert_eq!(
            *api.asked.lock().unwrap(),
            [(Forge::Gitlab, "git.company.com".to_owned())]
        );
        // Перезапуск без системного хранилища паролей: токена больше нет.
        assert_eq!(
            status(&accounts, &Secrets::in_memory()),
            Ok(ForgeStatuses::default())
        );

        disconnect(&accounts, &secrets, Forge::Gitlab).unwrap();

        assert_eq!(*accounts.0.lock().unwrap(), ForgeStatuses::default());
        assert_eq!(secrets.get(SecretName::GitlabToken), None);
    }

    #[test]
    fn отклонённый_токен_и_плохой_адрес_ничего_не_сохраняют() {
        let api = FakeApi::accepting("ghp_1");
        let accounts = FakeAccounts::default();
        let secrets = Secrets::in_memory();
        let code = |forge, host, token| {
            block_on(connect(&api, &accounts, &secrets, forge, host, token))
                .map_err(|error| error.code)
        };

        assert_eq!(
            code(Forge::Github, None, "чужой"),
            Err("forge_token_rejected")
        );
        assert_eq!(code(Forge::Github, None, "  "), Err("forge_token_empty"));
        assert_eq!(
            code(Forge::Gitlab, Some("http://git.company.com"), "ghp_1"),
            Err("forge_host_insecure")
        );

        assert_eq!(*accounts.0.lock().unwrap(), ForgeStatuses::default());
        assert_eq!(secrets.get(SecretName::GithubToken), None);
        // До сервера дошла только проверка чужого токена.
        assert_eq!(api.asked.lock().unwrap().len(), 1);

        assert_eq!(
            code(Forge::Github, Some("gitlab.com"), "ghp_1"),
            Ok(connected("github.com", "octocat"))
        );
    }
}
