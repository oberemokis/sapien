use crate::egress;
use crate::modules::youtrack::domain::ApiError;
use crate::modules::youtrack::ports::YoutrackApi;
use reqwest::header::ACCEPT;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::Value;
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

impl Http {
    /// Запрос к API: без тела GET, с телом POST. Пустой ответ, как у команд
    /// без `fields`, приходит пустой строкой.
    async fn send(
        &self,
        host: &str,
        token: &str,
        path: &str,
        query: &[(&str, &str)],
        body: Option<&Value>,
    ) -> Result<String, ApiError> {
        let origin = Url::parse(host).map_err(|_| ApiError::NotYoutrack)?;
        let mut url = Url::parse(&format!("{host}{path}")).map_err(|_| ApiError::NotYoutrack)?;

        // Пустой список дал бы адрес с голым «?» в конце.
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }

        // Путь с «//» или «@» увёл бы запрос с токеном на другой хост.
        if !egress::allowed(&url, &origin) {
            return Err(ApiError::NotYoutrack);
        }

        let request = match body {
            Some(body) => self.0.post(url).json(body),
            None => self.0.get(url),
        };
        let response = request
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

        if status == StatusCode::BAD_REQUEST {
            return Err(ApiError::Rejected);
        }

        if status == StatusCode::NOT_FOUND {
            return Err(ApiError::Missing);
        }

        // Другой сайт или вход через страницу: это не API.
        if !status.is_success() {
            return Err(ApiError::NotYoutrack);
        }

        let body = response.text().await.map_err(|_| ApiError::Unreachable)?;

        if !body.is_empty() {
            serde_json::from_str::<Value>(&body).map_err(|_| ApiError::NotYoutrack)?;
        }

        Ok(body)
    }
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
            .await
            // Неверный путь или отказ по адресу: API YouTrack там нет.
            .map_err(|error| match error {
                ApiError::Rejected | ApiError::Missing => ApiError::NotYoutrack,
                other => other,
            })?;
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
        self.send(host, token, path, query, None).await
    }

    async fn post(
        &self,
        host: &str,
        token: &str,
        path: &str,
        query: &[(&str, &str)],
        body: &Value,
    ) -> Result<String, ApiError> {
        self.send(host, token, path, query, Some(body)).await
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
    fn запись_уходит_телом_json_а_отказ_и_пропажа_различаются() {
        let post = |host: &str| {
            block_on(Http::default().post(
                host,
                "perm:токен",
                "/api/commands",
                &[],
                &serde_json::json!({ "query": "Priority Major" }),
            ))
        };
        let (host, requests) = serve("200 OK", "application/json", "");

        assert_eq!(post(&host).as_deref(), Ok(""));

        let request = requests.recv().unwrap();
        assert!(request.starts_with("POST /youtrack/api/commands "));
        assert!(
            request
                .to_lowercase()
                .contains("content-type: application/json")
        );

        let (host, _) = serve("400 Bad Request", "application/json", "{}");
        assert_eq!(post(&host), Err(ApiError::Rejected));

        let (host, _) = serve("404 Not Found", "application/json", "{}");
        assert_eq!(post(&host), Err(ApiError::Missing));
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
