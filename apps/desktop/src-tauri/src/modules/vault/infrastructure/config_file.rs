use crate::durable;
use crate::error::AppError;
use crate::modules::vault::ports::VaultPlace;
use std::fs;
use std::path::{Path, PathBuf};

/// Путь к хранилищу лежит файлом в папке настроек приложения. Это настройка
/// устройства: в самом хранилище её нет, и облачный диск не унесёт её на
/// другой компьютер, где папка лежит иначе.
pub struct ConfigFile {
    file: PathBuf,
}

impl ConfigFile {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            file: config_dir.join("vault-path"),
        }
    }
}

impl VaultPlace for ConfigFile {
    fn load(&self) -> Option<PathBuf> {
        let path = fs::read_to_string(&self.file).ok()?;

        // Путь хранится как есть, без перевода строки: имя папки может
        // кончаться пробелом, и обрезка его бы потеряла.
        (!path.is_empty()).then(|| PathBuf::from(path))
    }

    fn save(&self, path: &Path) -> Result<(), AppError> {
        let text = path
            .to_str()
            .ok_or(AppError::unavailable("vault_path_not_utf8"))?;

        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|_| AppError::unavailable("config_unwritable"))?;
        }

        durable::write(&self.file, text.as_bytes())
            .map_err(|_| AppError::unavailable("config_unwritable"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn путь_переживает_перезапуск_как_есть() {
        let dir = tempfile::tempdir().unwrap();
        let place = ConfigFile::new(&dir.path().join("sapien"));

        assert_eq!(place.load(), None);

        place.save(Path::new("/Users/me/Заметки ")).unwrap();

        assert_eq!(
            ConfigFile::new(&dir.path().join("sapien")).load(),
            Some(PathBuf::from("/Users/me/Заметки "))
        );
    }
}
