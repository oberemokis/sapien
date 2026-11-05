//! Номер формата собственных файлов приложения и шаги переноса между ними.
//! Хранилище заметок сюда не входит: его формат это markdown Obsidian.
//! Как шаги проходятся, решает `sapien_kernel::migrate`.

use crate::modules::agent;
use sapien_kernel::migrate::{Step, migrate_by};
use std::io;
use std::path::Path;

/// Шаги по порядку, первый переносит из формата 1 в 2. Формат этой версии
/// на единицу больше числа шагов.
const STEPS: &[Step] = &[
    // 1 → 2: история чата sapien уходит в архив, сессия помнит только
    // разговор Claude Code.
    agent::without_chat,
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
