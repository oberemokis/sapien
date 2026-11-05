use crate::domain::Project;
use sapien_kernel::AppError;

/// Где лежит список проектов, по порядку добавления.
pub trait Shelf {
    /// Проекты с `missing` по диску на момент чтения.
    fn load(&self) -> Result<Vec<Project>, AppError>;
    fn save(&self, projects: &[Project]) -> Result<(), AppError>;
}
