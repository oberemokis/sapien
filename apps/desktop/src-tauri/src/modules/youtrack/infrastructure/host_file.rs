use crate::durable;
use crate::error::AppError;
use crate::modules::youtrack::ports::HostPlace;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Адрес сервера лежит файлом в папке настроек приложения, рядом с путём
/// к хранилищу. Токена в файле нет.
pub struct HostFile {
    file: PathBuf,
}

impl HostFile {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            file: config_dir.join("youtrack-host"),
        }
    }
}

impl HostPlace for HostFile {
    fn load(&self) -> Option<String> {
        let host = fs::read_to_string(&self.file).ok()?;

        (!host.is_empty()).then_some(host)
    }

    fn save(&self, host: &str) -> Result<(), AppError> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|_| AppError::unavailable("config_unwritable"))?;
        }

        durable::write(&self.file, host.as_bytes())
            .map_err(|_| AppError::unavailable("config_unwritable"))
    }

    fn clear(&self) -> Result<(), AppError> {
        match fs::remove_file(&self.file) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                Err(AppError::unavailable("config_unwritable"))
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn адрес_переживает_перезапуск_и_забывается() {
        let dir = tempfile::tempdir().unwrap();
        let place = HostFile::new(&dir.path().join("sapien"));

        place.save("https://acme.youtrack.cloud").unwrap();
        assert_eq!(
            HostFile::new(&dir.path().join("sapien")).load().as_deref(),
            Some("https://acme.youtrack.cloud")
        );

        place.clear().unwrap();
        place.clear().unwrap();
        assert_eq!(place.load(), None);
    }
}
