//! GitHub и GitLab: подключение по токену с проверкой ответом сервера.
//! Токен лежит в системном хранилище паролей (secrets.rs), а адрес
//! и логин в папке данных приложения. Запросы делает Rust и только туда,
//! куда направил человек (egress.rs).

mod domain;
mod egress;
mod infrastructure;
mod ports;
mod secrets;
mod use_case;

pub use domain::{Forge, ForgeStatus, ForgeStatuses};
pub use infrastructure::{AccountsFile, Http};
pub use secrets::Secrets;
pub use use_case::{connect, disconnect, status};
