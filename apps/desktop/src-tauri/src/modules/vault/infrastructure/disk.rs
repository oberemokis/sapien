use crate::durable;
use crate::error::AppError;
use crate::modules::vault::domain::{Entry, EntryKind, is_hidden, is_note, sort_entries};
use crate::modules::vault::ports::VaultDisk;
use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::path::Path;
use trash::TrashContext;

pub struct Disk;

impl VaultDisk for Disk {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn list(&self, root: &Path) -> Result<Vec<Entry>, AppError> {
        let items = fs::read_dir(root).map_err(|_| AppError::unavailable("vault_unreadable"))?;

        Ok(walk(items, ""))
    }

    fn create(&self, path: &Path, kind: EntryKind) -> Result<(), AppError> {
        // create_new и create_dir падают на занятом месте, а не перезаписывают:
        // проверка «есть ли такое» отдельно от создания проиграла бы гонку
        // с правкой снаружи.
        let created = match kind {
            EntryKind::Note => OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map(drop),
            EntryKind::Folder => fs::create_dir(path),
        };

        created.map_err(|error| match error.kind() {
            ErrorKind::AlreadyExists => AppError::conflict("name_taken"),
            ErrorKind::NotFound => AppError::not_found("parent_missing"),
            _ => AppError::unavailable("vault_unwritable"),
        })
    }

    fn read(&self, path: &Path) -> Result<String, AppError> {
        fs::read_to_string(path).map_err(|error| match error.kind() {
            ErrorKind::NotFound => AppError::not_found("note_missing"),
            _ => AppError::unavailable("note_unreadable"),
        })
    }

    fn write(&self, path: &Path, text: &str, base: Option<&str>) -> Result<(), AppError> {
        if !path.is_file() {
            return Err(AppError::not_found("note_missing"));
        }

        // ponytail: между сравнением и подменой правка снаружи может успеть
        // проскочить, окно тут в миллисекунды. Закрыть его совсем можно только
        // блокировкой файла, которую соблюдают и чужие редакторы.
        if let Some(base) = base
            && self.read(path)? != base
        {
            return Err(AppError::conflict("note_conflict"));
        }

        durable::write(path, text.as_bytes()).map_err(|_| AppError::unavailable("note_unwritable"))
    }

    fn trash(&self, path: &Path) -> Result<(), AppError> {
        if !path.exists() {
            return Err(AppError::not_found("entry_missing"));
        }

        let mut bin = TrashContext::default();

        // Через Finder корзина просит у человека права управлять Finder,
        // NSFileManager кладёт туда же без вопросов.
        #[cfg(target_os = "macos")]
        {
            use trash::macos::{DeleteMethod, TrashContextExtMacos};

            bin.set_delete_method(DeleteMethod::NsFileManager);
        }

        bin.delete(path)
            .map_err(|_| AppError::unavailable("trash_failed"))
    }
}

