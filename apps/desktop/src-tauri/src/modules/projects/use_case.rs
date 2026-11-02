use super::domain::Project;
use super::ports::Shelf;
use crate::error::AppError;
use std::path::PathBuf;

pub fn list(shelf: &impl Shelf) -> Result<Vec<Project>, AppError> {
    shelf.load()
}

/// Добавляет папку `path`, которую выбрал человек, проектом `id`. Та же
/// папка уже в списке: это тот же проект, второго не будет.
pub fn add(shelf: &impl Shelf, path: String, id: String) -> Result<Project, AppError> {
    let mut projects = shelf.load()?;

    if let Some(known) = projects.iter().find(|project| project.path == path) {
        return Ok(known.clone());
    }

    let project = Project::at(id, path, false);

    projects.push(project.clone());
    shelf.save(&projects)?;
    Ok(project)
}

/// Убирает проект из списка. Папка на диске остаётся как есть.
pub fn remove(shelf: &impl Shelf, id: &str) -> Result<(), AppError> {
    let mut projects = shelf.load()?;

    projects.retain(|project| project.id != id);
    shelf.save(&projects)
}

/// Папка проекта `id`, в которой будет работать агент. Проекта нет
/// в списке или папки нет на диске: `None`.
pub fn folder(shelf: &impl Shelf, id: &str) -> Option<PathBuf> {
    shelf
        .load()
        .ok()?
        .into_iter()
        .find(|project| project.id == id && !project.missing)
        .map(|project| PathBuf::from(project.path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Список в памяти. Папки «пропавшей» на диске нет.
    #[derive(Default)]
    struct FakeShelf(Mutex<Vec<Project>>);

    impl Shelf for FakeShelf {
        fn load(&self) -> Result<Vec<Project>, AppError> {
            let projects = self.0.lock().unwrap().clone();

            Ok(projects
                .into_iter()
                .map(|project| {
                    let missing = project.path.ends_with("пропавшая");

                    Project::at(project.id, project.path, missing)
                })
                .collect())
        }

        fn save(&self, projects: &[Project]) -> Result<(), AppError> {
            *self.0.lock().unwrap() = projects.to_vec();
            Ok(())
        }
    }

    fn ids(shelf: &FakeShelf) -> Vec<String> {
        list(shelf)
            .unwrap()
            .into_iter()
            .map(|project| project.id)
            .collect()
    }

    #[test]
    fn папка_добавляется_один_раз_по_порядку() {
        let shelf = FakeShelf::default();

        let first = add(&shelf, "/код/sapien".into(), "a".into()).unwrap();

        assert_eq!(
            first,
            Project {
                id: "a".into(),
                name: "sapien".into(),
                path: "/код/sapien".into(),
                missing: false,
            }
        );

        add(&shelf, "/код/сайт".into(), "b".into()).unwrap();

        // Ту же папку выбрали снова: проект прежний.
        assert_eq!(add(&shelf, "/код/sapien".into(), "c".into()), Ok(first));
        assert_eq!(ids(&shelf), ["a", "b"]);
    }

    #[test]
    fn агент_получает_только_папку_на_месте() {
        let shelf = FakeShelf::default();

        add(&shelf, "/код/sapien".into(), "a".into()).unwrap();
        add(&shelf, "/код/пропавшая".into(), "b".into()).unwrap();

        assert!(list(&shelf).unwrap()[1].missing);
        assert_eq!(folder(&shelf, "a"), Some(PathBuf::from("/код/sapien")));
        assert_eq!(folder(&shelf, "b"), None);
        assert_eq!(folder(&shelf, "нет"), None);

        remove(&shelf, "a").unwrap();
        remove(&shelf, "a").unwrap();

        assert_eq!(ids(&shelf), ["b"]);
        assert_eq!(folder(&shelf, "a"), None);
    }
}
