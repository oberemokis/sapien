use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// Что создают в дереве.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Folder,
    Note,
}

/// Символы, которые запрещает хоть одна система. Хранилище переезжает между
/// macOS и Windows облачным диском, и имя должно пережить обе.
const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Проверка имени нового элемента. Код ошибки тот же, что у проверки в окне:
/// окно подсказывает заранее, а здесь последнее слово.
pub fn check_name(name: &str) -> Result<(), &'static str> {
    if name.trim().is_empty() {
        return Err("name_empty");
    }

    if name
        .chars()
        .any(|c| FORBIDDEN.contains(&c) || c.is_control())
    {
        return Err("name_forbidden");
    }

    // Имя с точки дерево прячет, и созданный элемент тут же бы пропал.
    if is_hidden(name) {
        return Err("name_hidden");
    }

    Ok(())
}

/// Имя файла заметки: `.md` дописывается, если человек его не написал.
pub fn note_file_name(name: &str) -> String {
    if is_note(name) {
        name.to_owned()
    } else {
        format!("{name}.md")
    }
}

/// Путь папки из окна. Только части с допустимыми именами через `/`, без
/// `..` и без корня диска: путь не может выйти за пределы хранилища.
/// Пустая строка это корень хранилища.
pub fn parse_folder_path(path: &str) -> Option<&str> {
    let valid = path.is_empty() || path.split('/').all(|part| check_name(part).is_ok());

    valid.then_some(path)
}

/// Путь заметки из окна: папки как у `parse_folder_path` и файл `.md`
/// в конце. Окно не может прочитать или переписать файл вне хранилища
/// или не заметку.
pub fn parse_note_path(path: &str) -> Option<&str> {
    let (folder, name) = path.rsplit_once('/').unwrap_or(("", path));
    let valid = parse_folder_path(folder).is_some() && check_name(name).is_ok() && is_note(name);

    valid.then_some(path)
}

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

/// Пути всех заметок дерева, с заметками во всех папках.
pub fn note_paths(entries: &[Entry]) -> Vec<String> {
    entries
        .iter()
        .flat_map(|entry| match entry {
            Entry::Folder { children, .. } => note_paths(children),
            Entry::Note { path, .. } => vec![path.clone()],
        })
        .collect()
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

    #[test]
    fn имя_проверяется_так_же_как_в_окне() {
        assert_eq!(check_name("Встреча 31.10"), Ok(()));
        assert_eq!(check_name("   "), Err("name_empty"));
        assert_eq!(check_name("a/b"), Err("name_forbidden"));
        assert_eq!(check_name("итоги: октябрь"), Err("name_forbidden"));
        assert_eq!(check_name("строка\nвторая"), Err("name_forbidden"));
        assert_eq!(check_name(".скрытое"), Err("name_hidden"));
    }

    #[test]
    fn md_дописывается_один_раз() {
        assert_eq!(note_file_name("план"), "план.md");
        assert_eq!(note_file_name("план.md"), "план.md");
        assert_eq!(note_file_name("v1.2"), "v1.2.md");
    }

    #[test]
    fn путь_папки_не_выходит_за_хранилище() {
        assert_eq!(parse_folder_path(""), Some(""));
        assert_eq!(parse_folder_path("Проекты/sapien"), Some("Проекты/sapien"));
        assert_eq!(parse_folder_path("../соседи"), None);
        assert_eq!(parse_folder_path("Проекты/../.."), None);
        assert_eq!(parse_folder_path("/etc"), None);
        assert_eq!(parse_folder_path("C:\\Windows"), None);
        assert_eq!(parse_folder_path("Проекты//sapien"), None);
    }

    #[test]
    fn путь_заметки_только_к_md_внутри_хранилища() {
        assert_eq!(parse_note_path("план.md"), Some("план.md"));
        assert_eq!(
            parse_note_path("Проекты/sapien/план.md"),
            Some("Проекты/sapien/план.md")
        );
        assert_eq!(parse_note_path("../план.md"), None);
        assert_eq!(parse_note_path("/etc/hosts.md"), None);
        assert_eq!(parse_note_path("Проекты/схема.png"), None);
        assert_eq!(parse_note_path(".obsidian/app.md"), None);
        assert_eq!(parse_note_path(""), None);
    }
}
