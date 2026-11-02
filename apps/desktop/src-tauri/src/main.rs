fn main() {
    // Claude Code терминала зовёт приложение своим хуком.
    if std::env::args().nth(1).as_deref() == Some("hook") {
        return sapien_lib::hook();
    }

    sapien_lib::run()
}
