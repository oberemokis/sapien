use super::domain::Project;
use crate::error::AppError;

/// Где лежит список проектов, по порядку добавления.
pub trait Shelf {
    /// Проекты с `missing` по диску на момент чтения.
    fn load(&self) -> Result<Vec<Project>, AppError>;
    fn save(&self, projects: &[Project]) -> Result<(), AppError>;
}
