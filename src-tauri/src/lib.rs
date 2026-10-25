mod app_catalog;
mod config;
mod hotkey;
mod right_control;
mod radio;
mod roadwatch;
mod window_control;

use app_catalog::{AppStoreSnapshot, scan_apps_dir, set_installed_ids, validate_installable};
use config::{ConfigSnapshot, ConfigStore, DEFAULT_OVERLAY_HOTKEY, UserSettings, ViewMode};
use radio::{radio_resolve_stream, radio_search_stations};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct ActiveHotkey(Mutex<Option<String>>);
struct ToggleDebounce(Mutex<Option<Instant>>);
#[tauri::command]
fn load_phone_config(store: State<'_, ConfigStore>) -> ConfigSnapshot {
    store.snapshot()
}

#[tauri::command]
fn save_user_settings(settings: UserSettings, store: State<'_, ConfigStore>) -> Result<(), String> {
    for (label, value) in [
        ("TruckersMP-ID", &settings.truckersmp_id),
        ("VTC-ID", &settings.vtc_id),
    ] {
        if !value.is_empty()
            && (value.len() > 20 || !value.bytes().all(|byte| byte.is_ascii_digit()))
        {
            return Err(format!("{label} muss aus höchstens 20 Ziffern bestehen."));
        }
    }
    store.update_settings(settings)
}

#[tauri::command]
fn save_notes(notes: String, store: State<'_, ConfigStore>) -> Result<(), String> {
    store.update_notes(notes)
}

#[tauri::command]
async fn load_roadwatch_data(
    store: State<'_, ConfigStore>,
) -> Result<roadwatch::RoadWatchData, String> {
    let settings = store.config().settings;
    roadwatch::load_data(&settings.vtc_id, &settings.truckersmp_id).await
}

#[tauri::command]
fn load_local_apps(
    app: AppHandle,
    store: State<'_, ConfigStore>,
) -> Result<AppStoreSnapshot, String> {
    let root = app_catalog::resolve_apps_dir(&app)?;
    scan_apps_dir(&root, &store.config().installed_apps)
}

#[tauri::command]
fn install_local_app(
    id: String,
    app: AppHandle,
    store: State<'_, ConfigStore>,
) -> Result<AppStoreSnapshot, String> {
    let root = app_catalog::resolve_apps_dir(&app)?;
    let mut snapshot = scan_apps_dir(&root, &store.config().installed_apps)?;
    validate_installable(&snapshot, &id)?;
    let installed_ids = store.install_app(&id)?;
    set_installed_ids(&mut snapshot, installed_ids);
    Ok(snapshot)
}

#[tauri::command]
fn uninstall_local_app(
    id: String,
    app: AppHandle,
    store: State<'_, ConfigStore>,
) -> Result<AppStoreSnapshot, String> {
    let root = app_catalog::resolve_apps_dir(&app)?;
    let mut snapshot = scan_apps_dir(&root, &store.config().installed_apps)?;
    let installed_ids = store.uninstall_app(&id)?;
    set_installed_ids(&mut snapshot, installed_ids);
    Ok(snapshot)
}

#[tauri::command]
fn set_overlay_hotkey(
    hotkey: String,
    app: AppHandle,
    store: State<'_, ConfigStore>,
    active: State<'_, ActiveHotkey>,
) -> Result<String, String> {
    let parsed = hotkey::parse_shortcut(&hotkey)?;
    let canonical = parsed.canonical();
    let mut current = active
        .0
        .lock()
        .map_err(|_| "Hotkey-Zustand ist nicht verfügbar.".to_string())?;
    if current.as_deref() == Some(canonical.as_str()) {
        return Ok(canonical);
    }

    register_binding(&app, &parsed)?;
    let old = current
        .as_deref()
        .map(hotkey::parse_shortcut)
        .transpose()
        .map_err(|error| error.to_string())?;
    if let Some(old) = old.as_ref() {
        if let Err(error) = unregister_binding(&app, old) {
            let _ = unregister_binding(&app, &parsed);
            return Err(format!(
                "Der bisherige Hotkey konnte nicht entfernt werden: {error}"
            ));
        }
    }
    if let Err(error) = store.update_overlay_hotkey(canonical.clone()) {
        let _ = unregister_binding(&app, &parsed);
        if let Some(old) = old.as_ref() {
            let _ = register_binding(&app, old);
        }
        return Err(format!(
            "Hotkey konnte nicht gespeichert werden; die bisherige Belegung wurde wiederhergestellt: {error}"
        ));
    }
    store.set_overlay_hotkey_error(None);
    *current = Some(canonical.clone());
    Ok(canonical)
}

