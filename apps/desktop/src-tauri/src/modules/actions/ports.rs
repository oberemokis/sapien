use super::domain::ActionFile;
use crate::error::AppError;

/// Папка действий. `path` здесь уже проверенное имя файла в ней.
pub trait Folder {
    fn list(&self) -> Result<Vec<ActionFile>, AppError>;
    fn exists(&self, path: &str) -> bool;
    /// Пишет файл целиком, новый создаёт.
    fn write(&self, path: &str, text: &str) -> Result<(), AppError>;
    /// Нет файла, значит, `action_missing`.
    fn delete(&self, path: &str) -> Result<(), AppError>;
}
