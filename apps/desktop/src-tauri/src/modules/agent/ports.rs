use super::domain::{Answer, Chat, ClaudeStatus, ModelError, Question, Stamp};
use crate::error::AppError;
use serde_json::Value;

/// Человек у окна: отвечает на вопросы агента посреди ответа.
pub trait Human {
    /// Ждёт ответа на вопрос, который окно уже показало, не дольше
    /// `ANSWER_WAIT`. `None`: ответа не дождались.
    fn ask(&self, question: &Question) -> impl Future<Output = Option<Answer>> + Send;
}

/// Claude Code на устройстве со входом пользователя, отгороженный от его
/// настроек, инструментов и памяти.
pub trait Claude {
    /// Идущий ответ в сессии.
    type Talk: Conversation;

    fn status(&self) -> impl Future<Output = ClaudeStatus> + Send;
    /// Один запрос без инструментов и без сохранённой сессии. Ответ JSON
    /// по схеме `schema`.
    fn structured(
        &self,
        model: &str,
        system: &str,
        schema: &Value,
        message: &str,
    ) -> impl Future<Output = Result<Value, AppError>> + Send;
    /// Запускает ответ на сообщение в сессии Claude Code с инструментами
    /// sapien. Ответ идёт событиями `Conversation`.
    fn converse(&self, run: &Run<'_>) -> impl Future<Output = Result<Self::Talk, AppError>> + Send;
    /// Каким сейчас лежит файл сессии `id`. Нет файла, значит, `None`.
    fn stamp(&self, id: &str) -> Option<Stamp>;
}

/// Один ответ в сессии Claude Code.
pub struct Run<'a> {
    pub model: &'a str,
    pub system: &'a str,
    /// Сообщение человека.
    pub prompt: &'a str,
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

/// Messages API провайдера модели.
pub trait Model {
    /// Шлёт запрос с потоком и отдаёт события потока по одному, как пришли.
    /// Кончается, когда поток закрылся.
    fn stream(
        &self,
        key: &str,
        body: &Value,
        on_event: &mut (impl FnMut(Value) + Send),
    ) -> impl Future<Output = Result<(), ModelError>> + Send;
}

/// Заметки хранилища без папок, закрытых для агента: их заметок нет
/// в списке и поиске, а чтение и запись по пути отвечают `note_closed`.
/// Удаления нет: агент не удаляет вовсе.
pub trait Notes {
    /// Можно ли показать агенту этот путь.
    fn open(&self, path: &str) -> bool;
    fn paths(&self) -> Result<Vec<String>, AppError>;
    /// Пути и тексты всех заметок.
    fn texts(&self) -> Result<Vec<(String, String)>, AppError>;
    fn read(&self, path: &str) -> Result<String, AppError>;
    /// Пишет заметку целиком, новую создаёт. Прежний текст уходит в историю.
    fn put(&self, path: &str, text: &str) -> Result<(), AppError>;
    /// Откат правки агента: заметка получает текст до неё, а без текста
    /// уходит в корзину. Откат просит человек, поэтому закрытые папки ему
    /// не мешают. Текущий текст уходит в историю.
    fn revert(&self, path: &str, before: Option<&str>) -> Result<(), AppError>;
}

/// Задачи YouTrack, только чтение. Ответ JSON-текстом.
pub trait Tracker {
    fn search(&self, query: &str) -> impl Future<Output = Result<String, AppError>> + Send;
    fn issue(&self, id: &str) -> impl Future<Output = Result<String, AppError>> + Send;
    /// Что случилось с подзадачами эпика с даты ГГГГ-ММ-ДД.
    fn epic_changes(
        &self,
        epic: &str,
        since: &str,
    ) -> impl Future<Output = Result<String, AppError>> + Send;
}

/// Где лежит история чата хранилища: сообщения в формате Messages API,
/// что поменял каждый ответ и сессия Claude Code.
pub trait ChatStore: Sync {
    fn load(&self) -> Result<Chat, AppError>;
    fn save(&self, chat: &Chat) -> Result<(), AppError>;
    fn clear(&self) -> Result<(), AppError>;
}
