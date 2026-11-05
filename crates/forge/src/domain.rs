use sapien_kernel::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Forge {
    Github,
    Gitlab,
}

/// Подключение к одному серверу, как его видит окно. Токена здесь нет.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ForgeStatus {
    #[default]
    None,
    Connected {
        host: String,
        login: String,
    },
}

/// Подключения ко всем серверам. Так же они лежат и на диске.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeStatuses {
    #[serde(default)]
    pub github: ForgeStatus,
    #[serde(default)]
    pub gitlab: ForgeStatus,
}

impl ForgeStatuses {
    pub fn of(&mut self, forge: Forge) -> &mut ForgeStatus {
        match forge {
            Forge::Github => &mut self.github,
            Forge::Gitlab => &mut self.gitlab,
        }
    }
}

const GITHUB: &str = "github.com";
const GITLAB: &str = "gitlab.com";

/// Адрес сервера без схемы, как его покажет окно. GitHub один. GitLab
/// облачный по умолчанию или свой: схему можно не писать, косую черту
/// в конце обрезаем. Только https: по http токен ушёл бы по сети открытым
/// текстом.
pub fn parse_host(forge: Forge, input: Option<&str>) -> Result<String, AppError> {
    if forge == Forge::Github {
        return Ok(GITHUB.to_owned());
    }

    let input = input.unwrap_or_default().trim();

    if input.trim_end_matches('/').is_empty() {
        return Ok(GITLAB.to_owned());
    }

    let full = if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let url = Url::parse(&full).map_err(|_| AppError::invalid("forge_host_invalid"))?;

    if url.scheme() != "https" {
        return Err(AppError::invalid("forge_host_insecure"));
    }

    let plain = url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none();

    if url.host_str().is_none() || !plain {
        return Err(AppError::invalid("forge_host_invalid"));
    }

    Ok(url.as_str()["https://".len()..]
        .trim_end_matches('/')
        .to_owned())
}

/// Куда идёт проверка токена: источник и адрес запроса владельца токена.
pub fn user_url(forge: Forge, host: &str) -> (String, String) {
    match forge {
        Forge::Github => (
            "https://api.github.com".to_owned(),
            "https://api.github.com/user".to_owned(),
        ),
        Forge::Gitlab => (
            format!("https://{host}"),
            format!("https://{host}/api/v4/user"),
        ),
    }
}

/// Логин владельца токена по ответу сервера. Тело ответа в ошибку
/// не попадает: окну хватает кода. Что-то ответило, но не API (другой
/// сайт, неверный адрес своего GitLab), значит, `forge_host_invalid`.
pub fn login(forge: Forge, status: u16, body: &str) -> Result<String, AppError> {
    match status {
        200..=299 => {}
        401 | 403 => return Err(AppError::invalid("forge_token_rejected")),
        500.. => return Err(AppError::unavailable("forge_unreachable")),
        _ => return Err(AppError::invalid("forge_host_invalid")),
    }

    let field = match forge {
        Forge::Github => "login",
        Forge::Gitlab => "username",
    };

    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|body| body[field].as_str().map(str::to_owned))
        .filter(|login| !login.is_empty())
        .ok_or(AppError::invalid("forge_host_invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn адрес_gitlab_только_https_и_без_лишнего() {
        let gitlab = |input: Option<&str>| parse_host(Forge::Gitlab, input);
        let code = |input: &str| gitlab(Some(input)).map_err(|error| error.code);

        assert_eq!(gitlab(None), Ok("gitlab.com".into()));
        assert_eq!(gitlab(Some("  ")), Ok("gitlab.com".into()));
        assert_eq!(
            gitlab(Some("git.company.com/")),
            Ok("git.company.com".into())
        );
        assert_eq!(
            gitlab(Some("https://Git.Company.com:8443/gitlab//")),
            Ok("git.company.com:8443/gitlab".into())
        );
        assert_eq!(code("http://git.company.com"), Err("forge_host_insecure"));
        assert_eq!(
            code("https://me@git.company.com"),
            Err("forge_host_invalid")
        );
        assert_eq!(
            code("https://git.company.com/?next=x"),
            Err("forge_host_invalid")
        );
        assert_eq!(code("https://"), Err("forge_host_invalid"));
        // У GitHub адрес один, что бы ни прислало окно.
        assert_eq!(
            parse_host(Forge::Github, Some("http://evil.example")),
            Ok("github.com".into())
        );
    }

    #[test]
    fn логин_берётся_из_ответа_а_отказ_по_коду() {
        let code =
            |forge, status, body: &str| login(forge, status, body).map_err(|error| error.code);

        assert_eq!(
            code(Forge::Github, 200, r#"{"login":"octocat","id":1}"#),
            Ok("octocat".into())
        );
        assert_eq!(
            code(Forge::Gitlab, 200, r#"{"username":"tanuki","name":"Т"}"#),
            Ok("tanuki".into())
        );
        assert_eq!(
            code(Forge::Github, 401, r#"{"message":"Bad credentials"}"#),
            Err("forge_token_rejected")
        );
        assert_eq!(code(Forge::Gitlab, 403, ""), Err("forge_token_rejected"));
        assert_eq!(code(Forge::Gitlab, 502, "<html>"), Err("forge_unreachable"));
        assert_eq!(code(Forge::Gitlab, 404, ""), Err("forge_host_invalid"));
        assert_eq!(code(Forge::Gitlab, 302, ""), Err("forge_host_invalid"));
        assert_eq!(
            code(Forge::Gitlab, 200, "<html>"),
            Err("forge_host_invalid")
        );
        // Ответ GitHub пришёл от GitLab: логина в нём нет.
        assert_eq!(
            code(Forge::Gitlab, 200, r#"{"login":"octocat"}"#),
            Err("forge_host_invalid")
        );
    }

    #[test]
    fn проверка_токена_идёт_на_api_своего_сервера() {
        assert_eq!(
            user_url(Forge::Github, "github.com").1,
            "https://api.github.com/user"
        );
        assert_eq!(
            user_url(Forge::Gitlab, "git.company.com/gitlab"),
            (
                "https://git.company.com/gitlab".into(),
                "https://git.company.com/gitlab/api/v4/user".into()
            )
        );
    }
}
