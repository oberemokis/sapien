//! Сессия sapien: терминал в папке проекта, в котором человек запускает
//! агентов. Запись сессии и последние экраны её панелей лежат в папке
//! данных приложения, а проект и его папку даёт приложение через порт
//! `Projects`: сессии о списке проектов не знают.

mod domain;
mod infrastructure;
mod ports;
mod use_case;

pub use domain::{PaneAgent, Session, SessionInfo, SessionsCode};
pub use infrastructure::{SessionsDir, without_chat};
pub use ports::{PaneFiles, Projects, Sessions};
pub use use_case::{
    delete_session, folder, forget_project, new_session, rename_session, sessions, touch,
};
