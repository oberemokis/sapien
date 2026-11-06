//! Номер формата собственных файлов приложения и шаги переноса между ними.
//! Хранилище заметок сюда не входит: его формат это markdown Obsidian.
//! Как шаги проходятся, решает `sapien_kernel::migrate`.

use sapien_kernel::migrate::{Step, migrate_by};
use std::io;
use std::path::Path;

/// Шаги по порядку, первый переносит из формата 1 в 2. Формат этой версии
/// на единицу больше числа шагов.
const STEPS: &[Step] = &[
    // 1 → 2 переносил чат сессий. Сессий больше нет, а шаг остаётся
    // пустым: номер формата у прошедших его установок уже 2.
    |_| Ok(()),
];

pub fn migrate(dir: &Path) -> io::Result<()> {
    migrate_by(dir, STEPS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sapien_kernel::migrate::FILE;
    use std::fs;

    #[test]
    fn новая_установка_проходит_шаги_на_пустой_папке() {
        let dir = tempfile::tempdir().unwrap();

        migrate(dir.path()).unwrap();

        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        assert_eq!(
            fs::read_to_string(dir.path().join(FILE)).unwrap(),
            (STEPS.len() + 1).to_string()
        );
    }
}
