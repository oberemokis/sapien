//! Агент: Claude Code на устройстве по подписке Claude, который работает
//! в папке проекта своими инструментами. Сессия sapien это вкладка
//! с интерактивным Claude Code в псевдотерминале, а разговор хранит он
//! сам. Что он делает, sapien узнаёт из его хуков (infrastructure/hooks.rs).

mod domain;
mod infrastructure;
mod ports;
mod use_case;

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

#[cfg(unix)]
pub use infrastructure::hooks::forward as forward_hook;
pub use infrastructure::sessions_dir::without_chat;
pub use transport::{Terminals, start_terminals};
