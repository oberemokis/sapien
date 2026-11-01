use crate::modules::vault::domain::{Moved, visible_move};
use file_id::{FileId, get_file_id};
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};

/// Событие для интерфейса: в хранилище что-то поменялось, перечитай.
/// С ним приходят пары «был путь, стал путь» для переименованного снаружи:
/// вкладки переходят на новый путь, а не теряют файл.
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
            let watcher = watch(root, move |moved| {
                let _ = app.emit(CHANGED, moved);
            })?;

            Some((root.to_path_buf(), watcher))
        });
    }
}

/// Следит за папкой и отдаёт каждую пачку правок с переименованиями в ней.
fn watch(
    root: &Path,
    on_change: impl Fn(Vec<Moved>) + Send + 'static,
) -> Option<Debouncer<RecommendedWatcher>> {
    // macOS сообщает настоящий путь, без ссылок вроде /var → /private/var.
    // Помнить пути и отрезать корень нужно от него же.
    let root = root.canonicalize().ok()?;
    let mut ids = Ids::scan(&root);
    let base = root.clone();
    // Ошибку слежения тоже отдаём событием: чаще всего это пропавшая папка,
    // и интерфейс узнает о ней, перечитав статус.
    let mut watcher = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| {
        let paths: Vec<_> = result
            .map(|events| events.into_iter().map(|event| event.path).collect())
            .unwrap_or_default();

        on_change(ids.update(&base, &paths, Instant::now()));
    })
    .ok()?;

    watcher
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .ok()?;

    Some(watcher)
}

/// Номера файлов и папок хранилища по пути. Переименование номер не меняет:
/// пропавший путь и появившийся с тем же номером это один файл. Флаги
/// событий системы для этого не годятся: macOS ещё с минуту помечает
/// только что созданный файл созданным, и его переименование выглядит
/// как новый файл.
///
/// Половины одного переименования приходят и разными пачками: на Linux
/// `notify` после переименования папки читает её новый путь, и у него
/// появляется событие на доли миллисекунды позже, чем у старого. Поэтому
/// пропавшее без пары ждёт её одно окно дебаунса (`lost`). Дольше нельзя:
/// номер удалённого файла система отдаёт новому, и удаление с созданием
/// выглядели бы переездом.
struct Ids {
    known: HashMap<PathBuf, FileId>,
    lost: Vec<(PathBuf, FileId, Instant)>,
}

impl Ids {
    fn scan(root: &Path) -> Self {
        let mut ids = Ids {
            known: HashMap::new(),
            lost: Vec::new(),
        };

        ids.add(root);
        ids
    }

    /// Путь, а у папки и всё внутри неё. Ссылки внутрь не обходятся:
    /// ссылка на папку выше зациклила бы обход.
    fn add(&mut self, path: &Path) {
        let Ok(id) = get_file_id(path) else {
            return;
        };

        self.known.insert(path.to_path_buf(), id);

        let Ok(entries) = fs::read_dir(path) else {
            return;
        };

        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|kind| !kind.is_symlink()) {
                self.add(&entry.path());
            }
        }
    }

    /// Пропавший путь, а у папки и всё, что было внутри.
    fn forget(&mut self, path: &Path) {
        self.known.retain(|known, _| !known.starts_with(path));
    }

    /// Пачка путей, о которых сообщило слежение, на момент `now`. Пропавший
    /// путь, чей номер появился под другим путём, это переименование.
    fn update(&mut self, root: &Path, paths: &[PathBuf], now: Instant) -> Vec<Moved> {
        let mut gone = Vec::new();
        let mut appeared = Vec::new();

        for path in paths {
            match get_file_id(path) {
                Ok(id) if self.known.get(path) != Some(&id) => appeared.push((path, id)),
                Err(_) if self.known.contains_key(path) => gone.push(path),
                _ => {}
            }
        }

        // Папка раньше своего содержимого: пропало вместе с ней.
        gone.sort_by_key(|path| path.components().count());

        let mut lost: Vec<_> = std::mem::take(&mut self.lost)
            .into_iter()
            .filter(|(.., at)| now.saturating_duration_since(*at) < DEBOUNCE)
            .collect();

        for from in gone {
            if let Some(&id) = self.known.get(from) {
                self.forget(from);
                lost.push((from.clone(), id, now));
            }
        }

        let pair = |from: &Path, to: &Path| -> Option<Moved> {
            visible_move(&relative(root, from)?, &relative(root, to)?, to.is_dir())
        };
        let mut moved = Vec::new();

        for (from, id, at) in lost {
            match appeared.iter().find(|(_, other)| *other == id) {
                Some((to, _)) => moved.extend(pair(&from, to)),
                None => self.lost.push((from, id, at)),
            }
        }

        for (path, _) in appeared {
            self.add(path);
        }

        moved
    }
}

