// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args().skip(1);

    // Claude Code запускает приложение сервером MCP для чата по подписке.
    if args.next().as_deref() == Some("mcp") {
        std::process::exit(sapien_lib::mcp(args.next()));
    }

    sapien_lib::run()
}
