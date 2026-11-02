use crate::language::Language;
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

const SETTINGS: &str = "settings";

// Меню macOS по образцу меню Tauri по умолчанию, но без «Закрыть окно»:
// окно одно, и случайный ⌘W закрыл бы приложение посреди ответа агента.
// «Правка» остаётся: без неё в WKWebView не работают ⌘C, ⌘V и ⌘Z.
pub fn build<R: Runtime>(app: &AppHandle<R>, language: Language) -> tauri::Result<Menu<R>> {
    let text = |en, ru| language.pick(en, ru);
    let info = app.package_info();
    let name = &info.name;
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(info.version.to_string()),
        ..Default::default()
    };
    let settings = MenuItemBuilder::with_id(SETTINGS, text("Settings…", "Настройки…"))
        .accelerator("Cmd+,")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, name)
        .about_with_text(
            format!("{} {name}", text("About", "О программе")),
            Some(about),
        )
        .separator()
        .item(&settings)
        .separator()
        .services_with_text(text("Services", "Службы"))
        .separator()
        .hide_with_text(format!("{} {name}", text("Hide", "Скрыть")))
        .hide_others_with_text(text("Hide Others", "Скрыть остальные"))
        .show_all_with_text(text("Show All", "Показать все"))
        .separator()
        .quit_with_text(format!("{} {name}", text("Quit", "Завершить")))
        .build()?;

    let edit = SubmenuBuilder::new(app, text("Edit", "Правка"))
        .undo_with_text(text("Undo", "Отменить"))
        .redo_with_text(text("Redo", "Повторить"))
        .separator()
        .cut_with_text(text("Cut", "Вырезать"))
        .copy_with_text(text("Copy", "Скопировать"))
        .paste_with_text(text("Paste", "Вставить"))
        .select_all_with_text(text("Select All", "Выбрать все"))
        .build()?;

    let window = SubmenuBuilder::new(app, text("Window", "Окно"))
        .minimize_with_text(text("Minimize", "Свернуть"))
        .maximize_with_text(text("Zoom", "Изменить масштаб"))
        .fullscreen_with_text(text("Enter Full Screen", "Во весь экран"))
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &window])
        .build()
}

/// Настройки открывает окно: Rust только передаёт ему выбор пункта.
pub fn handle<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id().as_ref() == SETTINGS {
        let _ = app.emit("menu-settings", ());
    }
}
