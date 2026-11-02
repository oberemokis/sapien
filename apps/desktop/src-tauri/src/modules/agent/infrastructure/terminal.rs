use crate::error::AppError;
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Что запустить в псевдотерминале. Окружение только то, что передано.
pub struct Command<'a> {
    pub program: &'a Path,
    pub args: &'a [String],
    pub env: Vec<(OsString, OsString)>,
    pub dir: &'a Path,
    pub cols: u16,
    pub rows: u16,
}

/// Процесс в псевдотерминале. Вывод читает свой поток и отдаёт целиком,
/// куда бы он ни шёл: непрочитанный псевдотерминал остановил бы процесс
/// на записи.
pub struct Pty {
    pid: Option<u32>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
}

impl Pty {
    /// Запускает процесс лидером своей группы. Вывод идёт в `output`
    /// кусками, `exited` зовётся, когда процесс кончился.
    pub fn spawn(
        command: Command<'_>,
        mut output: impl FnMut(&[u8]) + Send + 'static,
        exited: impl FnOnce() + Send + 'static,
    ) -> Result<Self, AppError> {
        let failed = |_| AppError::unavailable("terminal_failed");
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: command.rows,
                cols: command.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(failed)?;
        let mut builder = CommandBuilder::new(command.program);

        builder.env_clear();
        builder.args(command.args);
        builder.cwd(command.dir);

        for (name, value) in command.env {
            builder.env(name, value);
        }

        let mut child = pair.slave.spawn_command(builder).map_err(failed)?;
        // Свой конец псевдотерминала держит только процесс: с его концом
        // чтение получает конец вывода.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(failed)?;
        let writer = pair.master.take_writer().map_err(failed)?;
        let pid = child.process_id();

        std::thread::spawn(move || {
            let mut buffer = [0; 64 * 1024];

            while let Ok(read @ 1..) = reader.read(&mut buffer) {
                output(&buffer[..read]);
            }
        });
        std::thread::spawn(move || {
            let _ = child.wait();
            exited();
        });

        Ok(Self {
            pid,
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
        })
    }

    /// Ввод с клавиатуры окна.
    pub fn write(&self, bytes: &[u8]) -> Result<(), AppError> {
        let mut writer = lock(&self.writer);

        writer
            .write_all(bytes)
            .and_then(|()| writer.flush())
            .map_err(|_| AppError::unavailable("terminal_failed"))
    }

    /// Новый размер: процесс получает SIGWINCH и перерисовывается.
    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = lock(&self.master).resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }

    /// SIGTERM всей группе процесса: вместе с Claude Code уходят и его
    /// команды. Процесс, который уже кончился, сигнал не трогает.
    pub fn stop(&self) {
        // ponytail: без SIGKILL следом. Claude Code выходит по SIGTERM,
        // добивать его стоит, если найдётся процесс, который не выходит.
        #[cfg(unix)]
        if let Some(pid) = self.pid.and_then(|pid| libc::pid_t::try_from(pid).ok()) {
            // SAFETY: killpg только шлёт сигнал и не трогает память.
            unsafe {
                libc::killpg(pid, libc::SIGTERM);
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Arc;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    /// Ждёт, пока `done` не станет правдой, не дольше двух секунд.
    fn until(mut done: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);

        while Instant::now() < deadline {
            if done() {
                return true;
            }

            std::thread::sleep(Duration::from_millis(10));
        }

        false
    }

    /// Поддельный Claude Code: пишет, с чем его позвали и в каком
    /// окружении, отвечает эхом на строку ввода и печатает размер
    /// терминала после SIGWINCH. Ждёт, пока его не остановят.
    const FAKE: &str = r#"#!/bin/sh
here=$(dirname "$0")
printf '%s\n' "$@" > "$here/args"
env > "$here/env"
pwd -P > "$here/pwd"
trap 'echo "размер $(stty size)"' WINCH
sleep 30 &
echo "дочерний $!"
echo "готов $(stty size)"
# SIGWINCH прерывает read, поэтому строка читается в цикле.
while true; do
  if read -r line; then echo "эхо $line"; fi
done
"#;

    struct Spawned {
        pty: Pty,
        seen: Arc<Mutex<String>>,
        exited: mpsc::Receiver<()>,
        dir: tempfile::TempDir,
    }

    fn spawn() -> Spawned {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("claude");
        let project = dir.path().join("про ект");
        let seen = Arc::new(Mutex::new(String::new()));
        let into = seen.clone();
        let (done, exited) = mpsc::channel();

        fs::write(&program, FAKE).unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
        fs::create_dir(&project).unwrap();

        let pty = Pty::spawn(
            Command {
                program: &program,
                args: &[
                    "--resume".into(),
                    "4f1c".into(),
                    "--".into(),
                    "-x \"y\"".into(),
                ],
                env: vec![
                    ("PATH".into(), "/usr/bin:/bin".into()),
                    ("SAPIEN_TERMINAL".into(), "метка".into()),
                ],
                dir: &project,
                cols: 100,
                rows: 30,
            },
            move |bytes| lock(&into).push_str(&String::from_utf8_lossy(bytes)),
            move || {
                let _ = done.send(());
            },
        )
        .unwrap();

        Spawned {
            pty,
            seen,
            exited,
            dir,
        }
    }

    fn running(pid: &str) -> bool {
        std::process::Command::new("kill")
            .args(["-0", pid])
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    #[test]
    fn процесс_идёт_в_папке_проекта_с_вводом_выводом_и_размером_окна() {
        let Spawned {
            pty,
            seen,
            exited,
            dir,
        } = spawn();
        let saw = |text: &str| until(|| lock(&seen).contains(text));

        assert!(saw("готов 30 100"));
        assert_eq!(
            fs::read_to_string(dir.path().join("args")).unwrap(),
            "--resume\n4f1c\n--\n-x \"y\"\n"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("pwd")).unwrap().trim(),
            dir.path()
                .join("про ект")
                .canonicalize()
                .unwrap()
                .to_string_lossy()
        );

        let env = fs::read_to_string(dir.path().join("env")).unwrap();

        assert!(env.contains("SAPIEN_TERMINAL=метка"));
        // Окружение приложения до процесса не доходит.
        assert!(!env.contains("CARGO"));

        pty.resize(80, 24);
        assert!(saw("размер 24 80"));

        pty.write("привет\r".as_bytes()).unwrap();
        assert!(saw("эхо привет"));
        assert!(saw("дочерний "));

        let child = lock(&seen)
            .split("дочерний ")
            .nth(1)
            .and_then(|rest| rest.split_whitespace().next())
            .unwrap()
            .to_owned();

        assert!(running(&child));

        // Остановка снимает и процесс, и его команды.
        pty.stop();
        assert!(exited.recv_timeout(Duration::from_secs(2)).is_ok());
        assert!(until(|| !running(&child)));
    }
}
