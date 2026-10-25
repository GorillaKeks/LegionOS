use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, path::BaseDirectory};

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const SUPPORTED: &[(&str, &str, &str)] = &[
    ("settings", "settings", "internal"),
    ("notes", "notes", "internal"),
    ("demo", "demo", "internal"),
    ("focus", "focus", "internal"),
    ("snake", "snake", "internal"),
    ("pong", "pong", "internal"),
    ("space-invaders", "space-invaders", "internal"),
    ("roadwatch", "roadwatch", "internal"),
    ("radio", "radio", "internal"),
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub icon: String,
    #[serde(rename = "type")]
    pub app_type: String,
    pub entry: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub folder: String,
    pub manifest: Option<AppManifest>,
    pub error: Option<String>,
    pub installed: bool,
    #[serde(skip_serializing)]
    declared_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStoreSnapshot {
    pub apps: Vec<CatalogItem>,
    pub installed_ids: Vec<String>,
}

pub fn resolve_apps_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        if let Ok(exe) = std::env::current_exe()
            && let Some(path) = resolve_dev_apps_dir(&exe)
        {
            return Ok(path);
        }
    }

    app.path()
        .resolve("apps", BaseDirectory::Resource)
        .map_err(|error| format!("Gebündelter apps-Ordner konnte nicht aufgelöst werden: {error}"))?
        .canonicalize()
        .map_err(|error| format!("Gebündelter apps-Ordner ist nicht verfügbar: {error}"))
}

fn resolve_dev_apps_dir(executable: &Path) -> Option<PathBuf> {
    executable.ancestors().find_map(|ancestor| {
        if ancestor.file_name().is_some_and(|name| name == "src-tauri")
            && ancestor.join("tauri.conf.json").is_file()
        {
            ancestor.parent()?.join("apps").canonicalize().ok()
        } else {
            None
        }
    })
}

pub fn scan_apps_dir(root: &Path, installed_ids: &[String]) -> Result<AppStoreSnapshot, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("App-Ordner konnte nicht gelesen werden: {error}"))?;
    if !root.is_dir() {
        return Err("Der lokale apps-Pfad ist kein Ordner.".into());
    }

    let mut items = Vec::new();
    let directories = fs::read_dir(&root)
        .map_err(|error| format!("App-Ordner konnte nicht gelesen werden: {error}"))?;
    for directory in directories {
        let directory = directory
            .map_err(|error| format!("App-Ordner konnte nicht gelesen werden: {error}"))?;
        let file_type = directory
            .file_type()
            .map_err(|error| format!("App-Ordner konnte nicht geprüft werden: {error}"))?;
        // Do not follow symlinked folders or read anything outside apps/.
        if !file_type.is_dir() {
            continue;
        }
        let folder = directory.file_name().to_string_lossy().into_owned();
        let path = directory.path();
        let canonical_folder = match path.canonicalize() {
            Ok(path) if path.parent() == Some(root.as_path()) => path,
            _ => {
                items.push(invalid_item(
                    folder,
                    "App-Ordner liegt außerhalb des lokalen apps-Ordners.",
                ));
                continue;
            }
        };
        if !valid_id(&folder) {
            items.push(invalid_item(
                folder,
                "Der Ordnername ist keine gültige App-ID.",
            ));
            continue;
        }
        let manifest_path = canonical_folder.join("manifest.json");
        let metadata = match fs::symlink_metadata(&manifest_path) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
            Ok(_) => {
                items.push(invalid_item(
                    folder,
                    "manifest.json muss eine normale Datei sein.",
                ));
                continue;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                items.push(invalid_item(folder, "manifest.json fehlt."));
                continue;
            }
            Err(error) => {
                items.push(invalid_item(
                    folder,
                    format!("Manifest konnte nicht geprüft werden: {error}"),
                ));
                continue;
            }
        };
        if metadata.len() > MAX_MANIFEST_BYTES {
            items.push(invalid_item(folder, "Manifest ist größer als 64 KiB."));
            continue;
        }
        let canonical_manifest = match manifest_path.canonicalize() {
            Ok(path) if path.parent() == Some(canonical_folder.as_path()) => path,
            _ => {
                items.push(invalid_item(
                    folder,
                    "Manifest liegt außerhalb seines App-Ordners.",
                ));
                continue;
            }
        };
        let bytes = match fs::read(canonical_manifest) {
            Ok(bytes) => bytes,
            Err(error) => {
                items.push(invalid_item(
                    folder,
                    format!("Manifest konnte nicht gelesen werden: {error}"),
                ));
                continue;
            }
        };
        let value: serde_json::Value = match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(error) => {
                items.push(invalid_item(
                    folder,
                    format!("Manifest ist ungültig: {error}"),
                ));
                continue;
            }
        };
        let declared_id = value
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| valid_id(id))
            .map(str::to_owned);
        let manifest: AppManifest = match serde_json::from_value(value) {
            Ok(manifest) => manifest,
            Err(error) => {
                items.push(invalid_item_with_id(
                    folder,
                    format!("Manifest ist ungültig: {error}"),
                    declared_id,
                ));
                continue;
            }
        };
        match validate_manifest(&manifest) {
            Ok(()) => items.push(CatalogItem {
                installed: installed_ids.iter().any(|id| id == &manifest.id),
                folder,
                declared_id: Some(manifest.id.clone()),
                manifest: Some(manifest),
                error: None,
            }),
            Err(error) => items.push(invalid_item_with_id(folder, error, declared_id)),
        }
    }

    let mut seen = HashMap::<String, usize>::new();
    for item in &items {
        if let Some(id) = &item.declared_id {
            *seen.entry(id.clone()).or_default() += 1;
        }
    }
    for item in &mut items {
        if item
            .declared_id
            .as_ref()
            .is_some_and(|id| seen.get(id).copied().unwrap_or(0) > 1)
        {
            item.manifest = None;
            item.installed = false;
            item.error =
                Some("Doppelte App-ID im lokalen Katalog; keine der Kopien ist verwendbar.".into());
        }
    }
    items.sort_by(|left, right| left.folder.cmp(&right.folder));
    Ok(AppStoreSnapshot {
        apps: items,
        installed_ids: installed_ids.to_vec(),
    })
}

