mod data_format;
mod durable;
mod egress;
mod error;
mod language;
mod links;
mod menu;
mod modules;
mod secrets;
mod unlock;
mod updates;

use modules::{agent, forge, projects};
use tauri::{Manager, RunEvent};

/// `sapien hook <агент>`: хук агента в панели сообщает приложению её
/// разговор и сразу выходит, окна не открывает.
pub fn hook() {
    agent::hook(&std::env::args().nth(2).unwrap_or_default());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Меню сначала на английском: язык окна приходит командой
    // app_set_language, когда окно открылось.
    tauri::Builder::default()
        .menu(|app| menu::build(app, language::Language::default()))
        .on_menu_event(menu::handle)
        // Лог в папке логов приложения и в терминале: туда пишутся отказы
        // запросов из egress.rs. Ниже предупреждения не пишется ничего.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        // Ссылки окна открывает только links.rs: скрипт плагина, который
        // перехватывает клики по ссылкам, окну не нужен.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Pending::default())
        .manage(language::AppLanguage::default())
        .manage(secrets::Secrets::default())
        .manage(forge::Http::default())
        .manage(agent::Terminals::default())
        .setup(|app| {
            // До окна: никто не должен прочитать файлы приложения
            // в прежнем формате. Отказ не держит запуск, шаг повторится
            // при следующем.
            if let Err(error) = data_format::migrate(&app.path().app_data_dir()?) {
                log::error!("перенос данных приложения не закончен: {error}");
            }
            agent::start_terminals(app.handle());
            links::main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            links::open_link,
            updates::app_version,
            updates::app_update_check,
            updates::app_update_install,
            unlock::app_unlock,
            language::app_set_language,
            projects::transport::projects_list,
            projects::transport::projects_add,
            projects::transport::projects_remove,
            agent::transport::agent_sessions,
            agent::transport::agent_session_new,
            agent::transport::agent_session_delete,
            agent::transport::agent_session_rename,
            agent::transport::agent_claude_status,
            agent::transport::agent_integrations,
            agent::transport::agent_integration_install,
            agent::transport::agent_integration_remove,
            agent::transport::terminal_open,
            agent::transport::terminal_start,
            agent::transport::terminal_write,
            agent::transport::terminal_resize,
            agent::transport::terminal_close,
            forge::transport::forge_status,
            forge::transport::forge_connect,
            forge::transport::forge_disconnect,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Терминалы без приложения никто не увидит.
            if let RunEvent::Exit = event {
                agent::stop_terminals(app);
            }
        });
}
