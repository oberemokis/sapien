//! Агент в терминале сессии: связка крейтов `sapien-sessions`,
//! `sapien-terminal` и `sapien-agents` с Tauri. Терминалы панелей и их
//! сторож живут здесь, пока их не забрал фасад рабочего места.

// Команды открыты модулем целиком: generate_handler! ищет рядом с каждой
// командой скрытые функции, которые переэкспорт через `pub use` не уносит.
pub mod transport;

pub use transport::{Terminals, hook, start_terminals, stop_terminals};
