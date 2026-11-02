//! Хуки Claude Code доходят до приложения через Unix-сокет в папке данных.
//! Claude Code терминала зовёт `sapien hook`, подкоманда берёт сокет
//! из `SAPIEN_HOOKS` и метку терминала из `SAPIEN_TERMINAL` (окружение
//! процесса хук наследует) и пересылает событие из stdin. Слушает сокет
//! открытое приложение.

use serde_json::{Value, json};
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Самое длинное событие хука. С запасом на вставленный в сообщение текст.
const LIMIT: u64 = 1024 * 1024;

/// Сколько хук ждёт приложения: событие уходит сразу, а Claude Code
/// не должен ждать sapien.
const WAIT: Duration = Duration::from_millis(200);

/// Жив ли процесс `pid`.
fn alive(pid: libc::pid_t) -> bool {
    // SAFETY: kill с сигналом 0 только проверяет процесс.
    unsafe {
        libc::kill(pid, 0) == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

/// Слушает сокет хуков этого запуска, `hooks-<pid>.sock` с правами 0600.
/// Сокеты прошлых запусков, чьих процессов уже нет, стираются. События
/// по одному, по порядку прихода, уходят в `on_event` с меткой терминала.
pub fn listen(
    data: &Path,
    mut on_event: impl FnMut(String, Value) + Send + 'static,
) -> io::Result<PathBuf> {
    for entry in fs::read_dir(data)?.flatten() {
        let name = entry.file_name();
        let pid = name
            .to_str()
            .and_then(|name| name.strip_prefix("hooks-")?.strip_suffix(".sock"))
            .and_then(|pid| pid.parse().ok());

        if pid.is_some_and(|pid| !alive(pid)) {
            let _ = fs::remove_file(entry.path());
        }
    }

    let path = data.join(format!("hooks-{}.sock", std::process::id()));
    let _ = fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;

    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut text = String::new();

            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));

            if stream.take(LIMIT).read_to_string(&mut text).is_err() {
                continue;
            }

            let Ok(message) = serde_json::from_str::<Value>(&text) else {
                continue;
            };

            if let Some(terminal) = message["terminal"].as_str() {
                on_event(terminal.to_owned(), message["event"].clone());
            }
        }
    });

    Ok(path)
}

/// `sapien hook`: событие хука из `input` уходит в сокет `socket` с меткой
/// терминала `terminal`. Ничего не печатает и не отказывает: вывод хука
/// Claude Code показал бы модели, а отказ мешал бы ему работать, когда
/// приложение не слушает.
pub fn forward(input: impl Read, socket: Option<OsString>, terminal: Option<String>) {
    let (Some(socket), Some(terminal)) = (socket, terminal) else {
        return;
    };
    let mut text = String::new();

    if input.take(LIMIT).read_to_string(&mut text).is_err() {
        return;
    }

    let Ok(event) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    let Ok(mut stream) = UnixStream::connect(socket) else {
        return;
    };

    let _ = stream.set_write_timeout(Some(WAIT));
    let _ = stream.write_all(
        json!({ "terminal": terminal, "event": event })
            .to_string()
            .as_bytes(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::agent::domain::quoted;
    use std::sync::mpsc;
    use std::time::Instant;

    #[test]
    fn событие_хука_доходит_до_приложения_по_пути_с_пробелом_и_кавычкой() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("a b'c");
        let (seen, events) = mpsc::channel();

        fs::create_dir(&data).unwrap();
        // Сокет запуска, процесса которого уже нет, и сокет живого.
        fs::write(data.join("hooks-999999.sock"), "").unwrap();
        fs::write(data.join("hooks-1.sock"), "").unwrap();

        let socket = listen(&data, move |terminal, event| {
            let _ = seen.send((terminal, event));
        })
        .unwrap();

        assert!(!data.join("hooks-999999.sock").exists());
        assert!(data.join("hooks-1.sock").exists());
        assert_eq!(
            fs::metadata(&socket).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let event = json!({ "hook_event_name": "UserPromptSubmit", "prompt": "Почини" });

        forward(
            event.to_string().as_bytes(),
            Some(socket.clone().into()),
            Some("метка".into()),
        );
        assert_eq!(
            events.recv_timeout(Duration::from_secs(2)),
            Ok(("метка".into(), event))
        );

        // Без метки или с мусором вместо события ничего не уходит.
        forward(&b"{}"[..], Some(socket.clone().into()), None);
        forward(
            "не json".as_bytes(),
            Some(socket.into()),
            Some("метка".into()),
        );
        assert!(events.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[test]
    fn хук_не_мешает_claude_code_когда_приложение_не_слушает() {
        let dir = tempfile::tempdir().unwrap();
        let started = Instant::now();

        forward(
            &b"{}"[..],
            Some(dir.path().join("hooks-1.sock").into()),
            Some("метка".into()),
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn оболочка_находит_приложение_по_пути_с_пробелом_и_кавычкой() {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("O'Brien sapien");

        fs::write(&program, "#!/bin/sh\necho \"$1\" > \"$0.called\"\n").unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();

        let command = format!("{} hook", quoted(&program.to_string_lossy()));
        let status = std::process::Command::new("sh")
            .args(["-c", &command])
            .status()
            .unwrap();

        assert!(status.success());
        assert_eq!(
            fs::read_to_string(dir.path().join("O'Brien sapien.called")).unwrap(),
            "hook\n"
        );
    }
}
