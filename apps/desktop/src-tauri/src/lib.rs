mod data_format;
mod durable;
mod egress;
mod error;
mod links;
#[cfg(target_os = "macos")]
mod menu;
mod modules;
mod sealed;
mod secrets;
mod security;
mod updates;
mod window_store;

use modules::{agent, vault, youtrack};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Меню по умолчанию Tauri ставит только на macOS, там же его и заменяем.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);

    builder
        // Лог в папке логов приложения и в терминале: туда пишутся отказы
        // запросов из egress.rs. Ниже предупреждения не пишется ничего.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        // Ссылки окна открывает только links.rs: скрипт плагина, который
        // перехватывает клики по ссылкам, окну не нужен.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Pending::default())
        .manage(vault::Watch::default())
        .manage(vault::Opened::default())
        .manage(secrets::Secrets::default())
        .manage(youtrack::Http::default())
        .manage(agent::Anthropic::default())
        .manage(agent::Running::default())
        .manage(window_store::WindowStore::default())
        .setup(|app| {
            let data = app.path().app_data_dir()?;

            // Ключ данных первым: и перенос, и всё остальное читают файлы
            // приложения через sealed.rs. Пропавший ключ запуск не держит,
            // окно предложит начать с чистыми данными.
            let sealed = sealed::start(&secrets::SystemKeychain, &data);
            if !matches!(sealed, sealed::State::Sealed | sealed::State::Plain) {
                log::warn!("данные приложения не читаются: {sealed:?}");
            }

            // До окна и слежения за хранилищем: никто не должен прочитать
            // файлы приложения в прежнем формате. Отказ не держит запуск,
            // шаг повторится при следующем.
            if let Err(error) = data_format::migrate(&data) {
                log::error!("перенос данных приложения не закончен: {error}");
            }
            links::main_window(app)?;
            vault::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            links::open_link,
            updates::app_version,
            updates::app_update_check,
            updates::app_update_install,
            security::security_status,
            security::security_reset,
            window_store::window_store_read,
            window_store::window_store_write,
            secrets::secret_status,
            secrets::secret_set,
            secrets::secret_delete,
            youtrack::transport::youtrack_status,
            youtrack::transport::youtrack_connect,
            youtrack::transport::youtrack_disconnect,
            youtrack::transport::youtrack_publish,
            youtrack::transport::youtrack_issue_state,
            youtrack::transport::youtrack_check,
            youtrack::transport::youtrack_similar,
            youtrack::transport::youtrack_assignees,
            youtrack::transport::youtrack_projects,
            youtrack::transport::youtrack_project_issues,
            youtrack::transport::youtrack_feed,
            youtrack::transport::youtrack_issue_detail,
            youtrack::transport::youtrack_graph,
            agent::transport::agent_history,
            agent::transport::agent_send,
            agent::transport::agent_stop,
            agent::transport::agent_clear,
            agent::transport::agent_undo,
            agent::transport::agent_meeting_tasks,
            vault::transport::vault_opened,
            vault::transport::vault_status,
            vault::transport::vault_tree,
            vault::transport::vault_choose,
            vault::transport::vault_create,
            vault::transport::vault_close_for_agent,
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
