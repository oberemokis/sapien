mod commands;
mod data_format;
mod events;
mod language;
mod links;
mod menu;
mod unlock;
mod updates;

use sapien_forge::{AccountsFile, Http, Secrets};
use tauri::Manager;
use tauri_specta::{ErrorHandlingMode, collect_commands, collect_events};

/// Команды и события окна. По этому же списку тест пишет их типы
/// в `packages/ipc/src/bindings.gen.ts`.
fn bindings() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        // Отказ команды бросается, как у invoke: иначе TanStack Query
        // принял бы его за ответ.
        .error_handling(ErrorHandlingMode::Throw)
        .commands(collect_commands![
            links::open_link,
            updates::updates_version,
            updates::updates_check,
            updates::updates_install,
            unlock::security_unlock,
            language::appearance_set_language,
            commands::forge::forge_status,
            commands::forge::forge_connect,
            commands::forge::forge_disconnect,
        ])
        .events(collect_events![events::MenuSettings])
        // Коды отказов по доменам. В AppError код строкой, а с этими
        // объединениями окно сверяет свои подсказки.
        .typ::<sapien_forge::ForgeCode>()
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
    // appearance_set_language, когда окно открылось.
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
            // Хранилища доменов собираются один раз, команды берут их
            // из State.
            app.manage(AccountsFile::new(&data_dir));
            links::main_window(app)?;
            Ok(())
        })
        .invoke_handler(invoke)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