#[tauri::command]
fn exit_phone(app: AppHandle, store: State<'_, ConfigStore>) {
    let _ = store.flush();
    app.exit(0);
}

fn toggle_overlay(app: &AppHandle) {
    if let Some(debounce) = app.try_state::<ToggleDebounce>() {
        let Ok(mut last) = debounce.0.lock() else {
            return;
        };
        let now = Instant::now();
        if last.is_some_and(|at| now.duration_since(at) < Duration::from_millis(300)) {
            return;
        }
        *last = Some(now);
    }
    toggle_existing_main_window(app);
}

pub(crate) fn toggle_overlay_from_right_control(app: &AppHandle) {
    // The low-level hook already suppresses repeated key-downs until key-up.
    toggle_existing_main_window(app);
}

fn toggle_existing_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        Ok(false) => {
            let _ = window.show();
        }
        Err(_) => {}
    }
}

#[cfg(windows)]
fn set_windows_taskbar_icon(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        ICON_BIG, ICON_SMALL, SendMessageW, WM_GETICON, WM_SETICON,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("Windows-Fensterhandle nicht verfuegbar: {error}"))?
        .0 as windows_sys::Win32::Foundation::HWND;
    let small_icon = unsafe { SendMessageW(hwnd, WM_GETICON, ICON_SMALL as usize, 0) };
    if small_icon == 0 {
        return Err("Das LegionOS-Fenster hat kein kleines Icon-Handle.".into());
    }

    // Tauri's set_icon sets ICON_SMALL; the taskbar reads ICON_BIG on Windows.
    unsafe {
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, small_icon);
    }
    Ok(())
}

fn register_binding(app: &AppHandle, binding: &hotkey::HotkeyBinding) -> Result<(), String> {
    match binding {
        hotkey::HotkeyBinding::RightControl => {
            right_control::start(app.clone())?;
            right_control::set_active(true)
        }
        hotkey::HotkeyBinding::Shortcut(shortcut) => {
            app.global_shortcut().register(*shortcut).map_err(|error| {
                format!(
                    "Hotkey {} konnte nicht registriert werden: {error}",
                    shortcut
                )
            })
        }
    }
}

fn unregister_binding(app: &AppHandle, binding: &hotkey::HotkeyBinding) -> Result<(), String> {
    match binding {
        hotkey::HotkeyBinding::RightControl => right_control::set_active(false),
        hotkey::HotkeyBinding::Shortcut(shortcut) => app
            .global_shortcut()
            .unregister(*shortcut)
            .map_err(|error| error.to_string()),
    }
}