/// Путь внутри хранилища, как его пишет дерево: от корня и через `/`.
fn relative(root: &Path, path: &Path) -> Option<String> {
    let parts = path
        .strip_prefix(root)
        .ok()?
        .iter()
        .map(|part| part.to_str())
        .collect::<Option<Vec<_>>>()?;

    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread::sleep;

    fn moved(from: &str, to: &str) -> Moved {
        Moved {
            from: from.into(),
            to: to.into(),
        }
    }

    // Ждёт пачку с переименованиями, пустые пропускает.
    fn next_moves(events: &mpsc::Receiver<Vec<Moved>>) -> Vec<Moved> {
        loop {
            let moved = events
                .recv_timeout(Duration::from_secs(5))
                .expect("слежение молчит");

            if !moved.is_empty() {
                return moved;
            }
        }
    }

    fn follow(dir: &Path) -> (Debouncer<RecommendedWatcher>, mpsc::Receiver<Vec<Moved>>) {
        let (sender, events) = mpsc::channel();
        let watcher = watch(dir, move |moved| {
            let _ = sender.send(moved);
        })
        .unwrap();

        // Подписка на события системы начинает работать не мгновенно.
        sleep(Duration::from_millis(300));
        (watcher, events)
    }

    #[test]
    fn переименование_снаружи_приходит_парой_путей() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("work")).unwrap();
        fs::write(root.join("work/plan.md"), "план").unwrap();
        let (_watcher, events) = follow(root);

        fs::rename(root.join("work/plan.md"), root.join("work/result.md")).unwrap();
        assert_eq!(
            next_moves(&events),
            [moved("work/plan.md", "work/result.md")]
        );

        fs::rename(root.join("work"), root.join("done")).unwrap();
        assert_eq!(next_moves(&events), [moved("work", "done")]);

        // Содержимое переименованной папки слежение знает под новым путём.
        fs::rename(root.join("done/result.md"), root.join("done/final.md")).unwrap();
        assert_eq!(
            next_moves(&events),
            [moved("done/result.md", "done/final.md")]
        );
    }

    // Половины переименования папки разными пачками, как их отдаёт
    // дебаунсер на Linux: старый путь первым, новый следующим.
    #[test]
    fn переезд_папки_сводится_и_из_соседних_пачек() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("work")).unwrap();
        fs::write(root.join("work/plan.md"), "план").unwrap();
        let mut ids = Ids::scan(&root);
        let now = Instant::now();

        fs::rename(root.join("work"), root.join("done")).unwrap();

        assert_eq!(ids.update(&root, &[root.join("work")], now), []);
        assert_eq!(
            ids.update(&root, &[root.join("done")], now + DEBOUNCE / 2),
            [moved("work", "done")]
        );

        // Пара нашлась, второй раз переезд не приходит, а содержимое
        // папки известно под новым путём.
        fs::rename(root.join("done/plan.md"), root.join("done/final.md")).unwrap();
        assert_eq!(
            ids.update(
                &root,
                &[root.join("done/plan.md"), root.join("done/final.md")],
                now + DEBOUNCE
            ),
            [moved("done/plan.md", "done/final.md")]
        );
    }

    #[test]
    fn давняя_пропажа_с_тем_же_номером_не_переезд() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("plan.md"), "план").unwrap();
        let mut ids = Ids::scan(&root);
        let now = Instant::now();

        fs::rename(root.join("plan.md"), root.join("other.md")).unwrap();

        assert_eq!(ids.update(&root, &[root.join("plan.md")], now), []);
        assert_eq!(
            ids.update(&root, &[root.join("other.md")], now + DEBOUNCE),
            []
        );
    }

    #[test]
    fn только_что_созданная_заметка_тоже_переезжает() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (_watcher, events) = follow(root);

        fs::write(root.join("new.md"), "").unwrap();
        sleep(Duration::from_secs(1));
        // Запись приложения: новый файл встаёт на место прежнего.
        crate::durable::write(&root.join("new.md"), "текст".as_bytes()).unwrap();
        sleep(Duration::from_secs(1));
        fs::rename(root.join("new.md"), root.join("renamed.md")).unwrap();

        assert_eq!(next_moves(&events), [moved("new.md", "renamed.md")]);
    }
}
