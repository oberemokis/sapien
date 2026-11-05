//! События от Rust окну. Типы и имена окно берёт из bindings.gen.ts,
//! а имена остались прежними строками.

use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

/// Сессии поменялись без команды окна: в терминале запустили агента или
/// он вышел, начал или кончил работать, назвал сессию.
#[derive(Clone, Serialize, Type, Event)]
#[tauri_specta(event_name = "agent-sessions")]
pub struct SessionsChanged;

/// Оболочка панели `pane` сессии `session` кончилась.
#[derive(Clone, Serialize, Type, Event)]
#[tauri_specta(event_name = "terminal-exited")]
pub struct TerminalExited {
    pub session: String,
    pub pane: String,
}

/// Пункт меню «Настройки…».
#[derive(Clone, Serialize, Type, Event)]
#[tauri_specta(event_name = "menu-settings")]
pub struct MenuSettings;
