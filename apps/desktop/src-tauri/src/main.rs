// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude Code терминала зовёт приложение своим хуком.
    if std::env::args().nth(1).as_deref() == Some("hook") {
        return sapien_lib::hook();
    }

    sapien_lib::run()
}
