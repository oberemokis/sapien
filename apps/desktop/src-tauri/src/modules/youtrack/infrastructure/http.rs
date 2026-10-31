use crate::egress;
use crate::modules::youtrack::domain::ApiError;
use crate::modules::youtrack::ports::YoutrackApi;
use reqwest::header::ACCEPT;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use std::time::Duration;
use url::Url;

/// Клиент REST API YouTrack. Сертификату сервера он верит по корням
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

#[derive(Deserialize)]
struct Me {
    login: String,
    #[serde(rename = "fullName", default)]
    full_name: String,
}

impl YoutrackApi for Http {
    async fn me(&self, host: &str, token: &str) -> Result<String, ApiError> {
        let body = self
            .get(
                host,
                token,
                "/api/users/me",
                &[("fields", "login,fullName")],
            )
            .await?;
        let me: Me = serde_json::from_str(&body).map_err(|_| ApiError::NotYoutrack)?;

        if me.full_name.trim().is_empty() {
            return Ok(me.login);
        }

        Ok(me.full_name)
    }

    async fn get(
        &self,
        host: &str,
        token: &str,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<String, ApiError> {
        let origin = Url::parse(host).map_err(|_| ApiError::NotYoutrack)?;
        let mut url = Url::parse(&format!("{host}{path}")).map_err(|_| ApiError::NotYoutrack)?;

        url.query_pairs_mut().extend_pairs(query);

        // Путь с «//» или «@» увёл бы запрос с токеном на другой хост.
        if !egress::allowed(&url, &origin) {
            return Err(ApiError::NotYoutrack);
        }

        let response = self
            .0
            .get(url)
            .bearer_auth(token)
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| ApiError::Unreachable)?;
        let status = response.status();

        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(ApiError::TokenRejected);
        }

        if status.is_server_error() {
            return Err(ApiError::Unreachable);
        }

        // Другой сайт, неверный путь или вход через страницу: это не API.
        if !status.is_success() {
            return Err(ApiError::NotYoutrack);
        }

        let body = response.text().await.map_err(|_| ApiError::Unreachable)?;

        serde_json::from_str::<serde_json::Value>(&body).map_err(|_| ApiError::NotYoutrack)?;

        Ok(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;
    use tauri::async_runtime::block_on;

    /// Сервер на один запрос: отдаёт заготовленный ответ и сообщает,
    /// какой запрос пришёл.
    fn serve(status: &str, content_type: &str, body: &str) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let host = format!("http://{}/youtrack", listener.local_addr().unwrap());
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let (sender, requests) = mpsc::channel();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 8192];
            let read = stream.read(&mut buffer).unwrap();

            // Тесту, которому запрос не нужен, приёмник уже не слушает.
            let _ = sender.send(String::from_utf8_lossy(&buffer[..read]).into_owned());
            stream.write_all(response.as_bytes()).unwrap();
        });

        (host, requests)
    }

    fn me(host: &str) -> Result<String, ApiError> {
        block_on(Http::default().me(host, "perm:токен"))
    }

    #[test]
    fn владелец_токена_по_полному_имени_или_логину() {
        let (host, requests) = serve(
            "200 OK",
            "application/json",
            r#"{"login":"ilya","fullName":"Илья Оберемок","$type":"Me"}"#,
        );

        assert_eq!(me(&host).as_deref(), Ok("Илья Оберемок"));

        let request = requests.recv().unwrap();
        assert!(request.starts_with("GET /youtrack/api/users/me?fields=login%2CfullName "));
        assert!(
            request
                .to_lowercase()
                .contains("authorization: bearer perm:токен")
        );

        let (host, _) = serve("200 OK", "application/json", r#"{"login":"ilya"}"#);
        assert_eq!(me(&host).as_deref(), Ok("ilya"));
    }

    #[test]
    fn параметры_запроса_кодируются_а_ответ_идёт_как_есть() {
        let (host, requests) = serve("200 OK", "application/json", r#"[{"idReadable":"SAP-1"}]"#);

        let body = block_on(Http::default().get(
            &host,
            "perm:токен",
            "/api/issues",
            &[("query", "for: me #Unresolved"), ("$top", "20")],
        ));

        assert_eq!(body.as_deref(), Ok(r#"[{"idReadable":"SAP-1"}]"#));
        assert!(
            requests
                .recv()
                .unwrap()
                .starts_with("GET /youtrack/api/issues?query=for%3A+me+%23Unresolved&%24top=20 ")
        );
    }

    #[test]
    fn отказ_сервера_разобран_по_причинам() {
        let cases = [
            (
                "401 Unauthorized",
                "application/json",
                "{}",
                ApiError::TokenRejected,
            ),
            (
                "403 Forbidden",
                "application/json",
                "{}",
                ApiError::TokenRejected,
            ),
            (
                "404 Not Found",
                "text/html",
                "<html></html>",
                ApiError::NotYoutrack,
            ),
            ("302 Found", "text/html", "", ApiError::NotYoutrack),
            (
                "200 OK",
                "text/html",
                "<html>login</html>",
                ApiError::NotYoutrack,
            ),
            (
                "503 Service Unavailable",
                "text/plain",
                "",
                ApiError::Unreachable,
            ),
        ];

        for (status, content_type, body, error) in cases {
            let (host, _) = serve(status, content_type, body);

            assert_eq!(me(&host), Err(error), "{status}");
        }
    }

    #[test]
    fn перенаправление_на_чужой_адрес_не_выполняется() {
        let elsewhere = TcpListener::bind("127.0.0.1:0").unwrap();
        let target = format!("http://{}/steal", elsewhere.local_addr().unwrap());
        // Заголовок Location едет в ответе следом за типом содержимого.
        let (host, _) = serve("302 Found", &format!("text/html\r\nLocation: {target}"), "");

        assert_eq!(me(&host), Err(ApiError::NotYoutrack));

        elsewhere.set_nonblocking(true).unwrap();
        assert!(elsewhere.accept().is_err(), "токен ушёл по перенаправлению");
    }

    #[test]
    fn молчащий_адрес_это_недоступный_сервер() {
        let free = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();

        assert_eq!(me(&format!("http://{free}")), Err(ApiError::Unreachable));
    }
}
