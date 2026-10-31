use crate::durable;
use crate::error::AppError;
use crate::modules::youtrack::domain::Sent;
use crate::modules::youtrack::ports::Ledger;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Опубликованное лежит одним файлом в папке данных приложения: номер
/// задачи и что в неё ушло. В хранилище его нет, это память приложения,
/// а не заметки.
pub struct SentFile {
    file: PathBuf,
}

impl SentFile {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            file: data_dir.join("youtrack-sent.json"),
        }
    }

    /// Испорченный или пропавший файл это пустая память: задачи сверятся
    /// с YouTrack так, будто их публиковали с другого устройства.
    fn all(&self) -> BTreeMap<String, Sent> {
        fs::read(&self.file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
}

impl Ledger for SentFile {
    fn load(&self, id: &str) -> Option<Sent> {
        self.all().remove(id)
    }

    fn save(&self, id: &str, sent: &Sent) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable("youtrack_sent_unwritable");
        let mut all = self.all();

        all.insert(id.to_owned(), sent.clone());

        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(unwritable)?;
        }

        let bytes = serde_json::to_vec(&all)
            .map_err(|_| AppError::unavailable("youtrack_sent_unwritable"))?;

        durable::write(&self.file, &bytes).map_err(unwritable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::youtrack::domain::Field;

    #[test]
    fn опубликованное_помнится_по_номеру_задачи() {
        let dir = tempfile::tempdir().unwrap();
        let ledger = SentFile::new(dir.path());
        let sent = Sent {
            summary: "Вход по ссылке".into(),
            description: "Письмо со ссылкой".into(),
            fields: vec![Field {
                name: "Priority".into(),
                value: "Major".into(),
            }],
        };

        assert_eq!(ledger.load("SAP-1"), None);

        ledger.save("SAP-1", &sent).unwrap();
        ledger.save("SAP-2", &sent).unwrap();

        assert_eq!(SentFile::new(dir.path()).load("SAP-1"), Some(sent));
    }
}