// ponytail: обход целиком на каждый запрос, на хранилищах в десятки тысяч
// файлов понадобится кеш дерева с правкой по событиям слежения.
fn walk(items: fs::ReadDir, prefix: &str) -> Vec<Entry> {
    let mut entries = Vec::new();

    for item in items.flatten() {
        // Имя не в UTF-8 интерфейс всё равно не покажет и не пришлёт обратно.
        let Ok(name) = item.file_name().into_string() else {
            continue;
        };

        if is_hidden(&name) {
            continue;
        }

        let path = match prefix {
            "" => name.clone(),
            _ => format!("{prefix}/{name}"),
        };

        // Тип без перехода по ссылке: ссылка на папку выше по дереву
        // зациклила бы обход, поэтому символические ссылки пока не видны.
        let Ok(kind) = item.file_type() else {
            continue;
        };

        if kind.is_dir() {
            // Папка, которую не дали прочитать, остаётся в дереве пустой:
            // одна закрытая папка не должна прятать всё хранилище.
            let children = fs::read_dir(item.path())
                .map(|items| walk(items, &path))
                .unwrap_or_default();

            entries.push(Entry::Folder {
                name,
                path,
                children,
            });
        } else if kind.is_file() && is_note(&name) {
            entries.push(Entry::Note { name, path });
        }
    }

    sort_entries(&mut entries);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn дерево_из_заметок_и_папок_без_скрытого() {
        let root = tempfile::tempdir().unwrap();
        let at = |path: &str| root.path().join(path);

        fs::create_dir_all(at("Проекты/sapien")).unwrap();
        fs::create_dir_all(at(".obsidian")).unwrap();
        fs::write(at("Проекты/sapien/план.md"), "").unwrap();
        fs::write(at("входящие.md"), "").unwrap();
        fs::write(at("схема.png"), "").unwrap();
        fs::write(at(".obsidian/app.json"), "").unwrap();

        let tree = Disk.list(root.path()).unwrap();

        assert_eq!(
            tree,
            vec![
                Entry::Folder {
                    name: "Проекты".into(),
                    path: "Проекты".into(),
                    children: vec![Entry::Folder {
                        name: "sapien".into(),
                        path: "Проекты/sapien".into(),
                        children: vec![Entry::Note {
                            name: "план.md".into(),
                            path: "Проекты/sapien/план.md".into(),
                        }],
                    }],
                },
                Entry::Note {
                    name: "входящие.md".into(),
                    path: "входящие.md".into(),
                },
            ]
        );
    }

    #[test]
    fn нечитаемый_корень_это_ошибка() {
        let root = tempfile::tempdir().unwrap();

        assert_eq!(
            Disk.list(&root.path().join("нет")),
            Err(AppError::unavailable("vault_unreadable"))
        );
    }

    #[test]
    fn занятое_имя_не_перезаписывается() {
        let root = tempfile::tempdir().unwrap();
        let note = root.path().join("план.md");
        fs::write(&note, "важное").unwrap();

        assert_eq!(
            Disk.create(&note, EntryKind::Note),
            Err(AppError::conflict("name_taken"))
        );
        assert_eq!(fs::read_to_string(&note).unwrap(), "важное");
        assert_eq!(
            Disk.create(&root.path().join("план.md"), EntryKind::Folder),
            Err(AppError::conflict("name_taken"))
        );
    }

    #[test]
    fn запись_заменяет_текст_и_не_оставляет_временного_файла() {
        let root = tempfile::tempdir().unwrap();
        let note = root.path().join("план.md");
        fs::write(&note, "было").unwrap();

        Disk.write(&note, "стало", Some("было")).unwrap();

        assert_eq!(Disk.read(&note), Ok("стало".into()));
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn правка_снаружи_не_затирается_без_спроса() {
        let root = tempfile::tempdir().unwrap();
        let note = root.path().join("план.md");
        fs::write(&note, "правка снаружи").unwrap();

        assert_eq!(
            Disk.write(&note, "моя правка", Some("было")),
            Err(AppError::conflict("note_conflict"))
        );
        assert_eq!(Disk.read(&note), Ok("правка снаружи".into()));

        Disk.write(&note, "моя правка", None).unwrap();
        assert_eq!(Disk.read(&note), Ok("моя правка".into()));
    }

    // Настоящую корзину тест не трогает: прогон складывал бы файлы
    // в корзину человека.
    #[test]
    fn пропавшее_в_корзину_не_уходит() {
        let root = tempfile::tempdir().unwrap();
        let note = root.path().join("план.md");

        assert_eq!(Disk.trash(&note), Err(AppError::not_found("entry_missing")));
    }

    #[cfg(unix)]
    #[test]
    fn неудачная_запись_оставляет_прежний_текст() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let note = root.path().join("план.md");
        fs::write(&note, "было").unwrap();
        let lock = |mode| fs::set_permissions(root.path(), fs::Permissions::from_mode(mode));

        lock(0o555).unwrap();
        let written = Disk.write(&note, "стало", None);
        lock(0o755).unwrap();

        assert_eq!(written, Err(AppError::unavailable("note_unwritable")));
        assert_eq!(Disk.read(&note), Ok("было".into()));
    }

    #[test]
    fn пропавшая_заметка_не_создаётся_заново() {
        let root = tempfile::tempdir().unwrap();
        let note = root.path().join("план.md");

        assert_eq!(Disk.read(&note), Err(AppError::not_found("note_missing")));
        assert_eq!(
            Disk.write(&note, "текст", None),
            Err(AppError::not_found("note_missing"))
        );
        assert!(!note.exists());
    }

    #[test]
    fn создаёт_пустую_заметку_и_папку() {
        let root = tempfile::tempdir().unwrap();

        Disk.create(&root.path().join("Встречи"), EntryKind::Folder)
            .unwrap();
        Disk.create(&root.path().join("Встречи/итоги.md"), EntryKind::Note)
            .unwrap();

        assert_eq!(
            fs::read_to_string(root.path().join("Встречи/итоги.md")).unwrap(),
            ""
        );
        assert_eq!(
            Disk.create(&root.path().join("нет/план.md"), EntryKind::Note),
            Err(AppError::not_found("parent_missing"))
        );
    }
}
