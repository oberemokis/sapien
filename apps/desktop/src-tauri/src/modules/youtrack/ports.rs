use super::domain::{ApiError, Sent};
use crate::error::AppError;
use serde_json::Value;

/// REST API сервера YouTrack.
pub trait YoutrackApi {
    /// Имя владельца токена. Этим же запросом проверяется, что по адресу
    /// YouTrack и что токен он принимает.
    fn me(&self, host: &str, token: &str) -> impl Future<Output = Result<String, ApiError>> + Send;

    /// Чтение по пути API, ответ JSON-текстом как есть: агенту он понятен
    /// и без разбора.
    fn get(
        &self,
        host: &str,
        token: &str,
        path: &str,
        query: &[(&str, &str)],
    ) -> impl Future<Output = Result<String, ApiError>> + Send;

    /// Запись по пути API с телом JSON. Ответ JSON-текстом, пустой ответ
    /// пустой строкой.
    fn post(
        &self,
        host: &str,
        token: &str,
        path: &str,
        query: &[(&str, &str)],
        body: &Value,
    ) -> impl Future<Output = Result<String, ApiError>> + Send;
}

/// Где приложение помнит адрес подключённого сервера. Токен лежит не здесь,
/// а в системном хранилище паролей.
pub trait HostPlace {
    fn load(&self) -> Option<String>;
    fn save(&self, host: &str) -> Result<(), AppError>;
    fn clear(&self) -> Result<(), AppError>;
}

/// Что приложение опубликовало в задачу в прошлый раз: по этому видно,
/// поменяли ли задачу в YouTrack с тех пор.
pub trait Ledger {
    fn load(&self, id: &str) -> Option<Sent>;
    fn save(&self, id: &str, sent: &Sent) -> Result<(), AppError>;
}
