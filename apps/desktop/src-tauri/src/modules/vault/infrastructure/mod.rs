pub mod config_file;
pub mod disk;
pub mod history_dir;
pub mod journal_dir;
pub mod watcher;

/// Имя файла или папки из пути: хранилища и заметки в папке данных
/// приложения раскладываются по хешу своего пути. FNV-1a, потому что хеш
/// стандартной библиотеки меняется от версии к версии Rust, и после
/// обновления приложение потеряло бы свои файлы.
fn file_key(text: &str) -> String {
    let hash = text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });

    format!("{hash:016x}")
}
