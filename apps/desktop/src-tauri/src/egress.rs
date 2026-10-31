//! Сеть только туда, куда её направил человек: к провайдеру модели и к
//! своему YouTrack. Каждый клиент Rust сверяет адрес запроса со своим
//! источником здесь, до отправки. Адрес вне списка не уходит, а отказ
//! пишется в лог приложения.

use reqwest::redirect::Policy;
use url::Url;

/// Перенаправления клиенты не выполняют: иначе запрос с ключом ушёл бы
/// туда, куда укажет сервер, мимо проверки адреса. Заголовок `x-api-key`
/// reqwest при перенаправлении на чужой хост не снимает. Ответ с
/// перенаправлением приходит клиенту как есть, а адрес идёт в лог.
pub fn no_redirects() -> Policy {
    Policy::custom(|attempt| {
        log::warn!("перенаправление на {} не выполнено", source(attempt.url()));
        attempt.stop()
    })
}

/// Можно ли отправить запрос: у адреса те же схема, хост и порт, что
/// у разрешённого источника, и нет логина в адресе.
pub fn allowed(url: &Url, origin: &Url) -> bool {
    let same = url.scheme() == origin.scheme()
        && url.host_str() == origin.host_str()
        && url.port_or_known_default() == origin.port_or_known_default()
        && url.username().is_empty()
        && url.password().is_none();

    if !same {
        log::warn!(
            "запрос не отправлен: {} вне разрешённых адресов",
            source(url)
        );
    }

    same
}

// В лог идёт только источник адреса: путь и параметры могут нести текст
// заметки или задачи.
fn source(url: &Url) -> String {
    url.origin().ascii_serialization()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn уходит_только_на_тот_же_источник() {
        let origin = url("https://yt.company.com/youtrack");

        assert!(allowed(
            &url("https://yt.company.com/youtrack/api/issues?query=x"),
            &origin
        ));
        assert!(allowed(&url("https://yt.company.com:443/api"), &origin));

        for other in [
            "https://evil.example/api",
            "http://yt.company.com/api",
            "https://yt.company.com:8443/api",
            "https://yt.company.com.evil.example/api",
            "https://me@yt.company.com/api",
        ] {
            assert!(!allowed(&url(other), &origin), "{other}");
        }
    }
}
