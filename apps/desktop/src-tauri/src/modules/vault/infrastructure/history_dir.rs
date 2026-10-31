use crate::durable::file_key;
use crate::error::AppError;
use crate::modules::vault::domain::{Source, Version};
use crate::modules::vault::ports::History;
use crate::sealed;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Путь заметки лежит рядом с её версиями: по хешу его не восстановить,
/// а удалённую заметку надо найти по имени.
const PATH_FILE: &str = "path";

/// Версии лежат в папке данных приложения, а не в хранилище. Папка
/// на хранилище, в ней папка на заметку, в ней файл на версию. Текст
/// версий и путь заметки зашифрованы (sealed.rs), имена файлов нет:
/// в них только хеш пути, время и источник.
pub struct HistoryDir {
    dir: PathBuf,
}

impl HistoryDir {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("history"),
        }
    }

    fn vault_dir(&self, vault: &Path) -> PathBuf {
        self.dir.join(file_key(&vault.to_string_lossy()))
    }

    fn note_dir(&self, vault: &Path, path: &str) -> PathBuf {
        self.vault_dir(vault).join(file_key(path))
    }
}

fn source_name(source: Source) -> &'static str {
    match source {
        Source::Edit => "edit",
        Source::Outside => "outside",
        Source::Restore => "restore",
        Source::Trash => "trash",
        Source::Agent => "agent",
        Source::Youtrack => "youtrack",
    }
}

/// Имя файла версии: время снимка и источник, `1730332800000-edit.md`.
fn file_name(version: Version) -> String {
    format!("{}-{}.md", version.id, source_name(version.source))
}

fn parse_version(name: &str) -> Option<Version> {
    let (id, source) = name.strip_suffix(".md")?.split_once('-')?;
    let source = [
        Source::Edit,
        Source::Outside,
        Source::Restore,
        Source::Trash,
        Source::Agent,
        Source::Youtrack,
    ]
    .into_iter()
    .find(|known| source_name(*known) == source)?;

    Some(Version {
        id: id.parse().ok()?,
        source,
    })
}

fn versions_in(dir: &Path) -> Vec<Version> {
    fs::read_dir(dir)
        .map(|items| {
            items
                .flatten()
                .filter_map(|item| parse_version(item.file_name().to_str()?))
                .collect()
        })
        .unwrap_or_default()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

fn age(version: Version) -> Duration {
    Duration::from_millis(now_ms().saturating_sub(version.id))
}

impl History for HistoryDir {
    fn put(&self, vault: &Path, path: &str, source: Source, text: &str) -> Result<(), AppError> {
        let dir = self.note_dir(vault, path);
        let version = Version {
            id: now_ms(),
            source,
        };

        fs::create_dir_all(&dir)
            .and_then(|()| sealed::write(&dir.join(PATH_FILE), path.as_bytes()))
            .and_then(|()| sealed::write(&dir.join(file_name(version)), text.as_bytes()))
            .map_err(|_| AppError::unavailable("history_unwritable"))
    }

    fn list(&self, vault: &Path, path: &str) -> Vec<(Version, Duration)> {
        let mut versions: Vec<_> = versions_in(&self.note_dir(vault, path))
            .into_iter()
            .map(|version| (version, age(version)))
            .collect();

        versions.sort_by_key(|(version, _)| std::cmp::Reverse(version.id));
        versions
    }

    fn read(&self, vault: &Path, path: &str, id: u64) -> Result<String, AppError> {
        let dir = self.note_dir(vault, path);
        let version = versions_in(&dir)
            .into_iter()
            .find(|version| version.id == id)
            .ok_or(AppError::not_found("version_missing"))?;

        sealed::read_to_string(&dir.join(file_name(version)))
            .map_err(|_| AppError::unavailable("version_unreadable"))
    }

    fn notes(&self, vault: &Path) -> Vec<String> {
        let Ok(items) = fs::read_dir(self.vault_dir(vault)) else {
            return Vec::new();
        };

        items
            .flatten()
            .filter_map(|item| sealed::read_to_string(&item.path().join(PATH_FILE)).ok())
            .collect()
    }

    fn prune(&self, vault: &Path, keep: Duration) {
        let Ok(items) = fs::read_dir(self.vault_dir(vault)) else {
            return;
        };

        for dir in items.flatten().map(|item| item.path()) {
            for version in versions_in(&dir) {
                if age(version) > keep {
                    let _ = fs::remove_file(dir.join(file_name(version)));
                }
            }

            // Заметка без версий из истории уходит целиком, с файлом пути.
            if versions_in(&dir).is_empty() {
                let _ = fs::remove_dir_all(&dir);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VAULT: &str = "/Users/me/Заметки";

    #[test]
    fn версии_свежие_первыми_читаются_по_номеру() {
        let data = tempfile::tempdir().unwrap();
        let history = HistoryDir::new(data.path());
        let vault = Path::new(VAULT);

        history.put(vault, "план.md", Source::Edit, "было").unwrap();
        std::thread::sleep(Duration::from_millis(2));
        history
            .put(vault, "план.md", Source::Trash, "стало")
            .unwrap();

        let versions = history.list(vault, "план.md");
        let sources: Vec<_> = versions.iter().map(|(version, _)| version.source).collect();
        assert_eq!(sources, [Source::Trash, Source::Edit]);
        assert_eq!(
            history.read(vault, "план.md", versions[1].0.id),
            Ok("было".into())
        );
        assert_eq!(
            history.read(vault, "план.md", 1),
            Err(AppError::not_found("version_missing"))
        );
        assert_eq!(history.notes(vault), ["план.md"]);
        assert!(
            history
                .list(Path::new("/Users/me/Другое"), "план.md")
                .is_empty()
        );
    }

    #[test]
    fn старые_версии_уходят_и_заметка_без_версий_тоже() {
        let data = tempfile::tempdir().unwrap();
        let history = HistoryDir::new(data.path());
        let vault = Path::new(VAULT);
        // Версия из 1970 года: старше любого срока.
        let old = |path: &str| {
            let dir = history.note_dir(vault, path);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(PATH_FILE), path).unwrap();
            fs::write(dir.join("1000-edit.md"), "давнее").unwrap();
        };

        history
            .put(vault, "план.md", Source::Edit, "свежее")
            .unwrap();
        old("план.md");
        old("старое.md");

        history.prune(vault, Duration::from_secs(60));

        let texts: Vec<_> = history
            .list(vault, "план.md")
            .into_iter()
            .map(|(version, _)| history.read(vault, "план.md", version.id).unwrap())
            .collect();
        assert_eq!(texts, ["свежее"]);
        assert_eq!(history.notes(vault), ["план.md"]);
    }
}
