//! Порты агента на соседних модулях: заметки идут через сценарии
//! хранилища, задачи через сценарии YouTrack.

use crate::error::AppError;
use crate::modules::agent::ports::{Notes, Tracker};
use crate::modules::{vault, youtrack};
use tauri::{AppHandle, Runtime};

pub struct VaultNotes<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> Notes for VaultNotes<R> {
    fn open(&self, path: &str) -> bool {
        vault::transport::open_to_agent(&self.0, path)
    }

    fn paths(&self) -> Result<Vec<String>, AppError> {
        vault::transport::note_paths(&self.0)
    }

    fn texts(&self) -> Result<Vec<(String, String)>, AppError> {
        Ok(vault::transport::note_texts(&self.0)?
            .into_iter()
            .map(|note| (note.path, note.text))
            .collect())
    }

    fn read(&self, path: &str) -> Result<String, AppError> {
        vault::transport::read_note(&self.0, path)
    }

    fn put(&self, path: &str, text: &str) -> Result<(), AppError> {
        vault::transport::put_note(&self.0, path, text)
    }

    fn revert(&self, path: &str, before: Option<&str>) -> Result<(), AppError> {
        vault::transport::revert_note(&self.0, path, before)
    }
}

pub struct YoutrackIssues<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> Tracker for YoutrackIssues<R> {
    async fn search(&self, query: &str) -> Result<String, AppError> {
        youtrack::transport::search_issues(&self.0, query).await
    }

    async fn issue(&self, id: &str) -> Result<String, AppError> {
        youtrack::transport::issue(&self.0, id).await
    }

    async fn epic_changes(&self, epic: &str, since: &str) -> Result<String, AppError> {
        youtrack::transport::epic_changes(&self.0, epic, since).await
    }
}
