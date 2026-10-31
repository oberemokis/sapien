use crate::modules::agent::domain::ModelError;
use crate::modules::agent::ports::Model;
use reqwest::Client;
use reqwest::header::CONTENT_TYPE;
use serde_json::Value;
use std::time::Duration;

const MESSAGES: &str = "https://api.anthropic.com/v1/messages";
const VERSION: &str = "2026-10-21";
/// Запасная модель на стороне Anthropic, `fallbacks: "default"` в запросе.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// Клиент Messages API. Ключ подставляется в заголовок здесь и больше
/// никуда не уходит. Общего срока на запрос нет: ответ с размышлениями
/// идёт минутами. Зато поток, который молчит дольше двух минут, считается
/// оборванным: сервер шлёт пинг куда чаще.
pub struct Anthropic {
    client: Client,
    url: String,
}

impl Default for Anthropic {
    fn default() -> Self {
        Self::at(MESSAGES)
    }
}

impl Anthropic {
    fn at(url: &str) -> Self {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_default();

        Self {
            client,
            url: url.to_owned(),
        }
    }
}

impl Model for Anthropic {
    async fn stream(
        &self,
        key: &str,
        body: &Value,
        on_event: &mut (impl FnMut(Value) + Send),
    ) -> Result<(), ModelError> {
        let mut request = self
            .client
            .post(&self.url)
            .header("x-api-key", key)
            .header("anthropic-version", VERSION)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string());

        if body.get("fallbacks").is_some() {
            request = request.header("anthropic-beta", FALLBACK_BETA);
        }

        let mut response = request.send().await.map_err(|_| ModelError::Unreachable)?;
        let status = response.status();

        if !status.is_success() {
            let failure: Value = response.json().await.unwrap_or_default();

            return Err(failure["error"]["type"].as_str().map_or(
                ModelError::from_status(status.as_u16()),
                ModelError::from_type,
            ));
        }

        // Строка `data:` события это целый JSON. Кусок сети рвёт строку
        // где угодно, даже посреди буквы, поэтому строка разбирается, только
        // когда пришла целиком.
        let mut pending: Vec<u8> = vec![];

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| ModelError::Unreachable)?
        {
            pending.extend_from_slice(&chunk);

            while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
                let line: Vec<u8> = pending.drain(..=end).collect();
                let line = String::from_utf8_lossy(&line);

                if let Some(data) = line.trim_end().strip_prefix("data:")
                    && let Ok(event) = serde_json::from_str(data.trim_start())
                {
                    on_event(event);
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;
    use tauri::async_runtime::block_on;

    /// Сервер на один запрос: отдаёт ответ кусками, которые рвут строки
    /// посреди слова, и сообщает, какой запрос пришёл.
    fn serve(status: &str, body: &str) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/messages", listener.local_addr().unwrap());
        let head = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let body = body.as_bytes().to_vec();
        let (sender, requests) = mpsc::channel();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 65536];
            let read = stream.read(&mut buffer).unwrap();
            let _ = sender.send(String::from_utf8_lossy(&buffer[..read]).into_owned());

            stream.write_all(head.as_bytes()).unwrap();

            for piece in body.chunks(7) {
                stream.write_all(piece).unwrap();
                stream.flush().unwrap();
            }
        });

        (url, requests)
    }

    fn stream(url: &str, body: &Value) -> (Result<(), ModelError>, Vec<Value>) {
        let mut events = vec![];
        let result = block_on(
            Anthropic::at(url).stream("sk-ant-ключ", body, &mut |event| {
                events.push(event);
            }),
        );

        (result, events)
    }

    #[test]
    fn события_потока_приходят_целыми_с_ключом_в_заголовке() {
        let sse = "event: message_start\ndata: {\"type\":\"message_start\"}\n\n\
                   event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Привет, мир\"}}\n\n\
                   event: ping\ndata: {\"type\":\"ping\"}\n\n";
        let (url, requests) = serve("200 OK", sse);

        let (result, events) = stream(
            &url,
            &json!({ "model": "claude-sonnet-5-5", "fallbacks": "default" }),
        );

        assert_eq!(result, Ok(()));
        assert_eq!(events.len(), 3);
        assert_eq!(events[1]["delta"]["text"], "Привет, мир");

        let request = requests.recv().unwrap().to_lowercase();
        assert!(request.starts_with("post /v1/messages "));
        assert!(request.contains("x-api-key: sk-ant-ключ"));
        assert!(request.contains("anthropic-version: 2026-10-21"));
        assert!(request.contains("anthropic-beta: server-side-fallback-2026-07-01"));
    }

    #[test]
    fn отказ_разобран_по_типу_ошибки_или_коду() {
        let rejected = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        let (url, requests) = serve("401 Unauthorized", rejected);

        assert_eq!(stream(&url, &json!({})).0, Err(ModelError::KeyRejected));
        assert!(
            !requests
                .recv()
                .unwrap()
                .to_lowercase()
                .contains("anthropic-beta")
        );

        let (url, _) = serve("529 Overloaded", "");
        assert_eq!(stream(&url, &json!({})).0, Err(ModelError::Overloaded));
    }

    #[test]
    fn молчащий_адрес_это_нет_сети() {
        let free = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();

        assert_eq!(
            stream(&format!("http://{free}/v1/messages"), &json!({})).0,
            Err(ModelError::Unreachable)
        );
    }
}
