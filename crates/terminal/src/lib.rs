//! Терминал панели: оболочка человека в псевдотерминале и экран, который
//! помнится, пока окна нет, и остаётся панели до следующего запуска.

mod pty;
mod screen;
mod supervisor;

pub use pty::{command_line, shell_environment, user_shell};
pub use supervisor::{Launch, OutputSink, Pane, PaneObserver, Supervisor, Term};
