use super::domain::Entry;
use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Где приложение помнит выбранную папку между запусками.
pub trait VaultPlace {
    fn load(&self) -> Option<PathBuf>;
    fn save(&self, path: &Path) -> Result<(), AppError>;
}

/// Папка хранилища на диске.
pub trait VaultDisk {
    fn is_dir(&self, path: &Path) -> bool;
    fn list(&self, root: &Path) -> Result<Vec<Entry>, AppError>;
}
