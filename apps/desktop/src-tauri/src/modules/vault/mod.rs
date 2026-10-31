//! Хранилище заметок: папка на диске с файлами `.md`, как в Obsidian.

mod domain;
mod infrastructure;
mod ports;
mod use_case;

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

pub use infrastructure::watcher::Watch;
pub use transport::{Opened, start};
