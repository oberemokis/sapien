//! Агент: Claude Code, Codex и другие агенты, которых человек запускает
//! в терминале сессии. Сессия sapien это вкладка с оболочкой в папке
//! проекта, а какой агент в ней работает и работает ли, sapien узнаёт
//! по процессу на переднем плане и по его выводу.

mod domain;
mod infrastructure;
mod ports;
mod use_case;

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

pub use infrastructure::sessions_dir::without_chat;
pub use transport::{Terminals, start_terminals, stop_terminals};
