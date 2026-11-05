use super::domain::{Session, SessionInfo};
use sapien_kernel::AppError;
use std::path::PathBuf;

/// Проекты, в которых заводятся сессии.
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
    /// Сессии уже нет: удалять нечего. Файлы её панелей уходят с ней.
    fn delete(&self, id: &str) -> Result<(), AppError>;
}

/// Файлы панели `pane` сессии `session`, которые переживают перезапуск:
/// последний экран терминала и разговор агента. Хранятся байтами, а что
/// в них, знают терминал и агенты.
pub trait PaneFiles: Sync {
    /// Вывод терминала панели, каким он был, когда терминал кончился.
    fn screen(&self, session: &str, pane: &str) -> Option<Vec<u8>>;
    fn save_screen(&self, session: &str, pane: &str, bytes: &[u8]) -> Result<(), AppError>;
    /// Разговор, который панель продолжит, когда её оболочка начнётся
    /// заново.
    fn conversation(&self, session: &str, pane: &str) -> Option<Vec<u8>>;
    /// `None`: агент из панели ушёл, и продолжать нечего.
    fn save_conversation(
        &self,
        session: &str,
        pane: &str,
        bytes: Option<&[u8]>,
    ) -> Result<(), AppError>;
}
