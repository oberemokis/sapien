use serde::Serialize;
use std::cmp::Ordering;

/// Строка дерева хранилища. Путь относительный от корня хранилища и всегда
/// через `/`: по нему интерфейс узнаёт файл и на macOS, и на Windows.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Entry {
    Folder {
        name: String,
        path: String,
        children: Vec<Entry>,
    },
    Note {
        name: String,
        path: String,
    },
}

impl Entry {
    fn name(&self) -> &str {
        match self {
            Entry::Folder { name, .. } | Entry::Note { name, .. } => name,
        }
    }

    fn is_folder(&self) -> bool {
        matches!(self, Entry::Folder { .. })
    }
}

/// Скрытое не показывается, как в Obsidian: `.obsidian`, `.git`, `.DS_Store`.
pub fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Заметка это файл `.md`. Вложения и прочие файлы дерево пока не показывает.
pub fn is_note(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(stem, extension)| !stem.is_empty() && extension.eq_ignore_ascii_case("md"))
}

/// Папки сверху, внутри групп по имени без учёта регистра.
pub fn sort_entries(entries: &mut [Entry]) {
    entries.sort_by(|a, b| match (a.is_folder(), b.is_folder()) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a
            .name()
            .to_lowercase()
            .cmp(&b.name().to_lowercase())
            .then_with(|| a.name().cmp(b.name())),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(name: &str) -> Entry {
        Entry::Note {
            name: name.into(),
            path: name.into(),
        }
    }

    fn folder(name: &str) -> Entry {
        Entry::Folder {
            name: name.into(),
            path: name.into(),
            children: vec![],
        }
    }

    #[test]
    fn заметка_это_только_md_с_именем() {
        assert!(is_note("план.md"));
        assert!(is_note("План.MD"));
        assert!(is_note("v1.2.md"));
        assert!(!is_note(".md"));
        assert!(!is_note("схема.png"));
        assert!(!is_note("md"));
    }

    #[test]
    fn папки_сверху_и_по_имени_без_регистра() {
        let mut entries = vec![
            note("б.md"),
            folder("Яблоки"),
            note("А.md"),
            folder("архив"),
        ];

        sort_entries(&mut entries);

        let names: Vec<_> = entries.iter().map(Entry::name).collect();
        assert_eq!(names, ["архив", "Яблоки", "А.md", "б.md"]);
    }
}
