//! Spotify for the personal LegionOS build.
//!
//! Login: OAuth 2.0 Authorization Code with PKCE in the default browser and a
//! temporary 127.0.0.1 callback. The refresh token is kept in Windows Credential
//! Manager, access tokens only in memory. The frontend gets short-lived access
//! tokens only for the official Web Playback SDK.

mod api;
mod callback;
mod config;
mod credentials;
mod error;
mod pkce;
#[cfg(test)]
mod test_server;
mod tokens;

use api::{PlaylistSummary, Profile, WebApi};
use callback::CallbackListener;
use config::{ConfigState, LocalConfig};
use credentials::KeyringStore;
pub use error::{ErrorCode, SpotifyError};
use serde::Serialize;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokens::TokenManager;

pub const APP_ID: &str = "spotify-player";
pub const APP_FOLDER: &str = "spotify";
const AUTHORIZE_URL: &str = "https://accounts.spotify.com/authorize";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);
/// `streaming`, `user-read-email` and `user-read-private` are required by the Web Playback SDK.
pub const SCOPES: &[&str] = &[
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
];

pub struct SpotifyState {
    tokens: TokenManager,
    api: WebApi,
    login_running: AtomicBool,
    login_cancel: Arc<AtomicBool>,
}

impl SpotifyState {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("LegionOS Spotify (personal build)")
            .build()
            .unwrap_or_default();
        Self {
            tokens: TokenManager::new(http.clone(), tokens::TOKEN_URL, Arc::new(KeyringStore::new())),
            api: WebApi::new(http, api::API_BASE),
            login_running: AtomicBool::new(false),
            login_cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn load_config(app: &AppHandle) -> ConfigState {
    let config_dir = app.path().app_config_dir().ok();
    let exe = std::env::current_exe().ok();
    config::load(&config::candidate_paths(config_dir.as_deref(), exe.as_deref()))
}

/// The personal build only exists where a valid local config is present.
pub fn is_enabled(app: &AppHandle) -> bool {
    load_config(app).is_ready()
}

/// Hides the Spotify app from the catalog in builds without a local config.
pub fn filter_catalog(snapshot: &mut crate::app_catalog::AppStoreSnapshot, enabled: bool) {
    if enabled {
        return;
    }
    snapshot.apps.retain(|item| {
        item.folder != APP_FOLDER && item.manifest.as_ref().is_none_or(|manifest| manifest.id != APP_ID)
    });
}

fn ready_config(app: &AppHandle) -> Result<LocalConfig, SpotifyError> {
    match load_config(app) {
        ConfigState::Ready(config) => Ok(config),
        ConfigState::Missing => Err(ErrorCode::NotConfigured.into()),
        ConfigState::Invalid(_) => Err(ErrorCode::InvalidConfig.into()),
    }
}

pub fn authorize_url(client_id: &str, redirect_uri: &str, challenge: &str, state: &str) -> String {
    let mut url = url::Url::parse(AUTHORIZE_URL).expect("static URL");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", challenge)
        .append_pair("state", state)
        .append_pair("scope", &SCOPES.join(" "));
    url.into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    configured: bool,
    config_error: Option<String>,
    connected: bool,
    login_in_progress: bool,
    /// The redirect URI to register in the Developer Dashboard.
    redirect_uri: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkToken {
    access_token: String,
    expires_in_secs: u64,
}

#[tauri::command]
pub fn spotify_status(app: AppHandle, state: State<'_, SpotifyState>) -> Result<SpotifyStatus, SpotifyError> {
    let config = load_config(&app);
    let redirect_port = match &config {
        ConfigState::Ready(config) if config.redirect_port != 0 => format!(":{}", config.redirect_port),
        _ => String::new(),
    };
    Ok(SpotifyStatus {
        configured: config.is_ready(),
        config_error: match config {
            ConfigState::Invalid(message) => Some(message),
            _ => None,
        },
        connected: state.tokens.has_stored_credentials()?,
        login_in_progress: state.login_running.load(Ordering::SeqCst),
        redirect_uri: format!("http://127.0.0.1{redirect_port}{}", callback::CALLBACK_PATH),
    })
}

struct LoginGuard<'a>(&'a AtomicBool);
impl Drop for LoginGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn spotify_connect(app: AppHandle, state: State<'_, SpotifyState>) -> Result<(), SpotifyError> {
    let config = ready_config(&app)?;
    if state.login_running.swap(true, Ordering::SeqCst) {
        return Err(ErrorCode::Busy.into());
    }
    let _guard = LoginGuard(&state.login_running);
    state.login_cancel.store(false, Ordering::SeqCst);

    let verifier = pkce::code_verifier().map_err(|_| ErrorCode::Internal)?;
    let oauth_state = pkce::oauth_state().map_err(|_| ErrorCode::Internal)?;
    let listener = CallbackListener::bind(config.redirect_port).map_err(|_| ErrorCode::Internal)?;
    let redirect_uri = listener.redirect_uri();
    let url = authorize_url(&config.client_id, &redirect_uri, &pkce::code_challenge(&verifier), &oauth_state);
    app.opener().open_url(url, None::<&str>).map_err(|_| ErrorCode::BrowserOpen)?;

    let cancel = state.login_cancel.clone();
    let expected_state = oauth_state.clone();
    // The listener blocks a worker thread, not the UI or the async runtime.
    let code = tauri::async_runtime::spawn_blocking(move || listener.wait(&expected_state, LOGIN_TIMEOUT, &cancel))
        .await
        .map_err(|_| ErrorCode::Internal)??;
    state.tokens.complete_login(&config.client_id, &code, &redirect_uri, &verifier).await
}

#[tauri::command]
pub fn spotify_cancel_connect(state: State<'_, SpotifyState>) {
    state.login_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn spotify_disconnect(state: State<'_, SpotifyState>) -> Result<(), SpotifyError> {
    state.login_cancel.store(true, Ordering::SeqCst);
    state.tokens.disconnect().await
}

/// Short-lived access token for the Web Playback SDK's `getOAuthToken` callback.
#[tauri::command]
pub async fn spotify_sdk_token(app: AppHandle, state: State<'_, SpotifyState>) -> Result<SdkToken, SpotifyError> {
    let config = ready_config(&app)?;
    let token = state.tokens.access_token(&config.client_id).await?;
    Ok(SdkToken { access_token: token.access_token, expires_in_secs: token.expires_in_secs })
}

/// Forces a new token after the SDK reported `authentication_error`.
#[tauri::command]
pub async fn spotify_invalidate_token(state: State<'_, SpotifyState>) -> Result<(), SpotifyError> {
    state.tokens.invalidate().await;
    Ok(())
}

#[tauri::command]
pub async fn spotify_profile(app: AppHandle, state: State<'_, SpotifyState>) -> Result<Profile, SpotifyError> {
    let config = ready_config(&app)?;
    state.api.profile(&state.tokens, &config.client_id).await
}

#[tauri::command]
pub async fn spotify_playlists(app: AppHandle, state: State<'_, SpotifyState>) -> Result<Vec<PlaylistSummary>, SpotifyError> {
    let config = ready_config(&app)?;
    state.api.playlists(&state.tokens, &config.client_id).await
}

#[tauri::command]
pub async fn spotify_transfer_playback(app: AppHandle, state: State<'_, SpotifyState>, device_id: String, play: bool) -> Result<(), SpotifyError> {
    let config = ready_config(&app)?;
    state.api.transfer(&state.tokens, &config.client_id, &device_id, play).await
}

#[tauri::command]
pub async fn spotify_play_context(app: AppHandle, state: State<'_, SpotifyState>, device_id: String, context_uri: String) -> Result<(), SpotifyError> {
    let config = ready_config(&app)?;
    state.api.play_context(&state.tokens, &config.client_id, &device_id, &context_uri).await
}

#[tauri::command]
pub async fn spotify_set_shuffle(app: AppHandle, state: State<'_, SpotifyState>, device_id: String, enabled: bool) -> Result<(), SpotifyError> {
    let config = ready_config(&app)?;
    state.api.set_shuffle(&state.tokens, &config.client_id, &device_id, enabled).await
}

#[tauri::command]
pub async fn spotify_set_repeat(app: AppHandle, state: State<'_, SpotifyState>, device_id: String, mode: String) -> Result<(), SpotifyError> {
    let config = ready_config(&app)?;
    state.api.set_repeat(&state.tokens, &config.client_id, &device_id, &mode).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_catalog::scan_apps_dir;

    #[test]
    fn authorize_url_uses_pkce_s256_loopback_and_required_scopes() {
        let url = url::Url::parse(&authorize_url("client123", "http://127.0.0.1:5000/callback", "challenge", "state-1")).unwrap();
        assert_eq!(url.host_str(), Some("accounts.spotify.com"));
        assert_eq!(url.path(), "/authorize");
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(pairs["response_type"], "code");
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(pairs["code_challenge"], "challenge");
        assert_eq!(pairs["state"], "state-1");
        assert_eq!(pairs["redirect_uri"], "http://127.0.0.1:5000/callback");
        for scope in ["streaming", "user-read-email", "user-read-private"] {
            assert!(pairs["scope"].split(' ').any(|value| value == scope));
        }
        assert!(!pairs.contains_key("client_secret"));
        assert!(!pairs["redirect_uri"].contains("localhost"));
    }

    #[test]
    fn real_manifest_is_valid_and_hidden_unless_the_personal_build_is_configured() {
        let apps = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../apps");
        let snapshot = scan_apps_dir(&apps, &[APP_ID.into()]).unwrap();
        let item = snapshot.apps.iter().find(|item| item.folder == APP_FOLDER).expect("apps/spotify is discovered");
        assert!(item.error.is_none(), "{:?}", item.error);
        assert_eq!(item.manifest.as_ref().unwrap().id, APP_ID);
        assert!(item.installed);

        let mut hidden = snapshot.clone();
        filter_catalog(&mut hidden, false);
        assert!(hidden.apps.iter().all(|item| item.folder != APP_FOLDER));
        assert_eq!(hidden.apps.len(), snapshot.apps.len() - 1, "other apps are untouched");
        let mut shown = snapshot.clone();
        filter_catalog(&mut shown, true);
        assert_eq!(shown.apps.len(), snapshot.apps.len());
    }

    #[test]
    fn no_local_config_or_token_file_is_inside_the_bundled_apps_folder() {
        let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../apps/spotify");
        for entry in std::fs::read_dir(folder).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().to_lowercase();
            assert!(!name.contains("local") && !name.contains("token") && !name.ends_with(".env"), "{name} must not be bundled");
        }
    }
}
