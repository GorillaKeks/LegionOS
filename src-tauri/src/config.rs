use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Mutex, MutexGuard,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const CONFIG_VERSION: u32 = 6;
pub const DEFAULT_OVERLAY_HOTKEY: &str = "Tab";
const PRE_V3_DEFAULT_HOTKEYS: &[&str] = &[
    "ctrl+shift+space",
    "control+shift+space",
    "shift+control+space",
];
const RIGHT_CONTROL_DEFAULT_ALIASES: &[&str] =
    &["RightCtrl", "RControl", "RightControl", "ControlRight"];
const GEOMETRY_SAVE_INTERVAL: Duration = Duration::from_millis(400);
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    #[default]
    Phone,
    Tablet,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserSettings {
    pub quiet_mode: bool,
    pub accent_on: bool,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            quiet_mode: false,
            accent_on: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PhoneConfig {
    pub version: u32,
    pub mode: ViewMode,
    pub settings: UserSettings,
    pub notes: String,
    pub window_bounds: Option<WindowBounds>,
    pub overlay_hotkey: String,
    #[serde(default = "default_installed_apps")]
    pub installed_apps: Vec<String>,
}

fn default_installed_apps() -> Vec<String> {
    vec!["settings".into(), "notes".into(), "demo".into()]
}

impl Default for PhoneConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            mode: ViewMode::Phone,
            settings: UserSettings::default(),
            notes: String::new(),
            window_bounds: None,
            overlay_hotkey: DEFAULT_OVERLAY_HOTKEY.into(),
            installed_apps: default_installed_apps(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    pub version: u32,
    pub mode: ViewMode,
    pub settings: UserSettings,
    pub notes: String,
    pub can_save: bool,
    pub notice: Option<String>,
    pub overlay_hotkey: String,
    pub overlay_hotkey_error: Option<String>,
}

struct StoreState {
    config: PhoneConfig,
    can_save: bool,
    notice: Option<String>,
    last_write: Instant,
    overlay_hotkey_error: Option<String>,
}

pub struct ConfigStore {
    path: PathBuf,
    state: Mutex<StoreState>,
}

impl ConfigStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let (config, can_save, notice) = match fs::read(&path) {
            Ok(bytes) => match parse_config(&bytes) {
                Ok((config, migrated)) => {
                    if migrated {
                        write_atomic(&path, &config).map_err(|error| error.to_string())?;
                    }
                    (config, true, None)
                }
                Err(ConfigFileError::FutureVersion(version)) => (
                    PhoneConfig::default(),
                    false,
                    Some(format!(
                        "Die Konfiguration verwendet Version {version}; diese App unterstützt Version {CONFIG_VERSION}. Die Datei bleibt unverändert."
                    )),
                ),
                Err(ConfigFileError::Invalid(error)) => {
                    let backup = quarantine_path(&path);
                    fs::rename(&path, &backup).map_err(|rename_error| {
                        format!("Beschädigte Konfiguration konnte nicht gesichert werden: {rename_error}")
                    })?;
                    let config = PhoneConfig::default();
                    write_atomic(&path, &config).map_err(|write_error| write_error.to_string())?;
                    (
                        config,
                        true,
                        Some(format!(
                            "Die beschädigte Konfiguration wurde nach {} verschoben. Standardwerte sind geladen. ({error})",
                            backup.display()
                        )),
                    )
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let config = PhoneConfig::default();
                write_atomic(&path, &config).map_err(|write_error| write_error.to_string())?;
                (config, true, None)
            }
            Err(error) => {
                return Err(format!(
                    "Konfiguration konnte nicht gelesen werden: {error}"
                ));
            }
        };

        Ok(Self {
            path,
            state: Mutex::new(StoreState {
                config,
                can_save,
                notice,
                last_write: Instant::now(),
                overlay_hotkey_error: None,
            }),
        })
    }

    fn lock(&self) -> MutexGuard<'_, StoreState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn snapshot(&self) -> ConfigSnapshot {
        let state = self.lock();
        ConfigSnapshot {
            version: state.config.version,
            mode: state.config.mode,
            settings: state.config.settings.clone(),
            notes: state.config.notes.clone(),
            can_save: state.can_save,
            notice: state.notice.clone(),
            overlay_hotkey: state.config.overlay_hotkey.clone(),
            overlay_hotkey_error: state.overlay_hotkey_error.clone(),
        }
    }

    pub fn config(&self) -> PhoneConfig {
        self.lock().config.clone()
    }

    pub fn update_settings(&self, settings: UserSettings) -> Result<(), String> {
        self.update(|config| config.settings = settings)
    }

    pub fn update_notes(&self, notes: String) -> Result<(), String> {
        self.update(|config| config.notes = notes)
    }

    pub fn update_overlay_hotkey(&self, hotkey: String) -> Result<(), String> {
        self.update(|config| config.overlay_hotkey = hotkey)
    }

    pub fn install_app(&self, app_id: &str) -> Result<Vec<String>, String> {
        if !is_valid_app_id(app_id) {
            return Err("Ungültige App-ID.".into());
        }
        let mut state = self.lock();
        ensure_writable(&state)?;
        if state.config.installed_apps.iter().any(|id| id == app_id) {
            return Ok(state.config.installed_apps.clone());
        }
        let mut next = state.config.clone();
        next.installed_apps.push(app_id.to_owned());
        next.version = CONFIG_VERSION;
        write_atomic(&self.path, &next).map_err(|error| error.to_string())?;
        state.config = next;
        state.last_write = Instant::now();
        Ok(state.config.installed_apps.clone())
    }

    pub fn uninstall_app(&self, app_id: &str) -> Result<Vec<String>, String> {
        if !is_valid_app_id(app_id) {
            return Err("Ungültige App-ID.".into());
        }
        let mut state = self.lock();
        ensure_writable(&state)?;
        let mut next = state.config.clone();
        next.installed_apps.retain(|id| id != app_id);
        next.version = CONFIG_VERSION;
        write_atomic(&self.path, &next).map_err(|error| error.to_string())?;
        state.config = next;
        state.last_write = Instant::now();
        Ok(state.config.installed_apps.clone())
    }

    pub fn set_overlay_hotkey_error(&self, error: Option<String>) {
        self.lock().overlay_hotkey_error = error;
    }

    pub fn update_mode_and_bounds(
        &self,
        mode: ViewMode,
        bounds: Option<WindowBounds>,
    ) -> Result<(), String> {
        self.update(|config| {
            config.mode = mode;
            if bounds.is_some() {
                config.window_bounds = bounds;
            }
        })
    }

    pub fn record_window_bounds(&self, bounds: WindowBounds, force: bool) -> Result<(), String> {
        if bounds.width < 200 || bounds.height < 200 {
            return Ok(());
        }
        let mut state = self.lock();
        ensure_writable(&state)?;
        state.config.window_bounds = Some(bounds);
        if force || state.last_write.elapsed() >= GEOMETRY_SAVE_INTERVAL {
            write_atomic(&self.path, &state.config).map_err(|error| error.to_string())?;
            state.last_write = Instant::now();
        }
        Ok(())
    }

    pub fn flush(&self) -> Result<(), String> {
        let mut state = self.lock();
        ensure_writable(&state)?;
        write_atomic(&self.path, &state.config).map_err(|error| error.to_string())?;
        state.last_write = Instant::now();
        Ok(())
    }

    fn update(&self, change: impl FnOnce(&mut PhoneConfig)) -> Result<(), String> {
        let mut state = self.lock();
        ensure_writable(&state)?;
        let mut next = state.config.clone();
        change(&mut next);
        next.version = CONFIG_VERSION;
        write_atomic(&self.path, &next).map_err(|error| error.to_string())?;
        state.config = next;
        state.last_write = Instant::now();
        Ok(())
    }
}

