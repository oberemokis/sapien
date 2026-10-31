use super::domain::{Entry, EntryKind};
use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Где приложение помнит выбранную папку между запусками.
pub trait VaultPlace {
    fn load(&self) -> Option<PathBuf>;
    fn save(&self, path: &Path) -> Result<(), AppError>;
}

/// Папка хранилища на диске.
pub trait VaultDisk {
    fn is_dir(&self, path: &Path) -> bool;
    fn list(&self, root: &Path) -> Result<Vec<Entry>, AppError>;
    /// Создаёт пустую заметку или папку. Занятое место не трогает, а отвечает
    /// конфликтом.
    fn create(&self, path: &Path, kind: EntryKind) -> Result<(), AppError>;
    fn read(&self, path: &Path) -> Result<String, AppError>;
    /// Переписывает существующую заметку. Пропавшую не создаёт заново,
    /// а отвечает, что её нет.
    fn write(&self, path: &Path, text: &str) -> Result<(), AppError>;
}
