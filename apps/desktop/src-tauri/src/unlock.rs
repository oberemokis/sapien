//! Разблокировка окна: Touch ID или пароль учётной записи macOS, когда
//! датчика нет. Саму блокировку держит окно, Rust только
//! спрашивает систему, тот ли человек вернулся.

use crate::language::{self, Language};
use robius_authentication::{
    AndroidText, BiometricStrength, Context, Error, PolicyBuilder, Text, WindowsText,
};
use sapien_kernel::AppError;
use std::sync::Mutex;
use tauri::AppHandle;
use tokio::sync::oneshot;

sapien_kernel::error_codes! {
    /// Отказы разблокировки окна.
    pub enum UnlockCode {
        /// Человек закрыл системное окно проверки.
        Canceled = "unlock_canceled",
        /// Проверка не пройдена.
        Failed = "unlock_failed",
        /// Системе нечем спросить: у учётной записи нет пароля.
        Unavailable = "unlock_unavailable",
    }
}

#[derive(Debug, PartialEq)]
enum Outcome {
    Verified,
    Canceled,
    Failed,
    /// Системе нечем спросить: у учётной записи нет пароля или проверку
    /// закрыла политика.
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
fn ask(language: Language) -> Result<oneshot::Receiver<Result<(), Error>>, Error> {
    let policy = PolicyBuilder::new()
        .biometrics(Some(BiometricStrength::Strong))
        .password(true)
        .companion(true)
        .build()
        .ok_or(Error::Unavailable)?;
    // Крейт просит текст под каждую систему, macOS показывает только `apple`.
    let text = Text {
        android: AndroidText {
            title: "sapien",
            subtitle: None,
            description: None,
        },
        // macOS показывает его как «sapien is trying to unlock the window».
        apple: language.pick("unlock the window", "разблокировать окно"),
        windows: WindowsText::new("sapien", "Unlock sapien").ok_or(Error::InvalidText)?,
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
#[specta::specta]
pub async fn security_unlock(app: AppHandle) -> Result<(), AppError> {
    let result = match ask(language::current(&app)) {
        Ok(receiver) => receiver.await.unwrap_or(Err(Error::Unknown)),
        Err(error) => Err(error),
    };

    match outcome(result) {
        Outcome::Verified => Ok(()),
        Outcome::Canceled => Err(AppError::invalid(UnlockCode::Canceled)),
        Outcome::Failed => Err(AppError::invalid(UnlockCode::Failed)),
        Outcome::Unavailable => Err(AppError::unavailable(UnlockCode::Unavailable)),
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
