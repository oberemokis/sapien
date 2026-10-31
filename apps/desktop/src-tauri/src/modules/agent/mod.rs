//! Агент: чат с моделью Anthropic, который читает, ищет и правит заметки
//! хранилища и читает задачи YouTrack. Ключ к модели лежит в системном
//! хранилище паролей (secrets.rs), запросы делает Rust. Через подписку
//! Claude агент идёт Claude Code на устройстве, а инструменты получает
//! от приложения сервером MCP (infrastructure/mcp.rs).

mod domain;
mod infrastructure;
mod ports;
mod use_case;

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

pub use infrastructure::anthropic::Anthropic;
#[cfg(unix)]
pub use infrastructure::mcp::bridge;
pub use transport::Running;
