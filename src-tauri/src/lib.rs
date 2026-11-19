mod autostart;
mod files;
mod notified;
mod settings;
mod watch;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use files::SchedulePayload;
use settings::{Settings, SettingsDto};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub watcher: Mutex<Option<watch::WatcherHandle>>,
    pub exiting: AtomicBool,
    /// 通知の起床を取り消し、次の開始時刻へ差し替えるための番号。
    pub notify_generation: AtomicU64,
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<SettingsDto, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "設定を読めません".to_string())?;
    Ok(settings.to_dto())
}

#[tauri::command]
fn set_settings(
    app: AppHandle,
    state: State<AppState>,
    incoming: Settings,
) -> Result<SettingsDto, String> {
    let clean = settings::validate(incoming)?;
    let previous = {
        let guard = state
            .settings
            .lock()
            .map_err(|_| "設定を読めません".to_string())?;
        guard.clone()
    };
    settings::save_settings(&clean)?;
    {
        let mut guard = state
            .settings
            .lock()
            .map_err(|_| "設定を更新できません".to_string())?;
        *guard = clean.clone();
    }
    if clean.launch_at_login != previous.launch_at_login {
        if let Err(err) = autostart::apply_launch_at_login(clean.launch_at_login) {
            // ログイン項目を書けなかったときは、ほかの変更も戻して画面とファイルを揃える。
            let _ = settings::save_settings(&previous);
            if let Ok(mut guard) = state.settings.lock() {
                *guard = previous;
            }
            return Err(err);
        }
    }
    let dto = {
        let guard = state
            .settings
            .lock()
            .map_err(|_| "設定を読めません".to_string())?;
        apply_always_on_top(&app, guard.always_on_top);
        guard.to_dto()
    };
    watch::restart_watcher(&app);
    Ok(dto)
}

#[tauri::command]
fn load_schedule(app: AppHandle, state: State<AppState>) -> Result<SchedulePayload, String> {
    watch::ensure_watcher(&app);
    let settings = state
        .settings
        .lock()
        .map_err(|_| "設定を読めません".to_string())?;
    Ok(files::read_schedule_at(&settings.effective_path()))
}

#[tauri::command]
fn load_notified() -> Vec<notified::FiredNotice> {
    notified::load_notified()
}

#[tauri::command]
fn save_notified(records: Vec<notified::FiredNotice>) -> Result<(), String> {
    notified::save_notified(&records)
}

/// 非表示のあいだは画面のタイマーが遅れることがある。
/// 次に知らせる時刻までこちらで待ち、その時刻に画面へ起こす。
#[tauri::command]
fn schedule_notify_wake(app: AppHandle, state: State<AppState>, at_ms: Option<i64>) {
    let generation = state.notify_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(at_ms) = at_ms else {
        return;
    };
    std::thread::spawn(move || {
        if !wait_until_notify(&app, generation, at_ms) {
            return;
        }
        let _ = app.emit("notification-due", ());
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = settings::load_settings();
    let always_on_top = settings.always_on_top;
    let launch_at_login = settings.launch_at_login;
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // ログイン起動が既存のプロセスへ合流したときは、トレイのままにする。
            if !autostart::launched_in_tray(&args) {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            settings: Mutex::new(settings),
            watcher: Mutex::new(None),
            exiting: AtomicBool::new(false),
            notify_generation: AtomicU64::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            load_schedule,
            load_notified,
            save_notified,
            schedule_notify_wake
        ])
        .setup(move |app| {
            apply_always_on_top(app.handle(), always_on_top);
            setup_tray(app.handle())?;
            watch::restart_watcher(app.handle());
            if let Err(err) = autostart::apply_launch_at_login(launch_at_login) {
                eprintln!("自動起動の同期に失敗しました: {err}");
            }
            // 通常の起動はここで表示する。ログイン時は --minimized のままトレイに残す。
            if !autostart::launched_in_tray(&std::env::args().collect::<Vec<_>>()) {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                if state.exiting.load(Ordering::SeqCst) {
                    return;
                }
                let close_to_tray = state
                    .settings
                    .lock()
                    .map(|settings| settings.close_to_tray)
                    .unwrap_or(true);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("秘書の起動に失敗しました");
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "表示", true, None::<&str>)?;
    let pin = MenuItem::with_id(app, "pin", "常に手前に表示を切り替え", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &pin, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("秘書")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "pin" => toggle_always_on_top(app),
            "quit" => {
                app.state::<AppState>()
                    .exiting
                    .store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn toggle_always_on_top(app: &AppHandle) {
    let state = app.state::<AppState>();
    let next = {
        let Ok(guard) = state.settings.lock() else {
            return;
        };
        let mut settings = guard.clone();
        settings.always_on_top = !settings.always_on_top;
        settings
    };
    if settings::save_settings(&next).is_err() {
        return;
    }
    if let Ok(mut guard) = state.settings.lock() {
        *guard = next.clone();
    }
    apply_always_on_top(app, next.always_on_top);
}

fn apply_always_on_top(app: &AppHandle, always_on_top: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(always_on_top);
    }
}

/// 予定の書き直しで世代が変わったら、待っているスレッドは何もせず終わる。
fn wait_until_notify(app: &AppHandle, generation: u64, at_ms: i64) -> bool {
    loop {
        let state = app.state::<AppState>();
        if state.exiting.load(Ordering::SeqCst) {
            return false;
        }
        if state.notify_generation.load(Ordering::SeqCst) != generation {
            return false;
        }
        let now = unix_now_ms();
        if now >= at_ms {
            return app
                .state::<AppState>()
                .notify_generation
                .load(Ordering::SeqCst)
                == generation;
        }
        let slice = ((at_ms - now) as u64).clamp(1, 30_000);
        std::thread::sleep(Duration::from_millis(slice));
    }
}

fn unix_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
