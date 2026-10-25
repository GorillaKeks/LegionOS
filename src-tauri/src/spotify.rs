#[cfg(windows)]
use std::ffi::c_void;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const SPOTIFY_URI: &str = "spotify:";

#[derive(Default)]
pub struct LaunchGate(Mutex<Option<Instant>>);

impl LaunchGate {
    pub fn try_begin(&self, now: Instant, cooldown: Duration) -> bool {
        let Ok(mut last) = self.0.lock() else {
            return false;
        };
        if last.is_some_and(|at| now.saturating_duration_since(at) < cooldown) {
            return false;
        }
        *last = Some(now);
        true
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpotifyLaunchError {
    NotInstalledInPhone,
    UriHandlerUnavailable,
    LaunchFailed(u32),
    #[cfg(not(windows))]
    UnsupportedPlatform,
}

impl SpotifyLaunchError {
    pub fn message(&self) -> String {
        match self {
            Self::NotInstalledInPhone => "Spotify muss zuerst im lokalen LegionOS-App-Store installiert werden.".into(),
            Self::UriHandlerUnavailable => "Windows hat keinen Spotify-URI-Handler gefunden. Installiere Spotify Desktop aus einer offiziellen Quelle oder repariere dessen URI-Zuordnung.".into(),
            Self::LaunchFailed(code) => format!("Spotify konnte über den Windows-URI-Handler nicht gestartet werden (Windows-Fehler {code}). Prüfe die Spotify-Installation.") ,
            #[cfg(not(windows))]
            Self::UnsupportedPlatform => "Der Start von Spotify Desktop ist nur unter Windows verfügbar.".into(),
        }
    }
}

pub trait SpotifyUriLauncher {
    fn open_uri(&self, uri: &str) -> Result<(), SpotifyLaunchError>;
}

pub fn launch_spotify_with<L: SpotifyUriLauncher>(
    installed: bool,
    launcher: &L,
) -> Result<(), SpotifyLaunchError> {
    if !installed {
        return Err(SpotifyLaunchError::NotInstalledInPhone);
    }
    launcher.open_uri(SPOTIFY_URI)
}

#[cfg(windows)]
pub struct WindowsSpotifyUriLauncher;

#[cfg(windows)]
impl SpotifyUriLauncher for WindowsSpotifyUriLauncher {
    fn open_uri(&self, uri: &str) -> Result<(), SpotifyLaunchError> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{
            Foundation::HWND,
            UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        };

        let operation: Vec<u16> = std::ffi::OsStr::new("open")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let uri: Vec<u16> = std::ffi::OsStr::new(uri)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut::<c_void>() as HWND,
                operation.as_ptr(),
                uri.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        } as usize;
        match result {
            0..=31 if result == 31 => Err(SpotifyLaunchError::UriHandlerUnavailable),
            0..=31 => Err(SpotifyLaunchError::LaunchFailed(result as u32)),
            _ => Ok(()),
        }
    }
}

#[cfg(not(windows))]
pub struct WindowsSpotifyUriLauncher;

#[cfg(not(windows))]
impl SpotifyUriLauncher for WindowsSpotifyUriLauncher {
    fn open_uri(&self, _uri: &str) -> Result<(), SpotifyLaunchError> {
        Err(SpotifyLaunchError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct MockLauncher {
        result: Result<(), SpotifyLaunchError>,
        opened: RefCell<Vec<String>>,
    }

    impl SpotifyUriLauncher for MockLauncher {
        fn open_uri(&self, uri: &str) -> Result<(), SpotifyLaunchError> {
            self.opened.borrow_mut().push(uri.to_owned());
            self.result.clone()
        }
    }

    #[test]
    fn only_launches_the_fixed_spotify_uri_after_phone_installation() {
        let launcher = MockLauncher {
            result: Ok(()),
            opened: RefCell::new(Vec::new()),
        };
        assert_eq!(
            launch_spotify_with(false, &launcher),
            Err(SpotifyLaunchError::NotInstalledInPhone)
        );
        assert!(launcher.opened.borrow().is_empty());
        assert_eq!(launch_spotify_with(true, &launcher), Ok(()));
        assert_eq!(&*launcher.opened.borrow(), &["spotify:"]);
    }

    #[test]
    fn reports_missing_handler_and_launch_errors_without_panicking() {
        let no_handler = MockLauncher {
            result: Err(SpotifyLaunchError::UriHandlerUnavailable),
            opened: RefCell::new(Vec::new()),
        };
        assert_eq!(
            launch_spotify_with(true, &no_handler),
            Err(SpotifyLaunchError::UriHandlerUnavailable)
        );
        let failed = MockLauncher {
            result: Err(SpotifyLaunchError::LaunchFailed(5)),
            opened: RefCell::new(Vec::new()),
        };
        assert_eq!(
            launch_spotify_with(true, &failed),
            Err(SpotifyLaunchError::LaunchFailed(5))
        );
        assert!(
            SpotifyLaunchError::UriHandlerUnavailable
                .message()
                .contains("Windows")
        );
    }

    #[test]
    fn launch_gate_coalesces_rapid_repeated_clicks() {
        let gate = LaunchGate::default();
        let start = Instant::now();
        assert!(gate.try_begin(start, Duration::from_millis(1800)));
        assert!(!gate.try_begin(
            start + Duration::from_millis(500),
            Duration::from_millis(1800)
        ));
        assert!(gate.try_begin(
            start + Duration::from_millis(1800),
            Duration::from_millis(1800)
        ));
    }
}
