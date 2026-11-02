use super::domain::Project;
use super::ports::Shelf;
use crate::durable;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Список проектов: `projects.json` в папке данных приложения, внутри
/// `[{ "id", "path" }]` по порядку добавления. Имя и пропажу папки файл
/// не держит: они берутся с диска при чтении.
pub struct ProjectsFile {
    file: PathBuf,
}

impl ProjectsFile {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            file: data_dir.join("projects.json"),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Saved {
    id: String,
    path: String,
}

impl Shelf for ProjectsFile {
    fn load(&self) -> Result<Vec<Project>, AppError> {
        let unreadable = |_| AppError::unavailable("projects_unreadable");
        let bytes = match fs::read(&self.file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(unreadable(error)),
        };
        let saved: Vec<Saved> = serde_json::from_slice(&bytes)
            .map_err(|_| AppError::unavailable("projects_unreadable"))?;

        Ok(saved
            .into_iter()
            .map(|saved| {
                let missing = !Path::new(&saved.path).is_dir();

                Project::at(saved.id, saved.path, missing)
            })
            .collect())
    }

    fn save(&self, projects: &[Project]) -> Result<(), AppError> {
        let unwritable = |_| AppError::unavailable("projects_unwritable");
        let saved: Vec<Saved> = projects
            .iter()
            .map(|project| Saved {
                id: project.id.clone(),
                path: project.path.clone(),
            })
            .collect();
        let bytes =
            serde_json::to_vec(&saved).map_err(|_| AppError::unavailable("projects_unwritable"))?;

        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(unwritable)?;
        }

        durable::write(&self.file, &bytes).map_err(unwritable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn список_переживает_перезапуск_а_пропажа_папки_видна_с_диска() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Мой проект");
        let gone = dir.path().join("старый");
        let shelf = ProjectsFile::new(&dir.path().join("data"));
        let path = |path: &Path| path.to_string_lossy().into_owned();

        fs::create_dir(&folder).unwrap();
        assert_eq!(shelf.load(), Ok(vec![]));

        shelf
            .save(&[
                Project::at("a".into(), path(&folder), false),
                Project::at("b".into(), path(&gone), false),
            ])
            .unwrap();

        let loaded = ProjectsFile::new(&dir.path().join("data")).load().unwrap();

        assert_eq!(
            loaded,
            [
                Project {
                    id: "a".into(),
                    name: "Мой проект".into(),
                    path: path(&folder),
                    missing: false,
                },
                Project {
                    id: "b".into(),
                    name: "старый".into(),
                    path: path(&gone),
                    missing: true,
                },
            ]
        );
    }
}
