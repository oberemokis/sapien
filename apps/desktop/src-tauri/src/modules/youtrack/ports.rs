use super::domain::ApiError;
use crate::error::AppError;

/// REST API сервера YouTrack.
pub trait YoutrackApi {
    /// Имя владельца токена. Этим же запросом проверяется, что по адресу
    /// YouTrack и что токен он принимает.
    fn me(&self, host: &str, token: &str) -> impl Future<Output = Result<String, ApiError>> + Send;
}

/// Где приложение помнит адрес подключённого сервера. Токен лежит не здесь,
/// а в системном хранилище паролей.
pub trait HostPlace {
    fn load(&self) -> Option<String>;
    fn save(&self, host: &str) -> Result<(), AppError>;
    fn clear(&self) -> Result<(), AppError>;
}
