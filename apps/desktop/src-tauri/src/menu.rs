use tauri::menu::{AboutMetadata, Menu, MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

// Меню macOS по образцу меню Tauri по умолчанию, но без «Закрыть окно»:
// его ⌘W срабатывает раньше страницы, а там ⌘W закрывает вкладку.
// «Правка» остаётся: без неё в WKWebView не работают ⌘C, ⌘V и ⌘Z.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, &info.name)
        .about_with_text(format!("О программе {}", info.name), Some(about))
        .separator()
        .services_with_text("Службы")
        .separator()
        .hide_with_text(format!("Скрыть {}", info.name))
        .hide_others_with_text("Скрыть остальные")
        .show_all_with_text("Показать все")
        .separator()
        .quit_with_text(format!("Завершить {}", info.name))
        .build()?;

    let edit = SubmenuBuilder::new(app, "Правка")
        .undo_with_text("Отменить")
        .redo_with_text("Повторить")
        .separator()
        .cut_with_text("Вырезать")
        .copy_with_text("Скопировать")
        .paste_with_text("Вставить")
        .select_all_with_text("Выбрать все")
        .build()?;

    let window = SubmenuBuilder::new(app, "Окно")
        .minimize_with_text("Свернуть")
        .maximize_with_text("Изменить масштаб")
        .fullscreen_with_text("Во весь экран")
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &window])
        .build()
}
