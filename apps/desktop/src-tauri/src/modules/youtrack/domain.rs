use crate::error::AppError;
use serde::Serialize;
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
}

impl ApiError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unreachable => "youtrack_unreachable",
            Self::NotYoutrack => "youtrack_not_youtrack",
            Self::TokenRejected => "youtrack_token_rejected",
        }
    }
}

impl From<ApiError> for AppError {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::Unreachable => AppError::unavailable(error.code()),
            ApiError::NotYoutrack | ApiError::TokenRejected => AppError::invalid(error.code()),
        }
    }
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