fn is_valid_app_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

fn ensure_writable(state: &StoreState) -> Result<(), String> {
    if state.can_save {
        Ok(())
    } else {
        Err(state
            .notice
            .clone()
            .unwrap_or_else(|| "Konfiguration ist schreibgeschützt.".into()))
    }
}

#[derive(Debug)]
enum ConfigFileError {
    FutureVersion(u64),
    Invalid(String),
}

fn parse_config(bytes: &[u8]) -> Result<(PhoneConfig, bool), ConfigFileError> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| ConfigFileError::Invalid(error.to_string()))?;
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if version > u64::from(CONFIG_VERSION) {
        return Err(ConfigFileError::FutureVersion(version));
    }
    let mut config: PhoneConfig = serde_json::from_value(value)
        .map_err(|error| ConfigFileError::Invalid(error.to_string()))?;
    let migrated = config.version != CONFIG_VERSION;
    let previous_default = (config.version < 3
        && PRE_V3_DEFAULT_HOTKEYS
            .iter()
            .any(|value| config.overlay_hotkey.eq_ignore_ascii_case(value)))
        || ((3..CONFIG_VERSION).contains(&config.version)
            && RIGHT_CONTROL_DEFAULT_ALIASES
                .iter()
                .any(|value| config.overlay_hotkey.eq_ignore_ascii_case(value)));
    if previous_default {
        config.overlay_hotkey = DEFAULT_OVERLAY_HOTKEY.into();
    }
    config.version = CONFIG_VERSION;
    Ok((config, migrated))
}

