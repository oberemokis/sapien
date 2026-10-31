//! Разблокировка окна: Touch ID, Windows Hello или пароль учётной записи
//! системы, когда биометрии нет. Саму блокировку держит окно, Rust только
//! спрашивает систему, тот ли человек вернулся.

use crate::error::AppError;
use robius_authentication::{
    AndroidText, BiometricStrength, Context, Error, PolicyBuilder, Text, WindowsText,
};
use std::sync::Mutex;
use tokio::sync::oneshot;

/// Действие polkit из `polkit/is.oberemok.sapien.policy`, его ставят пакеты
/// .deb и .rpm. Текст окна пароля на Linux берётся оттуда, а не из `Text`.
const POLKIT_ACTION: &str = "is.oberemok.sapien.unlock";

/// macOS показывает его как «sapien пытается разблокировать окно».
const REASON: &str = "разблокировать окно";

#[derive(Debug, PartialEq)]
enum Outcome {
    Verified,
    Canceled,
    Failed,
    /// Системе нечем спросить: у учётной записи нет пароля, Windows Hello
    /// закрыт политикой, нет агента polkit или действия polkit (AppImage).
    Unavailable,
}

/// Недоступной считается только явная невозможность спросить: окно на ней
/// открывается без проверки (см. модуль security окна). Непонятный ответ
/// системы это неудача, и окно остаётся закрытым.
fn outcome(result: Result<(), Error>) -> Outcome {
    match result {
        Ok(()) => Outcome::Verified,
        Err(
            Error::UserCanceled | Error::AppCanceled | Error::SystemCanceled | Error::UserFallback,
        ) => Outcome::Canceled,
        Err(
            Error::Unavailable
            | Error::PasscodeNotSet
            | Error::NotConfigured
            | Error::DisabledByPolicy,
        ) => Outcome::Unavailable,
        Err(_) => Outcome::Failed,
    }
}

/// Биометрия с паролем: без датчика или после неудач система сама
/// предлагает пароль учётной записи.
fn ask() -> Result<oneshot::Receiver<Result<(), Error>>, Error> {
    let policy = PolicyBuilder::new()
        .biometrics(Some(BiometricStrength::Strong))
        .password(true)
        .companion(true)
        .action_ids([POLKIT_ACTION])
        .build()
        .ok_or(Error::Unavailable)?;
    let text = Text {
        android: AndroidText {
            title: "sapien",
            subtitle: None,
            description: None,
        },
        apple: REASON,
        windows: WindowsText::new("sapien", "Разблокировать sapien").ok_or(Error::InvalidText)?,
    };
    let (sender, receiver) = oneshot::channel();
    // Ответ приходит один раз, но крейт просит Fn.
    let sender = Mutex::new(Some(sender));

    Context::new(()).authenticate(text, &policy, move |result| {
        if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
            let _ = sender.send(result);
        }
    })?;

    Ok(receiver)
}

/// Окно ждёт ответа человека в системном окне проверки, поэтому команда
/// асинхронная и главный поток не держит.
#[tauri::command]
pub async fn app_unlock() -> Result<(), AppError> {
    let result = match ask() {
        Ok(receiver) => receiver.await.unwrap_or(Err(Error::Unknown)),
        Err(error) => Err(error),
    };

    match outcome(result) {
        Outcome::Verified => Ok(()),
        Outcome::Canceled => Err(AppError::invalid("unlock_canceled")),
        Outcome::Failed => Err(AppError::invalid("unlock_failed")),
        Outcome::Unavailable => Err(AppError::unavailable("unlock_unavailable")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn отмена_неудача_и_недоступность_различаются() {
        assert_eq!(outcome(Ok(())), Outcome::Verified);
        assert_eq!(outcome(Err(Error::UserCanceled)), Outcome::Canceled);
        assert_eq!(outcome(Err(Error::SystemCanceled)), Outcome::Canceled);
        assert_eq!(outcome(Err(Error::Authentication)), Outcome::Failed);
        assert_eq!(outcome(Err(Error::Exhausted)), Outcome::Failed);
        assert_eq!(outcome(Err(Error::Unavailable)), Outcome::Unavailable);
        assert_eq!(outcome(Err(Error::PasscodeNotSet)), Outcome::Unavailable);
        assert_eq!(outcome(Err(Error::Unknown)), Outcome::Failed);
        assert_eq!(outcome(Err(Error::Busy)), Outcome::Failed);
    }
}
