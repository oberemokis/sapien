use super::domain::{Entry, EntryKind, Unsaved};
use crate::error::AppError;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Где приложение помнит выбранную папку между запусками.
pub trait VaultPlace {
    fn load(&self) -> Option<PathBuf>;
    fn save(&self, path: &Path) -> Result<(), AppError>;
}

/// Папка хранилища на диске.
pub trait VaultDisk {
    fn is_dir(&self, path: &Path) -> bool;
    fn list(&self, root: &Path) -> Result<Vec<Entry>, AppError>;
    /// Создаёт пустую заметку или папку. Занятое место не трогает, а отвечает
    /// конфликтом.
    fn create(&self, path: &Path, kind: EntryKind) -> Result<(), AppError>;
    fn read(&self, path: &Path) -> Result<String, AppError>;
    /// Переписывает существующую заметку. Пропавшую не создаёт заново,
    /// а отвечает, что её нет. С `base` пишет, только если в файле всё ещё
    /// этот текст, иначе отвечает конфликтом: файл изменили снаружи.
    fn write(&self, path: &Path, text: &str, base: Option<&str>) -> Result<(), AppError>;
    /// Убирает заметку или папку в системную корзину, откуда её можно вернуть.
    fn trash(&self, path: &Path) -> Result<(), AppError>;
}

/// Журнал восстановления: правки, которые не дошли до файла, по хранилищам.
/// Он переживает падение приложения, и при следующем запуске правки
/// предлагается вернуть.
pub trait Journal {
    fn put(&self, vault: &Path, unsaved: &Unsaved) -> Result<(), AppError>;
    fn remove(&self, vault: &Path, path: &str);
    /// Записи хранилища и сколько им лет.
    fn list(&self, vault: &Path) -> Vec<(Unsaved, Duration)>;
}
