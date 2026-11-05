mod commands;
mod data_format;
mod language;
mod links;
mod menu;
mod unlock;
mod updates;
mod workspace;

use sapien_forge::{AccountsFile, Http, Secrets};
use sapien_projects::ProjectsFile;
use tauri::{Manager, RunEvent};
use workspace::Workspace;

/// `sapien hook <агент>`: хук агента в панели сообщает приложению её
/// разговор и сразу выходит, окна не открывает.
pub fn hook() {
    commands::agents::hook(&std::env::args().nth(2).unwrap_or_default());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Меню сначала на английском: язык окна приходит командой
    // app_set_language, когда окно открылось.
    tauri::Builder::default()
        .menu(|app| menu::build(app, language::Language::default()))
        .on_menu_event(menu::handle)
        // Лог в папке логов приложения и в терминале: туда пишутся отказы
        // запросов из egress.rs крейта sapien-forge. Ниже предупреждения
        // не пишется ничего.
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
        .manage(Secrets::default())
        .manage(Http::default())
        .setup(|app| {
            // До окна: никто не должен прочитать файлы приложения
            // в прежнем формате. Отказ не держит запуск, шаг повторится
            // при следующем.
            let data_dir = app.path().app_data_dir()?;

            if let Err(error) = data_format::migrate(&data_dir) {
                log::error!("перенос данных приложения не закончен: {error}");
            }
            // Хранилища доменов и рабочее место собираются один раз,
            // команды берут их из State. До окна: оно сразу поднимает
            // панели открытых вкладок.
            app.manage(ProjectsFile::new(&data_dir));
            app.manage(AccountsFile::new(&data_dir));
            app.manage(workspace::start(app.handle(), &data_dir));
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
            commands::projects::projects_list,
            commands::projects::projects_add,
            commands::projects::projects_remove,
            commands::sessions::agent_sessions,
            commands::sessions::agent_session_new,
            commands::sessions::agent_session_delete,
            commands::sessions::agent_session_rename,
            commands::agents::agent_claude_status,
            commands::agents::agent_integrations,
            commands::agents::agent_integration_install,
            commands::agents::agent_integration_remove,
            commands::terminal::terminal_open,
            commands::terminal::terminal_start,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::forge::forge_status,
            commands::forge::forge_connect,
            commands::forge::forge_disconnect,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Терминалы без приложения никто не увидит.
            if let (RunEvent::Exit, Some(workspace)) = (event, app.try_state::<Workspace>()) {
                workspace.stop();
            }
        });
}
