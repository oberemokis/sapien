//! Агенты: Claude Code, Codex и другие агенты, которых человек запускает
//! в терминале сессии. Какой агент в нём работает и работает ли, видно
//! по процессу на переднем плане и по его выводу (`PaneWatch`), а разговор
//! панели сообщают интеграции агента через сокет хуков.

mod claude_code;
mod domain;
pub mod hooks;
mod integrations;
mod watch;

pub use claude_code::ClaudeCode;
pub use domain::{
    AgentsCode, ClaudeState, ClaudeStatus, Conversation, Integration, IntegrationState, Report,
};
pub use integrations::Integrations;
pub use watch::{Look, PaneWatch};
