use super::domain::{
    AgentModel, Answer, ClaudeStatus, Commands, Oversight, Question, Session, SessionInfo, Stamp,
};
use crate::error::AppError;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Человек у окна: отвечает на вопросы агента посреди ответа.
pub trait Human {
    /// Ждёт ответа на вопрос, который окно уже показало, не дольше
    /// `ANSWER_WAIT`. `None`: ответа не дождались.
    fn ask(&self, question: &Question) -> impl Future<Output = Option<Answer>> + Send;
}

/// Claude Code на устройстве со входом пользователя. Работает в папке
/// проекта со своими инструментами, настройками и CLAUDE.md, как в терминале.
pub trait Claude {
    /// Идущий ответ в сессии.
    type Talk: Conversation;

    fn status(&self) -> impl Future<Output = ClaudeStatus> + Send;
    /// Модели, которые Claude Code предлагает этому аккаунту. Нет Claude
    /// Code, значит, `claude_missing`.
    fn models(&self) -> impl Future<Output = Result<Vec<AgentModel>, AppError>> + Send;
    /// Команды, скилы и субагенты Claude Code в папке проекта `dir`:
    /// у проекта свои команды и плагины.
    fn commands(&self, dir: &Path) -> impl Future<Output = Result<Commands, AppError>> + Send;
    /// Запускает ответ на сообщение в сессии Claude Code с сервером
    /// MCP sapien. Ответ идёт событиями `Conversation`.
    fn converse(&self, run: &Run<'_>) -> impl Future<Output = Result<Self::Talk, AppError>> + Send;
    /// Каким сейчас лежит файл сессии `id`, начатой в папке `dir`. Нет
    /// файла, значит, `None`.
    fn stamp(&self, dir: &Path, id: &str) -> Option<Stamp>;
}

/// Один ответ в сессии Claude Code.
pub struct Run<'a> {
    /// Папка проекта: в ней Claude Code работает.
    pub dir: &'a Path,
    /// Без модели Claude Code берёт свою по умолчанию.
    pub model: Option<&'a str>,
    /// Уровень размышления, один из `EFFORTS`. Без него решает модель.
    pub effort: Option<&'a str>,
    /// Что дописать к системному промпту Claude Code.
    pub append: &'a str,
    /// Сообщение человека.
    pub prompt: &'a str,
    /// Спрашивать ли разрешения на вызовы.
    pub oversight: Oversight,
    /// Сессия, которую продолжить. Без неё Claude Code начинает новую.
    pub resume: Option<&'a str>,
    /// Продолжить в копии сессии: её меняли снаружи.
    pub fork: bool,
}

/// Что пришло от идущего ответа Claude Code.
#[derive(Debug, PartialEq)]
pub enum Incoming {
    /// Событие его потока `stream-json`.
    Line(Value),
    /// Вызов инструмента sapien. `id` это номер запроса JSON-RPC.
    Call {
        id: Value,
        name: String,
        input: Value,
    },
}

/// Идущий ответ Claude Code.
pub trait Conversation: Send {
    /// Следующее событие. `None`: процесс кончился, поток дочитан.
    fn next(&mut self) -> impl Future<Output = Option<Incoming>> + Send;
    fn reply(
        &mut self,
        id: Value,
        result: Result<String, String>,
    ) -> impl Future<Output = ()> + Send;
    /// «Стоп»: прерывает процесс, а не вышел он сам, снимает его.
    fn interrupt(&mut self);
    /// Что Claude Code написал в stderr: по нему понятен отказ без `result`.
    fn errors(&self) -> &str;
}

/// Проекты, в которых работает агент.
pub trait Projects: Sync {
    /// Папка проекта `id`. Проекта нет в списке или папки нет на диске:
    /// `None`.
    fn folder(&self, id: &str) -> Option<PathBuf>;
}

/// Где лежат сессии: их история, заголовок и сессия Claude Code.
pub trait Sessions: Sync {
    fn list(&self) -> Result<Vec<SessionInfo>, AppError>;
    /// Нет сессии, значит, `session_missing`.
    fn load(&self, id: &str) -> Result<Session, AppError>;
    fn save(&self, session: &Session) -> Result<(), AppError>;
    /// Сессии уже нет: удалять нечего.
    fn delete(&self, id: &str) -> Result<(), AppError>;
}
