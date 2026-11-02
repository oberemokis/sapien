use crate::modules::agent::ports::Projects;
use crate::modules::projects;
use std::path::PathBuf;
use tauri::AppHandle;

/// Проекты из списка модуля projects.
pub struct ProjectFolders(pub AppHandle);

impl Projects for ProjectFolders {
    fn folder(&self, id: &str) -> Option<PathBuf> {
        projects::transport::folder(&self.0, id)
    }
}
