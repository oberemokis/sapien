//! Язык меню macOS и системного окна разблокировки. Выбор хранит окно,
//! Rust получает его при запуске окна и при каждой смене.

use sapien_kernel::AppError;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub enum Language {
    #[default]
    En,
    Ru,
}

impl Language {
    fn of(code: &str) -> Option<Self> {
        match code {
            "en" => Some(Self::En),
            "ru" => Some(Self::Ru),
            _ => None,
        }
    }

    /// Строка на этом языке.
    pub fn pick(self, en: &'static str, ru: &'static str) -> &'static str {
        match self {
            Self::En => en,
            Self::Ru => ru,
        }
    }
}

#[derive(Default)]
pub struct AppLanguage(Mutex<Language>);

pub fn current<R: Runtime>(app: &AppHandle<R>) -> Language {
    app.state::<AppLanguage>()
        .0
        .lock()
        .map(|language| *language)
        .unwrap_or_default()
}

/// Меню перестраивается целиком: у пунктов macOS нет смены подписи на месте
/// для стандартных действий вроде «Службы».
#[tauri::command]
pub fn app_set_language(app: AppHandle, language: String) -> Result<(), AppError> {
    let language = Language::of(&language).ok_or(AppError::invalid("language_unknown"))?;

    if let Ok(mut current) = app.state::<AppLanguage>().0.lock() {
        *current = language;
    }

    let menu =
        crate::menu::build(&app, language).map_err(|_| AppError::unavailable("menu_failed"))?;
    app.set_menu(menu)
        .map_err(|_| AppError::unavailable("menu_failed"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn язык_берётся_только_из_известных() {
        assert_eq!(Language::of("en"), Some(Language::En));
        assert_eq!(Language::of("ru"), Some(Language::Ru));
        assert_eq!(Language::of("de"), None);
        assert_eq!(Language::Ru.pick("Settings…", "Настройки…"), "Настройки…");
    }
}
