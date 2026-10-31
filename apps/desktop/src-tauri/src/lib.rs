mod durable;
mod error;
#[cfg(target_os = "macos")]
mod menu;
mod modules;

use modules::vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Меню по умолчанию Tauri ставит только на macOS, там же его и заменяем.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(vault::Watch::default())
        .setup(|app| {
            vault::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault::transport::vault_status,
            vault::transport::vault_tree,
            vault::transport::vault_choose,
            vault::transport::vault_create,
            vault::transport::vault_read,
            vault::transport::vault_write,
            vault::transport::vault_texts,
            vault::transport::vault_unsaved,
            vault::transport::vault_forget_unsaved,
            vault::transport::vault_trash,
            vault::transport::vault_versions,
            vault::transport::vault_version,
            vault::transport::vault_restore,
            vault::transport::vault_deleted,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
