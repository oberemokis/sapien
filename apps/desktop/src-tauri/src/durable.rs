//! Запись файла целиком, которую не портит ни падение, ни выключенное питание.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

/// Сначала во временный файл рядом и сброс его на диск, потом подмена одним
/// переименованием и сброс папки. Оборвалась запись на середине, кончилось
/// место, выключили питание: на диске остаётся прежний файл целиком
/// или уже новый, но не обрезанный. Точка в начале имени прячет временный
/// файл из дерева хранилища.
pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = path.with_file_name(format!(".{name}.sapien"));
    let written = File::create(&temp)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&temp, path));

    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }

    written?;
    sync_dir(path);

    Ok(())
}

/// Переименование переживает выключение питания, когда сброшена и папка.
/// Ошибку не поднимаем: файл уже на месте, и хуже от неё не станет.
#[cfg(unix)]
fn sync_dir(path: &Path) {
    if let Some(dir) = path.parent() {
        let _ = File::open(dir).and_then(|dir| dir.sync_all());
    }
}

/// Windows не даёт открыть папку как файл, а переименование там и так
/// записывается в журнал файловой системы.
#[cfg(not(unix))]
fn sync_dir(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn файл_заменяется_целиком_без_временного_рядом() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("план.md");
        fs::write(&file, "было").unwrap();

        write(&file, "стало".as_bytes()).unwrap();

        assert_eq!(fs::read_to_string(&file).unwrap(), "стало");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn оборванная_запись_оставляет_прежний_файл() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("план.md");
        fs::write(&file, "было").unwrap();
        // Временный файл не создать: на его месте папка.
        fs::create_dir(dir.path().join(".план.md.sapien")).unwrap();

        assert!(write(&file, "стало".as_bytes()).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "было");
    }
}
