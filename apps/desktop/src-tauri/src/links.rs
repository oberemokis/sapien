//! Куда ведут ссылки. Окно приложения показывает только свой интерфейс:
//! чужая страница в нём получила бы доступ к командам Rust, поэтому чужой
//! адрес уходит в браузер системы, а окно остаётся на месте.

use crate::error::AppError;
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{App, AppHandle, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

/// Адрес, который можно отдать браузеру системы: веб и почта. `javascript:`,
/// `file:`, `data:` и схемы других приложений сюда не проходят.
fn web_link(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// Свой интерфейс: собранный в приложение и, пока идёт разработка,
/// сервер Vite на localhost.
fn own_page(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(debug_assertions) && url.host_str() == Some("localhost"))
        }
        _ => false,
    }
}

fn open_outside<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if web_link(url) {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// Главное окно из tauri.conf.json с охраной: со своего интерфейса оно
/// никуда не уходит и новых окон не открывает. Охрана новых окон есть только
/// у построителя окна, поэтому окно строится здесь, а не по конфигу.
pub fn main_window<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let Some(config) = app.config().app.windows.first().cloned() else {
        return Ok(());
    };
    let navigating = app.handle().clone();
    let opening = app.handle().clone();

    WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| {
            if own_page(url) {
                return true;
            }

            open_outside(&navigating, url);
            false
        })
        .on_new_window(move |url, _| {
            open_outside(&opening, &url);
            NewWindowResponse::Deny
        })
        .build()?;

    Ok(())
}

/// Ссылка из текста заметки. Годится ли адрес, решает Rust, а не окно.
#[tauri::command]
pub fn open_link(app: AppHandle, url: String) -> Result<(), AppError> {
    let url = Url::parse(&url)
        .ok()
        .filter(web_link)
        .ok_or(AppError::invalid("link_invalid"))?;

    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| AppError::unavailable("link_unopened"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn в_браузер_уходят_только_веб_и_почта() {
        assert!(web_link(&url("https://tauri.app/#start")));
        assert!(web_link(&url("http://localhost:8080")));
        assert!(web_link(&url("mailto:me@example.com")));
        assert!(!web_link(&url("javascript:alert(1)")));
        assert!(!web_link(&url("file:///Users/me/.ssh/id_rsa")));
        assert!(!web_link(&url("data:text/html,<script>alert(1)</script>")));
        assert!(!web_link(&url("sapien://open?path=план.md")));
    }

    #[test]
    fn окно_остаётся_только_на_своём_интерфейсе() {
        assert!(own_page(&url("tauri://localhost/index.html")));
        assert!(own_page(&url("http://tauri.localhost/")));
        assert!(!own_page(&url("https://evil.example/tauri.localhost")));
        assert!(!own_page(&url("https://tauri.localhost.evil.example/")));
        assert!(!own_page(&url("file:///etc/passwd")));
    }
}