pub fn validate_installable(snapshot: &AppStoreSnapshot, id: &str) -> Result<(), String> {
    let matches = snapshot
        .apps
        .iter()
        .filter(|item| {
            item.manifest
                .as_ref()
                .is_some_and(|manifest| manifest.id == id)
        })
        .count();
    if matches != 1 {
        return Err(
            "Diese App ist ungültig, nicht unterstützt oder ihre ID ist doppelt vorhanden.".into(),
        );
    }
    Ok(())
}

pub fn set_installed_ids(snapshot: &mut AppStoreSnapshot, installed_ids: Vec<String>) {
    for item in &mut snapshot.apps {
        item.installed = item
            .manifest
            .as_ref()
            .is_some_and(|manifest| installed_ids.iter().any(|id| id == &manifest.id));
    }
    snapshot.installed_ids = installed_ids;
}

fn validate_manifest(manifest: &AppManifest) -> Result<(), String> {
    if !valid_id(&manifest.id) {
        return Err("App-ID muss eine gültige, stabile Kennung sein.".into());
    }
    if !bounded_text(&manifest.name, 1, 48) {
        return Err("App-Name muss 1 bis 48 Zeichen lang sein.".into());
    }
    if !valid_version(&manifest.version) {
        return Err("Version muss dem Format MAJOR.MINOR.PATCH entsprechen.".into());
    }
    if !bounded_text(&manifest.description, 1, 240) {
        return Err("Beschreibung muss 1 bis 240 Zeichen lang sein.".into());
    }
    if !["settings", "note", "spark", "snake", "pong", "invaders", "roadwatch", "radio"]
        .contains(&manifest.icon.as_str())
    {
        return Err("Dieses Icon wird nicht unterstützt.".into());
    }
    if !SUPPORTED.iter().any(|(id, entry, app_type)| {
        *id == manifest.id && *entry == manifest.entry && *app_type == manifest.app_type
    }) {
        return Err(
            "App-Typ und Einstiegspunkt sind nicht registriert oder passen nicht zur App-ID."
                .into(),
        );
    }
    Ok(())
}

fn bounded_text(value: &str, min: usize, max: usize) -> bool {
    let count = value.chars().count();
    count >= min && count <= max && !value.trim().is_empty()
}

fn valid_version(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (part == &"0" || !part.starts_with('0'))
        })
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

fn invalid_item(folder: String, error: impl Into<String>) -> CatalogItem {
    invalid_item_with_id(folder, error, None)
}

