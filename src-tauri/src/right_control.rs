//! Event-driven Windows keyboard hook for the standalone Right Ctrl key.
//! Tauri's global-shortcut backend cannot map modifier-only right/left variants.
#[cfg(windows)]
mod platform {
    use std::{
        sync::{
            OnceLock,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        thread,
        time::Duration,
    };
    use tauri::AppHandle;
    use windows_sys::Win32::{
        Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{Input::KeyboardAndMouse::VK_RCONTROL, WindowsAndMessaging::*},
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static DOWN: AtomicBool = AtomicBool::new(false);
    static ACTIVE: AtomicBool = AtomicBool::new(false);
    static READY: AtomicBool = AtomicBool::new(false);

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let message = wparam as u32;
            let is_down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            let is_up = message == WM_KEYUP || message == WM_SYSKEYUP;
            let key = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
            if key.vkCode == u32::from(VK_RCONTROL) {
                if is_down && !DOWN.swap(true, Ordering::AcqRel) && ACTIVE.load(Ordering::Acquire) {
                    if let Some(app) = APP.get() {
                        let app = app.clone();
                        let _ = app.clone().run_on_main_thread(move || {
                            crate::toggle_overlay_from_right_control(&app)
                        });
                    }
                } else if is_up {
                    DOWN.store(false, Ordering::Release);
                }
            }
        }
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
    }

    pub fn start(app: AppHandle) -> Result<(), String> {
        if READY.load(Ordering::Acquire) {
            return Ok(());
        }
        APP.set(app)
            .map_err(|_| "RightCtrl-Hook wurde bereits initialisiert.".to_string())?;
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("phone-right-control-hook".into())
            .spawn(move || unsafe {
                let module = GetModuleHandleW(std::ptr::null());
                let hook =
                    SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module as HINSTANCE, 0);
                if hook.is_null() {
                    let _ = ready_tx.send(Err(
                        "Windows konnte den globalen RightCtrl-Tastatur-Hook nicht registrieren."
                            .to_string(),
                    ));
                    return;
                }
                let _ = ready_tx.send(Ok(()));
                READY.store(true, Ordering::Release);
                let mut message = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {}
                UnhookWindowsHookEx(hook);
            })
            .map_err(|error| error.to_string())?;
        ready_rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Zeitüberschreitung beim Registrieren des RightCtrl-Hooks.".to_string())?
    }

    pub fn set_active(active: bool) -> Result<(), String> {
        if active && !READY.load(Ordering::Acquire) {
            return Err("Der globale RightCtrl-Hook ist nicht verfügbar.".into());
        }
        ACTIVE.store(active, Ordering::Release);
        Ok(())
    }
}

#[cfg(windows)]
pub use platform::set_active;
#[cfg(windows)]
pub use platform::start;

#[cfg(not(windows))]
pub fn start(_: tauri::AppHandle) -> Result<(), String> {
    Err("RightCtrl als Einzeltaste wird nur unter Windows unterstützt.".into())
}
#[cfg(not(windows))]
pub fn set_active(active: bool) -> Result<(), String> {
    if active {
        Err("RightCtrl als Einzeltaste wird nur unter Windows unterstützt.".into())
    } else {
        Ok(())
    }
}
