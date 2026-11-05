use super::domain::{Forge, ForgeStatuses};
use sapien_kernel::AppError;

/// API сервера.
pub trait Api {
    /// Логин владельца токена: этим же запросом проверяется, что сервер
    /// токен принимает.
    fn login(
        &self,
        forge: Forge,
        host: &str,
        token: &str,
    ) -> impl Future<Output = Result<String, AppError>> + Send;
}

/// Где приложение помнит подключения: адрес и логин. Токены лежат не здесь,
/// а в системном хранилище паролей.
pub trait Accounts {
    fn load(&self) -> Result<ForgeStatuses, AppError>;
    fn save(&self, statuses: &ForgeStatuses) -> Result<(), AppError>;
}
