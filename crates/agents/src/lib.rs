//! Агенты: Claude Code, Codex и другие агенты, которых человек запускает
//! в терминале сессии. Какой агент в нём работает и работает ли, видно
//! по процессу на переднем плане и по его выводу, а разговор панели
//! сообщают интеграции агента через сокет хуков.

mod claude_code;
mod domain;
pub mod hooks;
mod integrations;

pub use claude_code::ClaudeCode;
pub use domain::{
    ClaudeState, ClaudeStatus, Conversation, Integration, IntegrationState, Report, Titles,
    accepts, agent_of, resume_command, session_title,
};
pub use integrations::Integrations;
