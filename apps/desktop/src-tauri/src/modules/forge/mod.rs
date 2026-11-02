//! GitHub и GitLab: подключение по токену с проверкой ответом сервера.
//! Токен лежит в системном хранилище паролей (secrets.rs), а адрес
//! и логин в папке данных приложения. Запросы делает Rust.

mod domain;
mod infrastructure;
mod ports;
mod use_case;

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

pub use infrastructure::Http;
