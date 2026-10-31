//! Хранилище окна для кешей с текстом задач: то, что окно держало бы
//! в localStorage, лежит одним зашифрованным файлом (sealed.rs). Окно
//! читает его целиком при запуске и пишет изменённые ключи.

use crate::error::AppError;
use crate::sealed;
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Manager, State};

/// Записи идут по очереди: две разом потеряли бы одна другую.
#[derive(Default)]
pub struct WindowStore(Mutex<()>);

fn file(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("window-store.json"))
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))
}

/// Испорченный файл это пустой кеш: окно спросит YouTrack заново.
/// Нечитаемый шифр это ошибка: без ключа кеш не прочесть, но и затирать
/// его нельзя.
fn load(file: &Path) -> Result<BTreeMap<String, String>, AppError> {
    match sealed::read(file) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(_) => Err(AppError::unavailable("window_store_unreadable")),
    }
}

/// `None` у ключа стирает его.
fn save(file: &Path, changes: BTreeMap<String, Option<String>>) -> Result<(), AppError> {
    let unwritable = |_| AppError::unavailable("window_store_unwritable");
    let mut all = load(file)?;

    for (key, value) in changes {
        match value {
            Some(value) => all.insert(key, value),
            None => all.remove(&key),
        };
    }

    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(unwritable)?;
    }

    let bytes =
        serde_json::to_vec(&all).map_err(|_| AppError::unavailable("window_store_unwritable"))?;

    sealed::write(file, &bytes).map_err(unwritable)
}

#[tauri::command]
pub fn window_store_read(
    app: AppHandle,
    store: State<'_, WindowStore>,
) -> Result<BTreeMap<String, String>, AppError> {
    let _turn = store.0.lock().unwrap_or_else(PoisonError::into_inner);

    load(&file(&app)?)
}

#[tauri::command]
pub fn window_store_write(
    app: AppHandle,
    store: State<'_, WindowStore>,
    changes: BTreeMap<String, Option<String>>,
) -> Result<(), AppError> {
    let _turn = store.0.lock().unwrap_or_else(PoisonError::into_inner);

    save(&file(&app)?, changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn изменённые_ключи_пишутся_поверх_остальных() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("window-store.json");

        save(
            &file,
            BTreeMap::from([
                ("inbox".to_owned(), Some("лента".to_owned())),
                ("known".to_owned(), Some("задачи".to_owned())),
            ]),
        )
        .unwrap();
        save(
            &file,
            BTreeMap::from([
                ("inbox".to_owned(), None),
                ("graphs".to_owned(), Some("графы".to_owned())),
            ]),
        )
        .unwrap();

        assert_eq!(
            load(&file).unwrap(),
            BTreeMap::from([
                ("graphs".to_owned(), "графы".to_owned()),
                ("known".to_owned(), "задачи".to_owned()),
            ])
        );
    }

    #[test]
    fn нет_файла_или_он_испорчен_это_пустой_кеш() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("window-store.json");

        assert!(load(&file).unwrap().is_empty());

        fs::write(&file, "{не json").unwrap();

        assert!(load(&file).unwrap().is_empty());
    }
}
