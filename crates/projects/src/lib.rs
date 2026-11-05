//! Проекты: папки на диске, в которых работает агент. Список лежит в папке
//! данных приложения, а в сами папки приложение не пишет: в них работает
//! Claude Code.

mod domain;
mod infrastructure;
mod ports;
mod use_case;

pub use domain::Project;
pub use infrastructure::ProjectsFile;
pub use ports::Shelf;
pub use use_case::{add, folder, list, remove};
