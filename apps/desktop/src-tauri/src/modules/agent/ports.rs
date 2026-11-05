use super::domain::{Session, SessionInfo};
use sapien_kernel::AppError;
use std::path::PathBuf;

/// Проекты, в которых работает агент.
pub trait Projects: Sync {
    /// Папка проекта `id`. Проекта нет в списке или папки нет на диске:
    /// `None`.
    fn folder(&self, id: &str) -> Option<PathBuf>;
}

/// Где лежат сессии: заголовок, время и сессия Claude Code.
pub trait Sessions: Sync {
    fn list(&self) -> Result<Vec<SessionInfo>, AppError>;
    /// Нет сессии, значит, `session_missing`.
    fn load(&self, id: &str) -> Result<Session, AppError>;
    fn save(&self, session: &Session) -> Result<(), AppError>;
    /// Сессии уже нет: удалять нечего.
    fn delete(&self, id: &str) -> Result<(), AppError>;
}