fn quarantine_path(path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!("{name}.corrupt-{timestamp}"))
}

fn write_atomic(path: &Path, config: &PhoneConfig) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_extension(format!("tmp-{}-{counter}", std::process::id()));
    let serialized = serde_json::to_vec_pretty(config).map_err(std::io::Error::other)?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(&serialized)?;
    file.sync_all()?;
    drop(file);
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Some(parent) = path.parent() {
        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs, sync::atomic::AtomicU64};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_path() -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        env::temp_dir().join(format!(
            "phone-config-test-{}-{id}/nested/phone.json",
            std::process::id()
        ))
    }

    #[test]
    fn defaults_are_versioned_and_sensible() {
        let defaults = PhoneConfig::default();
        assert_eq!(defaults.version, CONFIG_VERSION);
        assert_eq!(defaults.mode, ViewMode::Phone);
        assert_eq!(
            defaults.settings,
            UserSettings {
                quiet_mode: false,
                accent_on: true
            }
        );
        assert!(defaults.notes.is_empty());
        assert!(defaults.window_bounds.is_none());
        assert_eq!(defaults.overlay_hotkey, DEFAULT_OVERLAY_HOTKEY);
        assert_eq!(defaults.installed_apps, default_installed_apps());
    }

    #[test]
    fn missing_config_is_created_and_updates_survive_reopen() {
        let path = test_path();
        let store = ConfigStore::open(path.clone()).unwrap();
        store
            .update_settings(UserSettings {
                quiet_mode: true,
                accent_on: false,
            })
            .unwrap();
        store.update_notes("persistente Notiz".into()).unwrap();
        store.update_overlay_hotkey("alt+f10".into()).unwrap();
        store
            .update_mode_and_bounds(
                ViewMode::Tablet,
                Some(WindowBounds {
                    x: 10,
                    y: 20,
                    width: 1000,
                    height: 700,
                }),
            )
            .unwrap();
        drop(store);

        let reopened = ConfigStore::open(path.clone()).unwrap();
        let snapshot = reopened.snapshot();
        assert_eq!(snapshot.mode, ViewMode::Tablet);
        assert!(snapshot.settings.quiet_mode);
        assert!(!snapshot.settings.accent_on);
        assert_eq!(snapshot.notes, "persistente Notiz");
        assert_eq!(snapshot.overlay_hotkey, "alt+f10");
        assert!(path.exists());
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn german_umlauts_and_sharp_s_survive_json_save_and_reload() {
        let path = test_path();
        let text = "ä ö ü Ä Ö Ü ß — Grüße aus München: Straße, für Österreich.";
        let store = ConfigStore::open(path.clone()).unwrap();
        store.update_notes(text.to_owned()).unwrap();
        drop(store);

        let bytes = fs::read(&path).unwrap();
        let json = std::str::from_utf8(&bytes).expect("config must be UTF-8");
        assert!(
            json.contains(text),
            "serialized JSON should preserve Unicode text"
        );

        let reopened = ConfigStore::open(path.clone()).unwrap();
        assert_eq!(reopened.snapshot().notes, text);
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn older_configuration_defaults_missing_fields_and_migrates() {
        let path = test_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"version":0,"mode":"tablet","notes":"alte Notiz"}"#,
        )
        .unwrap();
        let store = ConfigStore::open(path.clone()).unwrap();
        let snapshot = store.snapshot();
        assert_eq!(snapshot.version, CONFIG_VERSION);
        assert_eq!(snapshot.mode, ViewMode::Tablet);
        assert_eq!(snapshot.notes, "alte Notiz");
        assert_eq!(snapshot.settings, UserSettings::default());
        assert_eq!(snapshot.overlay_hotkey, DEFAULT_OVERLAY_HOTKEY);
        let persisted: PhoneConfig = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted.version, CONFIG_VERSION);
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn old_default_hotkeys_migrate_to_tab_and_custom_bindings_are_preserved() {
        let (old_default, migrated) =
            parse_config(br#"{"version":2,"overlayHotkey":"shift+control+Space"}"#).unwrap();
        assert!(migrated);
        assert_eq!(old_default.overlay_hotkey, DEFAULT_OVERLAY_HOTKEY);

        let (custom, migrated) =
            parse_config(br#"{"version":2,"overlayHotkey":"alt+f10"}"#).unwrap();
        assert!(migrated);
        assert_eq!(custom.overlay_hotkey, "alt+f10");

        for version in [3, 4] {
            let old_default = format!(r#"{{"version":{version},"overlayHotkey":"RightCtrl"}}"#);
            let (config, migrated) = parse_config(old_default.as_bytes()).unwrap();
            assert!(migrated);
            assert_eq!(config.overlay_hotkey, DEFAULT_OVERLAY_HOTKEY);
        }

        let (custom_v4, migrated) =
            parse_config(br#"{"version":4,"overlayHotkey":"alt+f10"}"#).unwrap();
        assert!(migrated);
        assert_eq!(custom_v4.overlay_hotkey, "alt+f10");
    }

    #[test]
    fn schema_four_rightctrl_migration_is_saved_and_remains_writable() {
        let path = test_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"version":4,"mode":"tablet","overlayHotkey":"RightCtrl","notes":"keep me"}"#,
        )
        .unwrap();

        let store = ConfigStore::open(path.clone()).unwrap();
        let snapshot = store.snapshot();
        assert!(snapshot.can_save);
        assert_eq!(snapshot.version, CONFIG_VERSION);
        assert_eq!(snapshot.mode, ViewMode::Tablet);
        assert_eq!(snapshot.notes, "keep me");
        assert_eq!(snapshot.overlay_hotkey, "Tab");
        assert!(store.update_mode_and_bounds(ViewMode::Phone, None).is_ok());

        let persisted: PhoneConfig = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted.version, CONFIG_VERSION);
        assert_eq!(persisted.overlay_hotkey, "Tab");
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn schema_five_migration_preserves_user_data_and_defaults_installed_apps() {
        let (config, migrated) = parse_config(
            br#"{"version":5,"mode":"tablet","settings":{"quietMode":true,"accentOn":false},"notes":"Meine Notiz","overlayHotkey":"alt+f10"}"#,
        )
        .unwrap();
        assert!(migrated);
        assert_eq!(config.version, 6);
        assert_eq!(config.mode, ViewMode::Tablet);
        assert_eq!(config.settings.quiet_mode, true);
        assert_eq!(config.notes, "Meine Notiz");
        assert_eq!(config.overlay_hotkey, "alt+f10");
        assert_eq!(config.installed_apps, default_installed_apps());
    }

    #[test]
    fn installed_apps_are_saved_atomically_and_survive_reload() {
        let path = test_path();
        let store = ConfigStore::open(path.clone()).unwrap();
        store.update_notes("bleibt erhalten".into()).unwrap();
        let installed = store.install_app("focus").unwrap();
        assert!(installed.iter().any(|id| id == "focus"));
        let removed = store.uninstall_app("demo").unwrap();
        assert!(!removed.iter().any(|id| id == "demo"));
        drop(store);

        let reopened = ConfigStore::open(path.clone()).unwrap();
        let config = reopened.config();
        assert_eq!(config.notes, "bleibt erhalten");
        assert!(config.installed_apps.iter().any(|id| id == "focus"));
        assert!(!config.installed_apps.iter().any(|id| id == "demo"));
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn uninstalling_spotify_removes_only_its_phone_store_record() {
        let path = test_path();
        let marker = path.parent().unwrap().join("Spotify.exe");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&marker, b"existing Spotify installation marker").unwrap();
        let store = ConfigStore::open(path.clone()).unwrap();
        store.install_app("spotify").unwrap();
        assert!(store.config().installed_apps.iter().any(|id| id == "spotify"));
        let remaining = store.uninstall_app("spotify").unwrap();
        assert!(!remaining.iter().any(|id| id == "spotify"));
        assert_eq!(fs::read(&marker).unwrap(), b"existing Spotify installation marker");
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn malformed_configuration_is_quarantined_and_defaults_are_written() {
        let path = test_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not json").unwrap();
        let store = ConfigStore::open(path.clone()).unwrap();
        assert!(store.snapshot().can_save);
        assert!(
            store
                .snapshot()
                .notice
                .unwrap()
                .contains("beschädigte Konfiguration")
        );
        let backups: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .collect();
        assert!(
            backups
                .iter()
                .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
        );
        let persisted: PhoneConfig = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted, PhoneConfig::default());
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn future_configuration_is_not_overwritten() {
        let path = test_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let future = br#"{"version":99,"notes":"future data"}"#;
        fs::write(&path, future).unwrap();
        let store = ConfigStore::open(path.clone()).unwrap();
        assert!(!store.snapshot().can_save);
        assert!(store.update_notes("ignored".into()).is_err());
        assert_eq!(fs::read(&path).unwrap(), future);
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }
}
