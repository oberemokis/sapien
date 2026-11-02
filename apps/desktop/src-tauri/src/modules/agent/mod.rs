//! Агент: Claude Code на устройстве по подписке Claude, который работает
//! в папке проекта своими инструментами, как в терминале. Разговор идёт
//! сессиями, у каждой своя сессия Claude Code, а историю хранит он сам.

mod domain;
mod infrastructure;
mod ports;
mod use_case;

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

pub use infrastructure::sessions_dir::without_chat;
