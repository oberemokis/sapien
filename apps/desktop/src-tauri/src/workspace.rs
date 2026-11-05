//! Рабочее место в приложении: `sapien_workspace::Workspace` над файлами
//! в папке данных, с событиями и каналом вывода Tauri.

use crate::events::{SessionsChanged, TerminalExited};
use sapien_projects::ProjectsFile;
use sapien_sessions::{Projects, SessionsDir};
use sapien_workspace::{Events, OutputSink};
use specta::datatype::DataType;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::AppHandle;
use tauri::ipc::{Channel, InvokeResponseBody, IpcResponse};
use tauri_specta::Event;

pub type Workspace = Arc<sapien_workspace::Workspace<SessionsDir, ProjectFolders, TauriEvents>>;

/// Сессии, терминалы и агенты над папкой данных `data`. Сторож терминалов
/// и сокет интеграций агентов работают с этого вызова.
pub fn start(app: &AppHandle, data: &Path) -> Workspace {
    let workspace = Arc::new(sapien_workspace::Workspace::new(
        SessionsDir::new(data),
        ProjectFolders(ProjectsFile::new(data)),
        TauriEvents(app.clone()),
    ));

    workspace.run(data);
    workspace
}

/// Папку проекта сессии даёт список проектов. Проекты о сессиях не знают,
/// связку держит приложение.
pub struct ProjectFolders(ProjectsFile);

impl Projects for ProjectFolders {
    fn folder(&self, id: &str) -> Option<PathBuf> {
        sapien_projects::folder(&self.0, id)
    }
}

pub struct TauriEvents(AppHandle);

impl Events for TauriEvents {
    fn sessions_changed(&self) {
        let _ = SessionsChanged.emit(&self.0);
    }

    fn terminal_exited(&self, session: &str, pane: &str) {
        let _ = TerminalExited {
            session: session.to_owned(),
            pane: pane.to_owned(),
        }
        .emit(&self.0);
    }
}

/// Вывод терминала: идёт в канал байтами, без JSON, и приходит в окно
/// `ArrayBuffer`.
pub struct Bytes(Vec<u8>);

impl IpcResponse for Bytes {
    fn body(self) -> tauri::Result<InvokeResponseBody> {
        Ok(InvokeResponseBody::Raw(self.0))
    }
}

impl specta::Type for Bytes {
    fn definition(_: &mut specta::Types) -> DataType {
        specta_typescript::define("ArrayBuffer").into()
    }
}

/// Вывод терминала в окно через канал вкладки.
pub struct ChannelSink(pub Channel<Bytes>);

impl OutputSink for ChannelSink {
    fn send(&self, bytes: &[u8]) {
        let _ = self.0.send(Bytes(bytes.to_vec()));
    }
}
