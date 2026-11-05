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

/// Код отказа: вариант перечисления кодов домена, его объявляет
/// `error_codes!`. В окно код уходит строкой, а перечисление попадает
/// в `@sapien/ipc`, и окно сверяет с ним свои подсказки.
pub trait ErrorCode: Copy {
    fn as_str(self) -> &'static str;
}

/// Перечисление кодов отказа домена: вариант и строка, которую видит окно.
/// Строка записана один раз, из неё же берёт имя тип для окна.
///
/// ```
/// sapien_kernel::error_codes! {
///     pub enum NotesCode {
///         Missing = "note_missing",
///     }
/// }
/// ```
#[macro_export]
macro_rules! error_codes {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $( $(#[$variant_meta:meta])* $variant:ident = $code:literal, )+
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, ::serde::Serialize, ::specta::Type)]
        $vis enum $name {
            $( $(#[$variant_meta])* #[serde(rename = $code)] $variant, )+
        }

        impl $crate::ErrorCode for $name {
            fn as_str(self) -> &'static str {
                match self {
                    $( Self::$variant => $code, )+
                }
            }
        }
    };
}

impl AppError {
    fn new(kind: ErrorKind, code: impl ErrorCode) -> Self {
        Self {
            kind,
            code: code.as_str(),
            detail: None,
        }
    }

    pub fn invalid(code: impl ErrorCode) -> Self {
        Self::new(ErrorKind::Invalid, code)
    }

    pub fn conflict(code: impl ErrorCode) -> Self {
        Self::new(ErrorKind::Conflict, code)
    }

    pub fn not_found(code: impl ErrorCode) -> Self {
        Self::new(ErrorKind::NotFound, code)
    }

    pub fn unavailable(code: impl ErrorCode) -> Self {
        Self::new(ErrorKind::Unavailable, code)
    }
}
