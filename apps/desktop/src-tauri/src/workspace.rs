//! Рабочее место в приложении: `sapien_workspace::Workspace` над файлами
//! в папке данных, с событиями и каналом вывода Tauri.

use sapien_projects::ProjectsFile;
use sapien_sessions::{Projects, SessionsDir};
use sapien_workspace::{Events, OutputSink};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

/// Окну перечитать сессии: что-то в них поменялось без его команды.
const SESSIONS_CHANGED: &str = "agent-sessions";

/// Оболочка терминала кончилась.
const TERMINAL_EXITED: &str = "terminal-exited";

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
        let _ = self.0.emit(SESSIONS_CHANGED, ());
    }

    fn terminal_exited(&self, session: &str, pane: &str) {
        let _ = self
            .0
            .emit(TERMINAL_EXITED, json!({ "session": session, "pane": pane }));
    }
}

/// Вывод терминала в окно байтами через канал вкладки.
pub struct ChannelSink(pub Channel);

impl OutputSink for ChannelSink {
    fn send(&self, bytes: &[u8]) {
        let _ = self.0.send(InvokeResponseBody::Raw(bytes.to_vec()));
    }
}
