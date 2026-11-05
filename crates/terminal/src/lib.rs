//! Терминал панели: оболочка человека в псевдотерминале и экран, который
//! помнится, пока окна нет, и остаётся панели до следующего запуска.

mod pty;
mod screen;

pub use pty::{Command, Pty, command_line, shell_environment, user_shell};
pub use screen::Screen;