#[tauri::command]
fn set_view_mode(
    mode: ViewMode,
    window: WebviewWindow,
    store: State<'_, ConfigStore>,
) -> Result<(), String> {
    let snapshot = store.snapshot();
    if !snapshot.can_save {
        return Err(snapshot
            .notice
            .unwrap_or_else(|| "Konfiguration ist schreibgeschützt.".into()));
    }
    let previous = store.config();
    let current_bounds = window_control::bounds_from_window(&window).ok();
    window_control::apply_mode(&window, mode, current_bounds, false)?;
    let bounds = window_control::bounds_from_window(&window).ok();
    if let Err(error) = store.update_mode_and_bounds(mode, bounds) {
        let _ = window_control::apply_mode(&window, previous.mode, previous.window_bounds, true);
        return Err(error);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app =
        tauri::Builder::default()
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .invoke_handler(tauri::generate_handler![
                load_phone_config,
                save_user_settings,
                save_notes,
                load_roadwatch_data,
                load_local_apps,
                install_local_app,
                uninstall_local_app,
                radio_search_stations,
                radio_resolve_stream,
                set_view_mode,
                set_overlay_hotkey,
                exit_phone
            ])
            .setup(|app| {
                let config_path = app.path().app_config_dir()?.join("phone.json");
                let store = ConfigStore::open(config_path).map_err(std::io::Error::other)?;
                let initial_config = store.config();
                app.manage(store);
                app.manage(ActiveHotkey(Mutex::new(None)));
                app.manage(ToggleDebounce(Mutex::new(None)));

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, _shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                toggle_overlay(app);
                            }
                        })
                        .build(),
                )?;
                let parsed_startup = hotkey::parse_shortcut(&initial_config.overlay_hotkey);
                let registered = match parsed_startup {
                    Ok(binding) => match register_binding(app.handle(), &binding) {
                        Ok(()) => Some(binding),
                        Err(error) => {
                            app.state::<ConfigStore>()
                                .set_overlay_hotkey_error(Some(format!(
                                    "Gespeicherter Hotkey konnte nicht registriert werden: {error}"
                                )));
                            None
                        }
                    },
                    Err(error) => {
                        app.state::<ConfigStore>()
                            .set_overlay_hotkey_error(Some(error));
                        None
                    }
                };
                let registered = if registered.is_none() {
                    match hotkey::parse_shortcut(DEFAULT_OVERLAY_HOTKEY).and_then(|binding| {
                        register_binding(app.handle(), &binding).map(|()| binding)
                    }) {
                        Ok(binding) => {
                            app.state::<ConfigStore>()
                                .update_overlay_hotkey(binding.canonical())?;
                            Some(binding)
                        }
                        Err(error) => {
                            app.state::<ConfigStore>()
                            .set_overlay_hotkey_error(Some(format!(
                                "Auch der Standard-Hotkey konnte nicht registriert werden: {error}"
                            )));
                            None
                        }
                    }
                } else {
                    registered
                };
                if let Some(binding) = registered {
                    *app.state::<ActiveHotkey>().0.lock().map_err(|_| {
                        std::io::Error::other("Hotkey-Zustand ist nicht verfügbar.")
                    })? = Some(binding.canonical());
                }

                if let Some(window) = app.get_webview_window("main") {
                    #[cfg(windows)]
                    window
                        .set_icon(tauri::image::Image::from_bytes(include_bytes!(
                            "../icons/32x32.png"
                        ))?)
                        .map_err(std::io::Error::other)?;
                    #[cfg(windows)]
                    set_windows_taskbar_icon(&window).map_err(std::io::Error::other)?;
                    #[cfg(not(windows))]
                    if let Some(icon) = app.default_window_icon() {
                        window
                            .set_icon(icon.clone())
                            .map_err(std::io::Error::other)?;
                    }
                    window_control::apply_mode(
                        &window,
                        initial_config.mode,
                        initial_config.window_bounds,
                        true,
                    )
                    .map_err(std::io::Error::other)?;
                }
                Ok(())
            })
            .on_window_event(|window, event| {
                if window.label() != "main" {
                    return;
                }
                let store = window.app_handle().state::<ConfigStore>();
                match event {
                    WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                        if let Ok(bounds) = window_control::bounds_from_window(window) {
                            let _ = store.record_window_bounds(bounds, false);
                        }
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                        if let Ok(bounds) = window_control::bounds_from_window(window) {
                            let _ = store.record_window_bounds(bounds, true);
                        }
                    }
                    _ => {}
                }
            })
            .build(tauri::generate_context!())
            .expect("error while building tauri application");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(store) = handle.try_state::<ConfigStore>() {
                let _ = store.flush();
            }
        }
    });
}
