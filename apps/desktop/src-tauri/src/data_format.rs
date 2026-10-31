//! Номер формата собственных файлов приложения. Хранилище заметок сюда
//! не входит: его формат это markdown Obsidian. Новая версия при запуске
//! переносит файлы от записанного номера к своему по шагам и пишет номер
//! после каждого шага, поэтому оборванный перенос следующий запуск
//! продолжает с того же шага.

use crate::durable;
use std::fs;
use std::io;
use std::path::Path;

/// Шаг переносит файлы папки данных из формата N в N + 1. Прежний файл
/// шаг держит, пока новый не записан целиком (docs/architecture.md,
/// `durable.rs`), и не падает, если файла нет: новая установка проходит
/// все шаги.
type Step = fn(&Path) -> io::Result<()>;

/// Шаги по порядку, первый переносит из формата 1 в 2. Формат этой версии
/// на единицу больше числа шагов.
const STEPS: &[Step] = &[];

const FILE: &str = "data-format";

pub fn migrate(dir: &Path) -> io::Result<()> {
    migrate_by(dir, STEPS)
}

fn migrate_by(dir: &Path, steps: &[Step]) -> io::Result<()> {
    let file = dir.join(FILE);
    // Файла нет у новой установки и у версий до номера формата: это формат 1.
    let written: usize = match fs::read_to_string(&file) {
        Ok(text) => text
            .trim()
            .parse()
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => 1,
        Err(error) => return Err(error),
    };

    // Формат новее своего оставляем как есть: отката на прошлую версию нет.
    for (done, step) in steps.iter().enumerate().skip(written.saturating_sub(1)) {
        step(dir)?;
        fs::create_dir_all(dir)?;
        durable::write(&file, (done + 2).to_string().as_bytes())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Шаг отмечает себя в журнале папки: по нему видно, какие шаги прошли
    // и в каком порядке.
    fn mark(dir: &Path, name: &str) -> io::Result<()> {
        let journal = dir.join("journal");
        let before = fs::read_to_string(&journal).unwrap_or_default();
        fs::write(journal, before + name)
    }

    fn first(dir: &Path) -> io::Result<()> {
        mark(dir, "1")
    }

    fn second(dir: &Path) -> io::Result<()> {
        mark(dir, "2")
    }

    fn broken(_dir: &Path) -> io::Result<()> {
        Err(io::Error::other("диск отказал"))
    }

    fn read(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap_or_default()
    }

    #[test]
    fn файлы_без_номера_проходят_все_шаги_по_порядку() {
        let dir = tempfile::tempdir().unwrap();

        migrate_by(dir.path(), &[first, second]).unwrap();

        assert_eq!(read(dir.path(), "journal"), "12");
        assert_eq!(read(dir.path(), FILE), "3");
    }

    #[test]
    fn пройденные_шаги_не_повторяются() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE), "2").unwrap();

        migrate_by(dir.path(), &[first, second]).unwrap();
        migrate_by(dir.path(), &[first, second]).unwrap();

        assert_eq!(read(dir.path(), "journal"), "2");
        assert_eq!(read(dir.path(), FILE), "3");
    }

    #[test]
    fn оборванный_перенос_продолжается_с_упавшего_шага() {
        let dir = tempfile::tempdir().unwrap();

        assert!(migrate_by(dir.path(), &[first, broken]).is_err());
        assert_eq!(read(dir.path(), FILE), "2");

        migrate_by(dir.path(), &[first, second]).unwrap();

        assert_eq!(read(dir.path(), "journal"), "12");
        assert_eq!(read(dir.path(), FILE), "3");
    }

    #[test]
    fn без_шагов_файлы_не_трогаются() {
        let dir = tempfile::tempdir().unwrap();

        migrate(dir.path()).unwrap();

        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
