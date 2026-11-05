use crate::domain::{Forge, ForgeCode, ForgeStatuses, login, user_url};
use crate::egress;
use crate::ports::{Accounts, Api};
use reqwest::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, HeaderName, HeaderValue, USER_AGENT};
use sapien_kernel::{AppError, durable};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;
use url::Url;

/// Клиент API GitHub и GitLab. Сертификату сервера он верит по корням
/// системы: свой центр сертификации компании ставится в систему, а не
/// исключением в приложение. Перенаправления не идут: запрос с токеном
/// уходит только по адресу, который ввёл человек.
pub struct Http(Client);

impl Default for Http {
    fn default() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(egress::no_redirects())
            .build()
            .unwrap_or_default();

        Self(client)
    }
}

/// Заголовок с токеном. Помечен секретным: в отладочный вывод reqwest
/// он не попадает. Знак, которого не бывает в заголовке, это не токен.
fn secret(value: String) -> Result<HeaderValue, AppError> {
    let mut value =
        HeaderValue::from_str(&value).map_err(|_| AppError::invalid(ForgeCode::TokenRejected))?;

    value.set_sensitive(true);
    Ok(value)
}

impl Api for Http {
    async fn login(&self, forge: Forge, host: &str, token: &str) -> Result<String, AppError> {
        let invalid = |_| AppError::invalid(ForgeCode::HostInvalid);
        let (origin, user) = user_url(forge, host);
        let origin = Url::parse(&origin).map_err(invalid)?;
        let url = Url::parse(&user).map_err(invalid)?;

        // Путь с «//» или «@» увёл бы запрос с токеном на другой хост.
        if !egress::allowed(&url, &origin) {
            return Err(AppError::invalid(ForgeCode::HostInvalid));
        }

        let request = self.0.get(url).header(USER_AGENT, "sapien");
        let request = match forge {
            Forge::Github => request
                .header(AUTHORIZATION, secret(format!("Bearer {token}"))?)
                .header(ACCEPT, "application/vnd.github+json"),
            Forge::Gitlab => request.header(
                HeaderName::from_static("private-token"),
                secret(token.to_owned())?,
            ),
        };
        let response = request
            .send()
            .await
            .map_err(|_| AppError::unavailable(ForgeCode::Unreachable))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .map_err(|_| AppError::unavailable(ForgeCode::Unreachable))?;

        login(forge, status, &body)
    }
}

/// Подключения лежат файлом `forge.json` в папке данных приложения:
/// адрес и логин на сервер. Токенов в файле нет.
pub struct AccountsFile {
    file: PathBuf,
}

impl AccountsFile {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            file: data_dir.join("forge.json"),
        }
    }
}

impl Accounts for AccountsFile {
    fn load(&self) -> Result<ForgeStatuses, AppError> {
        let bytes = match fs::read(&self.file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Ok(ForgeStatuses::default());
            }
            Err(_) => return Err(AppError::unavailable(ForgeCode::Unreadable)),
        };

        serde_json::from_slice(&bytes).map_err(|_| AppError::unavailable(ForgeCode::Unreadable))
    }

    fn save(&self, statuses: &ForgeStatuses) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable(ForgeCode::Unwritable);
        let bytes = serde_json::to_vec(statuses)
            .map_err(|_| AppError::unavailable(ForgeCode::Unwritable))?;

        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(unwritable)?;
        }

        durable::write(&self.file, &bytes).map_err(unwritable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ForgeStatus;

    #[test]
    fn подключения_переживают_перезапуск() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = AccountsFile::new(&dir.path().join("data"));
        let statuses = ForgeStatuses {
            github: ForgeStatus::Connected {
                host: "github.com".into(),
                login: "octocat".into(),
            },
            gitlab: ForgeStatus::None,
        };

        assert_eq!(accounts.load(), Ok(ForgeStatuses::default()));

        accounts.save(&statuses).unwrap();

        assert_eq!(
            AccountsFile::new(&dir.path().join("data")).load(),
            Ok(statuses)
        );
    }

    #[test]
    fn токен_с_переводом_строки_не_уходит() {
        assert_eq!(
            secret("ghp_1\nX-Other: 1".into()),
            Err(AppError::invalid(ForgeCode::TokenRejected))
        );
        assert!(secret("glpat-1".into()).unwrap().is_sensitive());
    }
}
