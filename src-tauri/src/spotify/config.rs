//! Local, Git-ignored configuration for the personal Spotify build.
//!
//! The Client ID is public OAuth configuration, but it belongs to the owner's
//! Development Mode app, so it is never bundled. It is read at runtime from
//! `spotify.local.json` in the LegionOS config folder or, in debug builds only,
//! from the repository root.

use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub const CONFIG_FILE: &str = "spotify.local.json";
const MAX_CONFIG_BYTES: u64 = 4 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawConfig {
    client_id: String,
    #[serde(default)]
    redirect_port: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalConfig {
    pub client_id: String,
    /// 0 means "pick a free port"; Spotify allows dynamic ports for loopback IP literals.
    pub redirect_port: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConfigState {
    Missing,
    Invalid(String),
    Ready(LocalConfig),
}

impl ConfigState {
    pub fn is_ready(&self) -> bool {
        matches!(self, Self::Ready(_))
    }
}

/// Where the config may live, in priority order.
pub fn candidate_paths(app_config_dir: Option<&Path>, executable: Option<&Path>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(dir) = app_config_dir {
        paths.push(dir.join(CONFIG_FILE));
    }
    if cfg!(debug_assertions)
        && let Some(root) = executable.and_then(repository_root)
    {
        paths.push(root.join(CONFIG_FILE));
    }
    paths
}

fn repository_root(executable: &Path) -> Option<PathBuf> {
    executable.ancestors().find_map(|ancestor| {
        (ancestor.file_name().is_some_and(|name| name == "src-tauri")
            && ancestor.join("tauri.conf.json").is_file())
        .then(|| ancestor.parent().map(Path::to_path_buf))
        .flatten()
    })
}

/// Loads the first config file that exists. A broken file is reported, not skipped,
/// so a typo never silently falls back to another location.
pub fn load(paths: &[PathBuf]) -> ConfigState {
    for path in paths {
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return ConfigState::Invalid("spotify.local.json could not be read.".into()),
        };
        if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
            return ConfigState::Invalid("spotify.local.json must be a small regular file.".into());
        }
        let Ok(bytes) = fs::read(path) else {
            return ConfigState::Invalid("spotify.local.json could not be read.".into());
        };
        return parse(&bytes);
    }
    ConfigState::Missing
}

pub fn parse(bytes: &[u8]) -> ConfigState {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let raw: RawConfig = match serde_json::from_slice(bytes) {
        Ok(raw) => raw,
        Err(_) => {
            return ConfigState::Invalid(
                "spotify.local.json must contain only \"clientId\" and optional \"redirectPort\"."
                    .into(),
            );
        }
    };
    let client_id = raw.client_id.trim().to_owned();
    if !valid_client_id(&client_id) {
        return ConfigState::Invalid(
            "The Client ID must be the 32-character ID from your Spotify Developer Dashboard."
                .into(),
        );
    }
    if raw.redirect_port != 0 && raw.redirect_port < 1024 {
        return ConfigState::Invalid("redirectPort must be 0 or between 1024 and 65535.".into());
    }
    ConfigState::Ready(LocalConfig {
        client_id,
        redirect_port: raw.redirect_port,
    })
}

fn valid_client_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    const ID: &str = "0123456789abcdef0123456789abcdef";

    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "legionos-spotify-config-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn accepts_a_valid_client_id_and_optional_port() {
        let state = parse(format!(r#"{{"clientId":"{ID}"}}"#).as_bytes());
        assert_eq!(state, ConfigState::Ready(LocalConfig { client_id: ID.into(), redirect_port: 0 }));
        let state = parse(format!("\u{FEFF}{{\"clientId\":\" {ID} \",\"redirectPort\":43821}}").as_bytes());
        assert_eq!(state, ConfigState::Ready(LocalConfig { client_id: ID.into(), redirect_port: 43821 }));
    }

    #[test]
    fn rejects_placeholders_secrets_unknown_fields_and_privileged_ports() {
        assert!(matches!(parse(br#"{"clientId":"PASTE_YOUR_32_CHARACTER_CLIENT_ID_HERE"}"#), ConfigState::Invalid(_)));
        assert!(matches!(parse(format!(r#"{{"clientId":"{ID}","clientSecret":"x"}}"#).as_bytes()), ConfigState::Invalid(_)));
        assert!(matches!(parse(format!(r#"{{"clientId":"{ID}","redirectPort":80}}"#).as_bytes()), ConfigState::Invalid(_)));
        assert!(matches!(parse(b"not json"), ConfigState::Invalid(_)));
    }

    #[test]
    fn invalid_messages_never_echo_the_file_contents() {
        let ConfigState::Invalid(message) = parse(br#"{"clientId":"short-secret-looking-value"}"#) else { panic!() };
        assert!(!message.contains("short-secret-looking-value"));
    }

    #[test]
    fn missing_file_is_reported_as_missing_and_first_existing_file_wins() {
        let dir = temp_dir();
        let first = dir.join("a.json");
        let second = dir.join("b.json");
        assert_eq!(load(&[first.clone(), second.clone()]), ConfigState::Missing);
        fs::write(&second, format!(r#"{{"clientId":"{ID}"}}"#)).unwrap();
        assert!(load(&[first.clone(), second.clone()]).is_ready());
        fs::write(&first, "{broken").unwrap();
        assert!(matches!(load(&[first, second]), ConfigState::Invalid(_)));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn debug_builds_also_look_in_the_repository_root() {
        let dir = temp_dir();
        let tauri_dir = dir.join("src-tauri");
        fs::create_dir_all(tauri_dir.join("target/debug")).unwrap();
        fs::write(tauri_dir.join("tauri.conf.json"), "{}").unwrap();
        let exe = tauri_dir.join("target/debug/legionos.exe");
        let paths = candidate_paths(Some(Path::new("C:/config")), Some(&exe));
        assert_eq!(paths[0], Path::new("C:/config").join(CONFIG_FILE));
        if cfg!(debug_assertions) {
            assert_eq!(paths[1], dir.join(CONFIG_FILE));
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
