mod files;
mod settings;
mod watch;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};

use files::SchedulePayload;
use settings::{Settings, SettingsDto};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub watcher: Mutex<Option<watch::WatcherHandle>>,
    pub exiting: AtomicBool,
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
    settings::save_settings(&clean)?;
    {
        let mut guard = state
            .settings
            .lock()
            .map_err(|_| "設定を更新できません".to_string())?;
        *guard = clean;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = settings::load_settings();
    let always_on_top = settings.always_on_top;
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            settings: Mutex::new(settings),
            watcher: Mutex::new(None),
            exiting: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            load_schedule
        ])
        .setup(move |app| {
            apply_always_on_top(app.handle(), always_on_top);
            setup_tray(app.handle())?;
            watch::restart_watcher(app.handle());
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

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
