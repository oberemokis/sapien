mod commands;
mod data_format;
mod events;
mod language;
mod links;
mod menu;
mod unlock;
mod updates;
mod workspace;

use sapien_forge::{AccountsFile, Http, Secrets};
use sapien_projects::ProjectsFile;
use tauri::{Manager, RunEvent};
use tauri_specta::{ErrorHandlingMode, collect_commands, collect_events};
use workspace::Workspace;

/// `sapien hook <агент>`: хук агента в панели сообщает приложению её
/// разговор и сразу выходит, окна не открывает.
pub fn hook() {
    commands::agents::hook(&std::env::args().nth(2).unwrap_or_default());
}

/// Команды и события окна. По этому же списку тест пишет их типы
/// в `packages/ipc/src/bindings.gen.ts`.
fn bindings() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        // Отказ команды бросается, как у invoke: иначе TanStack Query
        // принял бы его за ответ.
        .error_handling(ErrorHandlingMode::Throw)
        .commands(collect_commands![
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
        .events(collect_events![
            events::SessionsChanged,
            events::TerminalExited,
            events::MenuSettings,
        ])
        // Коды отказов по доменам. В AppError код строкой, а с этими
        // объединениями окно сверяет свои подсказки.
        .typ::<sapien_agents::AgentsCode>()
        .typ::<sapien_forge::ForgeCode>()
        .typ::<sapien_projects::ProjectsCode>()
        .typ::<sapien_sessions::SessionsCode>()
        .typ::<sapien_workspace::TerminalCode>()
        .typ::<language::LanguageCode>()
        .typ::<links::LinkCode>()
        .typ::<unlock::UnlockCode>()
        .typ::<updates::UpdateCode>()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bindings = bindings();
    let invoke = bindings.invoke_handler();

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
        .setup(move |app| {
            // Раньше всего, что шлёт события: без реестра событие роняет
            // поток, который его послал.
            bindings.mount_events(app);

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
        .invoke_handler(invoke)
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Терминалы без приложения никто не увидит.
            if let (RunEvent::Exit, Some(workspace)) = (event, app.try_state::<Workspace>()) {
                workspace.stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use specta_typescript::Typescript;
    use std::fs;
    use std::path::Path;

    /// Типы, команды и события окна пишутся заново из Rust. Файл лежит
    /// в репозитории: если в коммите он другой, тест переписывает его
    /// и падает, а CI видит, что окно отстало от Rust.
    #[test]
    fn привязки_окна_совпадают_с_rust() {
        let committed =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/ipc/src/bindings.gen.ts");
        let dir = tempfile::tempdir().unwrap();
        let fresh = dir.path().join("bindings.gen.ts");

        super::bindings()
            .export(
                Typescript::default()
                    .header("// Пишет Rust: cargo test -p sapien, руками не править.\n"),
                &fresh,
            )
            .unwrap();

        let fresh = fs::read_to_string(fresh).unwrap();

        if fs::read_to_string(&committed).ok().as_deref() != Some(&fresh) {
            fs::write(&committed, &fresh).unwrap();
            panic!("bindings.gen.ts отстал от Rust и переписан: закоммить его");
        }
    }
}
