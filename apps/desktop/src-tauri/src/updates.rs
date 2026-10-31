//! Обновление приложения из релизов GitHub. Ищет, качает и ставит плагин
//! updater: лента `latest.json` последнего релиза, подпись своим ключом
//! (`plugins.updater` в tauri.conf.json) с версией внутри подписи. Окно
//! плагин напрямую не зовёт: у него нет прав плагина, только эти команды.

use crate::error::AppError;
use serde::Serialize;
use std::sync::{Mutex, PoisonError};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

/// Найденное обновление ждёт согласия здесь: ставится ровно то, что окно
/// показало человеку.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

/// Что окно показывает о новой версии.
#[derive(Debug, Serialize)]
pub struct Available {
    pub version: String,
    /// Описание релиза, markdown.
    pub notes: Option<String>,
}

/// Ход загрузки. `total` нет, когда сервер не назвал размер.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Progress {
    Chunk { received: u64, total: Option<u64> },
    Downloaded,
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Новой версии нет: `None`.
#[tauri::command]
pub async fn app_update_check(
    app: AppHandle,
    pending: State<'_, Pending>,
) -> Result<Option<Available>, AppError> {
    let update = app
        .updater()
        .map_err(failed)?
        .check()
        .await
        .map_err(failed)?;
    let available = update.as_ref().map(|update| Available {
        version: update.version.clone(),
        notes: update.body.clone(),
    });

    *pending.0.lock().unwrap_or_else(PoisonError::into_inner) = update;

    Ok(available)
}

/// Качает обновление, сверяет подпись, ставит и перезапускает приложение.
/// Оборванная загрузка или чужая подпись ничего не меняют на диске:
/// установленная версия работает дальше. Windows закрывает приложение
/// сама, когда запускает установщик.
#[tauri::command]
pub async fn app_update_install(
    app: AppHandle,
    pending: State<'_, Pending>,
    on_event: Channel<Progress>,
) -> Result<(), AppError> {
    let update = pending
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
        .ok_or(AppError::not_found("update_missing"))?;
    let mut received = 0;

    update
        .download_and_install(
            |chunk, total| {
                received += chunk as u64;
                // Окно закрыли посреди загрузки: установка всё равно дойдёт.
                let _ = on_event.send(Progress::Chunk { received, total });
            },
            || {
                let _ = on_event.send(Progress::Downloaded);
            },
        )
        .await
        .map_err(failed)?;

    app.restart()
}

fn failed(error: Error) -> AppError {
    log::warn!("обновление не прошло: {error}");

    match error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => AppError::invalid("update_signature"),
        Error::Reqwest(_) | Error::Network(_) | Error::ReleaseNotFound => {
            AppError::unavailable("update_unreachable")
        }
        _ => AppError::unavailable("update_failed"),
    }
}

#[cfg(test)]
mod tests {
    use tauri_plugin_updater::Config;

    // Настройку плагин читает только при запуске приложения, и опечатка
    // в ней роняла бы запуск, а не сборку.
    #[test]
    fn настройка_обновления_читается_плагином() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let config: Config = serde_json::from_value(conf["plugins"]["updater"].clone()).unwrap();

        assert!(config.require_signed_version);
        assert!(!config.allow_downgrades);
        assert!(!config.pubkey.is_empty());
        assert_eq!(
            config.endpoints[0].as_str(),
            "https://github.com/oberemokis/sapien/releases/latest/download/latest.json"
        );
    }
}