fn invalid_item_with_id(
    folder: String,
    error: impl Into<String>,
    declared_id: Option<String>,
) -> CatalogItem {
    CatalogItem {
        folder,
        manifest: None,
        error: Some(error.into()),
        installed: false,
        declared_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "phone-app-catalog-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_manifest(root: &Path, folder: &str, id: &str, entry: &str) {
        let dir = root.join(folder);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("manifest.json"),
            format!(r#"{{"id":"{id}","name":"{folder}","version":"1.0.0","description":"Lokale Test-App","icon":"spark","type":"internal","entry":"{entry}"}}"#),
        )
        .unwrap();
    }

    #[test]
    fn lists_valid_local_apps_and_marks_installation() {
        let root = root();
        write_manifest(&root, "focus", "focus", "focus");
        let snapshot = scan_apps_dir(&root, &["focus".into()]).unwrap();
        assert_eq!(snapshot.apps.len(), 1);
        assert!(snapshot.apps[0].installed);
        assert_eq!(snapshot.apps[0].manifest.as_ref().unwrap().id, "focus");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn accepts_registered_snake_manifest_and_icon() {
        let manifest = AppManifest {
            id: "snake".into(),
            name: "Snake".into(),
            version: "1.0.0".into(),
            description: "Klassisches Snake im Legion-Design".into(),
            icon: "snake".into(),
            app_type: "internal".into(),
            entry: "snake".into(),
        };
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn accepts_registered_pong_manifest_and_icon() {
        let manifest = AppManifest {
            id: "pong".into(),
            name: "Pong".into(),
            version: "1.0.0".into(),
            description: "Arcade-Klassiker gegen die LegionOS-KI".into(),
            icon: "pong".into(),
            app_type: "internal".into(),
            entry: "pong".into(),
        };
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn accepts_registered_space_invaders_manifest_and_icon() {
        let manifest = AppManifest {
            id: "space-invaders".into(),
            name: "Space Invaders".into(),
            version: "1.0.0".into(),
            description: "Defend the galaxy in a retro arcade shooter".into(),
            icon: "invaders".into(),
            app_type: "internal".into(),
            entry: "space-invaders".into(),
        };
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn accepts_registered_radio_manifest_and_icon() {
        let manifest = AppManifest {
            id: "radio".into(),
            name: "Radio".into(),
            version: "1.0.0".into(),
            description: "Internet radio stations".into(),
            icon: "radio".into(),
            app_type: "internal".into(),
            entry: "radio".into(),
        };
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn rejects_traversal_ids_unsupported_types_entries_and_versions() {
        let mut manifest = AppManifest {
            id: "../outside".into(),
            name: "Test".into(),
            version: "1.0.0".into(),
            description: "Test".into(),
            icon: "spark".into(),
            app_type: "internal".into(),
            entry: "focus".into(),
        };
        assert!(validate_manifest(&manifest).is_err());
        manifest.id = "focus".into();
        manifest.app_type = "script".into();
        assert!(validate_manifest(&manifest).is_err());
        manifest.app_type = "internal".into();
        manifest.entry = "../../run".into();
        assert!(validate_manifest(&manifest).is_err());
        manifest.entry = "focus".into();
        manifest.version = "01.0.0".into();
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn duplicate_ids_are_all_rejected_and_cannot_be_installed() {
        let root = root();
        write_manifest(&root, "notes", "notes", "notes");
        write_manifest(&root, "notes-copy", "notes", "notes");
        let snapshot = scan_apps_dir(&root, &[]).unwrap();
        let notes: Vec<_> = snapshot
            .apps
            .iter()
            .filter(|item| item.folder.starts_with("notes"))
            .collect();
        assert_eq!(notes.len(), 2);
        assert!(
            notes.iter().all(|item| item.manifest.is_none()
                && item.error.as_deref().unwrap().contains("Doppelte"))
        );
        assert!(validate_installable(&snapshot, "notes").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_duplicate_still_invalidates_the_other_copy() {
        let root = root();
        write_manifest(&root, "notes", "notes", "notes");
        let duplicate = root.join("notes-copy");
        fs::create_dir_all(&duplicate).unwrap();
        fs::write(duplicate.join("manifest.json"), r#"{"id":"notes","name":"invalid","version":"1.0.0","description":"duplicate","icon":"note","type":"external","entry":"notes","extra":true}"#).unwrap();
        let snapshot = scan_apps_dir(&root, &[]).unwrap();
        let notes: Vec<_> = snapshot
            .apps
            .iter()
            .filter(|item| item.folder.starts_with("notes"))
            .collect();
        assert!(
            notes.iter().all(|item| item.manifest.is_none()
                && item.error.as_deref().unwrap().contains("Doppelte"))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_invalid_folder_and_manifest_without_failing_the_scan() {
        let root = root();
        fs::create_dir_all(root.join("../outside")).unwrap();
        let invalid = root.join("bad-id");
        fs::create_dir_all(&invalid).unwrap();
        fs::write(invalid.join("manifest.json"), "{}").unwrap();
        let snapshot = scan_apps_dir(&root, &[]).unwrap();
        assert!(snapshot.apps.iter().any(|item| item.error.is_some()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn development_catalog_path_is_derived_from_the_tauri_project_marker() {
        let root = root();
        let tauri_dir = root.join("src-tauri");
        let executable = tauri_dir.join("target/debug/legionos.exe");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(tauri_dir.join("tauri.conf.json"), "{}").unwrap();
        fs::create_dir_all(root.join("apps")).unwrap();
        let resolved = resolve_dev_apps_dir(&executable).unwrap();
        assert_eq!(resolved, root.join("apps").canonicalize().unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
