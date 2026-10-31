use serde::Serialize;

/// Ошибка команды. Уходит в интерфейс видом и кодом, без текста: перевод
/// делает интерфейс по коду (docs/architecture.md, «Ошибка это код»).
#[derive(Debug, PartialEq, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub code: &'static str,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// Того, о чём просят, нет: папку не выбрали или её убрали.
    NotFound,
    /// Диск или система отказали: нет прав, файл занят.
    Unavailable,
}

impl AppError {
    pub fn not_found(code: &'static str) -> Self {
        Self {
            kind: ErrorKind::NotFound,
            code,
        }
    }

    pub fn unavailable(code: &'static str) -> Self {
        Self {
            kind: ErrorKind::Unavailable,
            code,
        }
    }
}
