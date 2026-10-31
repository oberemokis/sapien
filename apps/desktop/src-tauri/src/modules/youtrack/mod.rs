//! YouTrack: подключение по адресу сервера, облачного или своего,
//! и постоянному токену. Токен лежит в системном хранилище паролей
//! (secrets.rs), запросы к REST API делает Rust.

mod domain;
mod infrastructure;
mod ports;
mod use_case;

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

pub use infrastructure::http::Http;
