mod durable;
mod error;
mod links;
#[cfg(target_os = "macos")]
mod menu;
mod modules;
mod secrets;

use modules::{agent, vault, youtrack};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Меню по умолчанию Tauri ставит только на macOS, там же его и заменяем.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        // Ссылки окна открывает только links.rs: скрипт плагина, который
        // перехватывает клики по ссылкам, окну не нужен.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(vault::Watch::default())
        .manage(vault::Opened::default())
        .manage(secrets::Secrets::default())
        .manage(youtrack::Http::default())
        .manage(agent::Anthropic::default())
        .manage(agent::Running::default())
        .setup(|app| {
            links::main_window(app)?;
            vault::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            links::open_link,
            secrets::secret_status,
            secrets::secret_set,
            secrets::secret_delete,
            youtrack::transport::youtrack_status,
            youtrack::transport::youtrack_connect,
            youtrack::transport::youtrack_disconnect,
            agent::transport::agent_history,
            agent::transport::agent_send,
            agent::transport::agent_stop,
            agent::transport::agent_clear,
            vault::transport::vault_opened,
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
