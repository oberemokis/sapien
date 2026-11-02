//! Агент: Claude Code на устройстве по подписке Claude, который работает
//! в папке проекта своими инструментами, как в терминале. Разговор идёт
//! сессиями, у каждой своя история и своя сессия Claude Code. Вопросы
//! агента и разрешения на вызовы доходят до окна через сервер MCP
//! приложения (infrastructure/mcp.rs).

mod domain;
mod infrastructure;
mod ports;
mod use_case;

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

#[cfg(unix)]
pub use infrastructure::mcp::bridge;
pub use transport::Running;
