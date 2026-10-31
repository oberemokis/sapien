mod error;
mod modules;

use modules::vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
