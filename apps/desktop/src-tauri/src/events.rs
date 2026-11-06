//! События от Rust окну. Типы и имена окно берёт из bindings.gen.ts,
//! а имена остались прежними строками.

use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

/// Пункт меню «Настройки…».
#[derive(Clone, Serialize, Type, Event)]
#[tauri_specta(event_name = "menu-settings")]
pub struct MenuSettings;
