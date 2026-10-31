use super::domain::ModelError;
use crate::error::AppError;
use serde_json::Value;

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

/// Заметки хранилища. Удаления нет: агент не удаляет вовсе.
pub trait Notes {
    fn paths(&self) -> Result<Vec<String>, AppError>;
    /// Пути и тексты всех заметок.
    fn texts(&self) -> Result<Vec<(String, String)>, AppError>;
    fn read(&self, path: &str) -> Result<String, AppError>;
    /// Пишет заметку целиком, новую создаёт. Прежний текст уходит в историю.
    fn put(&self, path: &str, text: &str) -> Result<(), AppError>;
}

/// Задачи YouTrack, только чтение. Ответ JSON-текстом.
pub trait Tracker {
    fn search(&self, query: &str) -> impl Future<Output = Result<String, AppError>> + Send;
    fn issue(&self, id: &str) -> impl Future<Output = Result<String, AppError>> + Send;
}

/// Где лежит история чата хранилища: сообщения в формате Messages API.
pub trait ChatStore {
    fn load(&self) -> Result<Vec<Value>, AppError>;
    fn save(&self, messages: &[Value]) -> Result<(), AppError>;
    fn clear(&self) -> Result<(), AppError>;
}
