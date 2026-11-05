use serde::Serialize;
use specta::Type;
use std::path::Path;

/// Проект: папка на диске, в которой работает агент. Имя это имя папки.
/// `missing`: папки сейчас нет на диске, её убрали или переименовали.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub missing: bool,
}

impl Project {
    pub fn at(id: String, path: String, missing: bool) -> Self {
        let name = Path::new(&path)
            .file_name()
            .map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned());

        Self {
            id,
            name,
            path,
            missing,
        }
    }
}
