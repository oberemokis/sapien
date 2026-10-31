//! Сервер MCP с инструментами sapien для Claude Code. Claude Code запускает
//! приложение командой `sapien mcp <сокет>`, и оно только перекачивает
//! stdio в сокет открытого приложения (`bridge`). Сам протокол разбирает
//! открытое приложение (`request`): вызов идёт в ход, которым владеет Rust.

use crate::modules::agent::domain::mcp_tools;
use serde_json::{Value, json};

/// Что делать со строкой JSON-RPC от Claude Code.
#[derive(Debug, PartialEq)]
pub enum Request {
    /// Вызов инструмента: на него отвечает ход.
    Call {
        id: Value,
        name: String,
        input: Value,
    },
    /// Ответ готов сразу.
    Reply(Value),
    /// Уведомление или чужой ответ: отвечать нечего.
    Ignore,
}

/// Разбирает строку от Claude Code. Протокол здесь только инструменты:
/// рукопожатие, список, вызов и `ping`.
pub fn request(line: &str) -> Request {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return Request::Ignore;
    };
    let (Some(id), Some(method)) = (message.get("id").cloned(), message["method"].as_str()) else {
        return Request::Ignore;
    };
    let params = &message["params"];
    let result = match method {
        // Версию протокола берём у Claude Code: из неё sapien использует
        // только инструменты, а они одинаковы во всех версиях.
        "initialize" => json!({
            "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "sapien", "version": "1" },
        }),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": mcp_tools() }),
        "tools/call" => {
            return Request::Call {
                id,
                name: params["name"].as_str().unwrap_or_default().to_owned(),
                input: params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            };
        }
        _ => {
            return Request::Reply(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "Method not found" },
            }));
        }
    };

    Request::Reply(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// Ответ на вызов инструмента: ошибка уходит Claude текстом, как на ключе API.
pub fn call_result(id: Value, result: Result<String, String>) -> Value {
    let error = result.is_err();
    let text = result.unwrap_or_else(|error| error);

    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": text }],
            "isError": error,
        },
    })
}

/// Перекачивает `input` в сокет открытого приложения, а его ответы
/// в `output`, пока приложение не закроет сокет.
#[cfg(unix)]
pub fn bridge(
    socket: &std::path::Path,
    mut input: impl std::io::Read + Send + 'static,
    mut output: impl std::io::Write,
) -> std::io::Result<()> {
    use std::net::Shutdown;
    use std::os::unix::net::UnixStream;

    let stream = UnixStream::connect(socket)?;
    let mut upstream = stream.try_clone()?;

    // Поток ввода кончится вместе с процессом: Claude Code закрывает
    // ввод, когда ответ кончился, а приложение закрывает сокет.
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut input, &mut upstream);
        let _ = upstream.shutdown(Shutdown::Write);
    });

    std::io::copy(&mut &stream, &mut output)?;
    output.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn сервер_знает_рукопожатие_список_и_вызов() {
        let initialize = r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{}}}"#;

        let Request::Reply(reply) = request(initialize) else {
            panic!("рукопожатие без ответа");
        };
        assert_eq!(reply["id"], 0);
        assert_eq!(reply["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(reply["result"]["capabilities"], json!({ "tools": {} }));

        let Request::Reply(list) = request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#)
        else {
            panic!("список без ответа");
        };
        let tools = list["result"]["tools"].as_array().unwrap();
        let read = tools
            .iter()
            .find(|tool| tool["name"] == "read_note")
            .unwrap();

        assert!(tools.iter().any(|tool| tool["name"] == "ask_user"));
        assert_eq!(read["inputSchema"]["required"], json!(["path"]));
        assert!(read["_meta"]["anthropic/maxResultSizeChars"].as_u64() > Some(50_000));

        assert_eq!(
            request(
                r#"{"jsonrpc":"2.0","id":"7","method":"tools/call","params":{"name":"read_note","arguments":{"path":"план.md"}}}"#
            ),
            Request::Call {
                id: json!("7"),
                name: "read_note".into(),
                input: json!({ "path": "план.md" }),
            }
        );

        assert_eq!(
            request(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),
            Request::Ignore
        );
        assert_eq!(request("не json"), Request::Ignore);

        let Request::Reply(unknown) =
            request(r#"{"jsonrpc":"2.0","id":2,"method":"resources/list"}"#)
        else {
            panic!("неизвестный метод без ответа");
        };
        assert_eq!(unknown["error"]["code"], -32601);

        assert_eq!(
            call_result(json!(3), Err("Ошибка: note_closed".into()))["result"],
            json!({ "content": [{ "type": "text", "text": "Ошибка: note_closed" }], "isError": true })
        );
    }

    #[cfg(unix)]
    #[test]
    fn мост_перекачивает_ввод_в_сокет_а_ответ_в_вывод() {
        use std::io::{BufRead, BufReader, Cursor, Write};
        use std::os::unix::net::UnixListener;

        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("mcp.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let app = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut lines = BufReader::new(stream.try_clone().unwrap()).lines();
            let asked = lines.next().unwrap().unwrap();

            (&stream).write_all(b"{\"id\":1}\n").unwrap();
            asked
        });
        let mut output = vec![];

        bridge(
            &socket,
            Cursor::new(b"{\"id\":1,\"method\":\"ping\"}\n".to_vec()),
            &mut output,
        )
        .unwrap();

        assert_eq!(app.join().unwrap(), "{\"id\":1,\"method\":\"ping\"}");
        assert_eq!(output, b"{\"id\":1}\n");
    }
}
