//! Интеграции агентов сообщают приложению разговор панели через
//! Unix-сокет в папке данных. Хук Claude Code, Codex или Cursor зовёт
//! `sapien hook <агент>`, а расширение Pi и плагин OpenCode пишут в сокет
//! сами. Сокет и панель они берут из окружения оболочки панели
//! (`SAPIEN_SOCKET`, `SAPIEN_PANE`), которое наследуют. Слушает сокет
//! открытое приложение.

use super::domain::{Report, hook_report};
use serde_json::Value;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Самое длинное событие хука. С запасом на вставленный в сообщение текст.
const LIMIT: u64 = 1024 * 1024;

/// Сколько хук ждёт приложения: весть уходит сразу, а агент не должен
/// ждать sapien.
const WAIT: Duration = Duration::from_millis(200);

/// Жив ли процесс `pid`.
fn alive(pid: libc::pid_t) -> bool {
    // SAFETY: kill с сигналом 0 только проверяет процесс.
    unsafe {
        libc::kill(pid, 0) == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

/// Слушает сокет этого запуска, `hooks-<pid>.sock` с правами 0600. Сокеты
/// прошлых запусков, чьих процессов уже нет, стираются. Вести по одной,
/// по порядку прихода, уходят в `on_report`.
pub fn listen(
    data: &Path,
    mut on_report: impl FnMut(Report) + Send + 'static,
) -> io::Result<PathBuf> {
    fs::create_dir_all(data)?;

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

            if let Ok(report) = serde_json::from_str::<Report>(&text) {
                on_report(report);
            }
        }
    });

    Ok(path)
}

/// `sapien hook <агент>`: событие хука агента `agent` из `input` уходит
/// в сокет `socket` вестью о разговоре панели `pane`. Ничего не печатает
/// и не отказывает: вывод хука агент показал бы модели, а отказ мешал бы
/// ему работать вне sapien и когда приложение не слушает.
pub fn forward(
    agent: &str,
    input: impl Read,
    socket: Option<OsString>,
    pane: Option<String>,
    thread: Option<String>,
) {
    let (Some(socket), Some(pane)) = (socket, pane) else {
        return;
    };
    let mut text = String::new();

    if input.take(LIMIT).read_to_string(&mut text).is_err() {
        return;
    }

    let Ok(event) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    let dir = std::env::current_dir()
        .ok()
        .map(|dir| dir.to_string_lossy().into_owned());
    let Some(report) = hook_report(agent, &event, &pane, thread.as_deref(), dir) else {
        return;
    };
    let Ok(mut stream) = UnixStream::connect(socket) else {
        return;
    };

    let _ = stream.set_write_timeout(Some(WAIT));
    let _ = stream.write_all(&serde_json::to_vec(&report).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::mpsc;
    use std::time::Instant;

    #[test]
    fn разговор_из_хука_доходит_до_приложения_по_пути_с_пробелом_и_кавычкой() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("a b'c");
        let (seen, reports) = mpsc::channel();

        fs::create_dir(&data).unwrap();
        // Сокет запуска, процесса которого уже нет, и сокет живого.
        fs::write(data.join("hooks-999999.sock"), "").unwrap();
        fs::write(data.join("hooks-1.sock"), "").unwrap();

        let socket = listen(&data, move |report| {
            let _ = seen.send(report);
        })
        .unwrap();

        assert!(!data.join("hooks-999999.sock").exists());
        assert!(data.join("hooks-1.sock").exists());
        assert_eq!(
            fs::metadata(&socket).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let event = json!({ "session_id": "4f1c", "source": "startup", "cwd": "/tmp/про ект" });

        forward(
            "claude",
            event.to_string().as_bytes(),
            Some(socket.clone().into()),
            Some("панель".into()),
            None,
        );
        let report = reports.recv_timeout(Duration::from_secs(2)).unwrap();

        assert_eq!(report.pane, "панель");
        assert_eq!(report.conversation.id, "4f1c");
        assert_eq!(report.conversation.cwd.as_deref(), Some("/tmp/про ект"));
        assert_eq!(report.source, "startup");

        // Расширение Pi пишет в сокет само, тем же форматом.
        let mut pi = UnixStream::connect(&socket).unwrap();
        pi.write_all(br#"{"pane":"p","agent":"pi","id":"/s/1.jsonl","source":"new"}"#)
            .unwrap();
        drop(pi);
        assert_eq!(
            reports
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .conversation
                .id,
            "/s/1.jsonl"
        );

        // Без панели или с мусором вместо события ничего не уходит.
        forward(
            "claude",
            event.to_string().as_bytes(),
            Some(socket.clone().into()),
            None,
            None,
        );
        forward(
            "claude",
            "не json".as_bytes(),
            Some(socket.into()),
            Some("панель".into()),
            None,
        );
        assert!(reports.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[test]
    fn хук_не_мешает_агенту_когда_приложение_не_слушает() {
        let dir = tempfile::tempdir().unwrap();
        let started = Instant::now();

        forward(
            "claude",
            &br#"{"session_id":"4f1c"}"#[..],
            Some(dir.path().join("hooks-1.sock").into()),
            Some("панель".into()),
            None,
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
