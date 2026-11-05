//! Сеть только туда, куда её направил человек: к API GitHub и к своему
//! GitLab. Каждый клиент Rust сверяет адрес запроса со своим источником
//! здесь, до отправки. Адрес вне списка не уходит, а отказ пишется в лог
//! приложения. Обновление приложения ходит на GitHub клиентом плагина
//! updater (updates.rs приложения), без токенов и данных человека. Claude Code ходит
//! в сеть сам, своим процессом.

use reqwest::redirect::Policy;
use url::Url;

/// Перенаправления клиенты не выполняют: иначе запрос с токеном ушёл бы
/// туда, куда укажет сервер, мимо проверки адреса. Заголовок `PRIVATE-TOKEN`
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

// В лог идёт только источник адреса: путь и параметры могут нести
// данные человека.
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
        let origin = url("https://git.company.com/gitlab");

        assert!(allowed(
            &url("https://git.company.com/gitlab/api/v4/user?x=1"),
            &origin
        ));
        assert!(allowed(&url("https://git.company.com:443/api"), &origin));

        for other in [
            "https://evil.example/api",
            "http://git.company.com/api",
            "https://git.company.com:8443/api",
            "https://git.company.com.evil.example/api",
            "https://me@git.company.com/api",
        ] {
            assert!(!allowed(&url(other), &origin), "{other}");
        }
    }
}
