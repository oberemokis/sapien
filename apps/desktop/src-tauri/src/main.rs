fn main() {
    // Хук агента в панели зовёт само приложение.
    if std::env::args().nth(1).as_deref() == Some("hook") {
        return sapien_lib::hook();
    }

    sapien_lib::run()
}
