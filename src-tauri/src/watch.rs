use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

use notify::{
    Event, EventKind, RecommendedWatcher, RecursiveMode, Result as NotifyResult, Watcher,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::files::event_targets_schedule;
use crate::AppState;

pub struct WatcherHandle {
    _inner: RecommendedWatcher,
}

pub fn ensure_watcher(app: &AppHandle) {
    let missing = app
        .state::<AppState>()
        .watcher
        .lock()
        .map(|guard| guard.is_none())
        .unwrap_or(true);
    if missing {
        restart_watcher(app);
    }
}

pub fn restart_watcher(app: &AppHandle) {
    let path = {
        let state = app.state::<AppState>();
        let Ok(settings) = state.settings.lock() else {
            return;
        };
        settings.effective_path()
    };
    let handle = spawn_watcher(app.clone(), path).ok();
    if let Ok(mut slot) = app.state::<AppState>().watcher.lock() {
        *slot = handle;
    }
}

fn spawn_watcher(app: AppHandle, schedule: PathBuf) -> Result<WatcherHandle, String> {
    let parent = schedule
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty() && parent.exists())
        .map(PathBuf::from)
        .ok_or_else(|| format!("監視するフォルダがありません: {}", schedule.display()))?;

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|err| err.to_string())?;

    thread::spawn(move || watch_loop(rx, app, schedule));
    Ok(WatcherHandle { _inner: watcher })
}

fn watch_loop(rx: Receiver<NotifyResult<Event>>, app: AppHandle, schedule: PathBuf) {
    while let Ok(first) = rx.recv() {
        if !is_relevant(&first, &schedule) {
            continue;
        }
        thread::sleep(Duration::from_millis(400));
        while rx.try_recv().is_ok() {}
        let _ = app.emit("schedule-file-changed", ());
    }
}

fn is_relevant(result: &NotifyResult<Event>, schedule: &std::path::Path) -> bool {
    let Ok(event) = result else {
        return false;
    };
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    event_targets_schedule(&event.paths, schedule)
}
