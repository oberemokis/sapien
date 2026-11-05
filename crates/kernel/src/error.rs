use serde::Serialize;
use specta::Type;

/// Ошибка команды. Уходит в интерфейс видом и кодом, без текста: перевод
/// делает интерфейс по коду (docs/architecture.md, «Ошибка это код»).
#[derive(Debug, PartialEq, Serialize, Type)]
pub struct AppError {
    pub kind: ErrorKind,
    pub code: &'static str,
    /// Объяснение отказа от чужого сервера, как он его дал. Перевести его
    /// нельзя, а без него причину не найти: окно показывает его рядом
    /// с текстом по коду.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// Того, о чём просят, нет: папку не выбрали или её убрали.
    NotFound,
    /// Диск или система отказали: нет прав, файл занят.
    Unavailable,
    /// Вход не прошёл проверку: имя с запрещённым символом, путь наружу.
    Invalid,
    /// Место занято: файл или папка с таким именем уже есть.
    Conflict,
}

impl AppError {
    fn new(kind: ErrorKind, code: &'static str) -> Self {
        Self {
            kind,
            code,
            detail: None,
        }
    }

    pub fn invalid(code: &'static str) -> Self {
        Self::new(ErrorKind::Invalid, code)
    }

    pub fn conflict(code: &'static str) -> Self {
        Self::new(ErrorKind::Conflict, code)
    }

    pub fn not_found(code: &'static str) -> Self {
        Self::new(ErrorKind::NotFound, code)
    }

    pub fn unavailable(code: &'static str) -> Self {
        Self::new(ErrorKind::Unavailable, code)
    }
}
