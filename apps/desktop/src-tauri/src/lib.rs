mod data_format;
mod durable;
mod egress;
mod error;
mod links;
#[cfg(target_os = "macos")]
mod menu;
mod modules;
mod secrets;
mod unlock;
mod updates;

use modules::{actions, agent, forge, projects};
use tauri::Manager;

/// `sapien mcp <сокет>`: так Claude Code запускает сервер MCP sapien.
/// Процесс без окна только перекачивает stdio в сокет открытого
/// приложения, вопросы и разрешения разбирает оно. Код выхода для `exit`.
pub fn mcp(socket: Option<String>) -> i32 {
    #[cfg(unix)]
    if let Some(socket) = socket {
        let done = agent::bridge(
            std::path::Path::new(&socket),
            std::io::stdin(),
            std::io::stdout(),
        );

        return i32::from(done.is_err());
    }

    let _ = socket;
    1
}

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
        // Ссылки окна открывает только links.rs: скрипт плагина, который
        // перехватывает клики по ссылкам, окну не нужен.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Pending::default())
        .manage(secrets::Secrets::default())
        .manage(forge::Http::default())
        .manage(agent::Running::default())
        .setup(|app| {
            // До окна: никто не должен прочитать файлы приложения
            // в прежнем формате. Отказ не держит запуск, шаг повторится
            // при следующем.
            if let Err(error) = data_format::migrate(&app.path().app_data_dir()?) {
                log::error!("перенос данных приложения не закончен: {error}");
            }
            links::main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            links::open_link,
            updates::app_version,
            updates::app_update_check,
            updates::app_update_install,
            unlock::app_unlock,
            projects::transport::projects_list,
            projects::transport::projects_add,
            projects::transport::projects_remove,
            agent::transport::agent_sessions,
            agent::transport::agent_session_new,
            agent::transport::agent_session_delete,
            agent::transport::agent_history,
            agent::transport::agent_send,
            agent::transport::agent_running,
            agent::transport::agent_attach,
            agent::transport::agent_answer,
            agent::transport::agent_stop,
            agent::transport::agent_claude_status,
            agent::transport::agent_providers,
            agent::transport::agent_commands,
            actions::transport::actions_list,
            actions::transport::actions_create,
            actions::transport::actions_write,
            actions::transport::actions_delete,
            forge::transport::forge_status,
            forge::transport::forge_connect,
            forge::transport::forge_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
