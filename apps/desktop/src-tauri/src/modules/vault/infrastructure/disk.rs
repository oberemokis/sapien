use crate::error::AppError;
use crate::modules::vault::domain::{Entry, is_hidden, is_note, sort_entries};
use crate::modules::vault::ports::VaultDisk;
use std::fs;
use std::path::Path;

pub struct Disk;

impl VaultDisk for Disk {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn list(&self, root: &Path) -> Result<Vec<Entry>, AppError> {
        let items = fs::read_dir(root).map_err(|_| AppError::unavailable("vault_unreadable"))?;

        Ok(walk(items, ""))
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
}
