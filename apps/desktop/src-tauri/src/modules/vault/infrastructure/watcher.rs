use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

/// Событие для интерфейса: в хранилище что-то поменялось, перечитай.
pub const CHANGED: &str = "vault://changed";

/// Пачка правок снаружи, например `git checkout`, приходит одним событием,
/// а не сотней.
const DEBOUNCE: Duration = Duration::from_millis(200);

/// Слежение за папкой хранилища. Живёт в состоянии приложения: брошенный
/// наблюдатель перестаёт следить.
#[derive(Default)]
pub struct Watch(Mutex<Option<(PathBuf, Debouncer<RecommendedWatcher>)>>);

impl Watch {
    /// Следит за папкой или перестаёт, если папки нет. Та же папка второй раз
    /// не подписывается: команда статуса зовёт это при каждом запросе.
    pub fn follow<R: Runtime>(&self, app: &AppHandle<R>, root: Option<&Path>) {
        let Ok(mut slot) = self.0.lock() else {
            return;
        };

        if slot.as_ref().map(|(path, _)| path.as_path()) == root {
            return;
        }

        *slot = root.and_then(|root| {
            let app = app.clone();
            // Ошибку слежения тоже отдаём событием: чаще всего это пропавшая
            // папка, и интерфейс узнает о ней, перечитав статус.
            let mut debouncer = new_debouncer(DEBOUNCE, move |_: DebounceEventResult| {
                let _ = app.emit(CHANGED, ());
            })
            .ok()?;

            debouncer
                .watcher()
                .watch(root, RecursiveMode::Recursive)
                .ok()?;

            Some((root.to_path_buf(), debouncer))
        });
    }
}
