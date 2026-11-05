//! Token endpoint calls and the in-memory access token.
//!
//! Access tokens live only in memory. The refresh token is read from and written
//! to the credential store and never leaves Rust. One async mutex guards the
//! cached token, so concurrent callers share a single refresh.

use super::{
    credentials::CredentialStore,
    error::{ErrorCode, SpotifyError, from_transport, retry_after},
};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

pub const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
/// Refresh this long before Spotify's expiry so the SDK never gets a dying token.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

// No Debug derive: these structs hold secrets.
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    token_type: String,
    expires_in: u64,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenErrorBody {
    #[serde(default)]
    error: String,
}

#[derive(Clone)]
struct AccessToken {
    value: String,
    expires_at: Instant,
}

pub struct IssuedToken {
    pub access_token: String,
    pub expires_in_secs: u64,
}

/// Redacted, so an accidental `{:?}` can never print the token.
impl std::fmt::Debug for IssuedToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("IssuedToken").field("access_token", &"<redacted>").field("expires_in_secs", &self.expires_in_secs).finish()
    }
}

pub(super) struct TokenManager {
    http: Client,
    token_url: String,
    store: Arc<dyn CredentialStore>,
    cached: Mutex<Option<AccessToken>>,
}

impl TokenManager {
    pub(super) fn new(http: Client, token_url: impl Into<String>, store: Arc<dyn CredentialStore>) -> Self {
        Self { http, token_url: token_url.into(), store, cached: Mutex::new(None) }
    }

    pub(super) fn has_stored_credentials(&self) -> Result<bool, SpotifyError> {
        Ok(self.store.load()?.is_some())
    }

    /// Exchanges the authorization code using the PKCE verifier (no client secret).
    pub(super) async fn complete_login(&self, client_id: &str, code: &str, redirect_uri: &str, verifier: &str) -> Result<(), SpotifyError> {
        let form = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("code_verifier", verifier),
        ];
        let mut cached = self.cached.lock().await;
        let response = self.post(&form).await?;
        let refresh_token = response.refresh_token.as_deref().filter(|token| !token.is_empty()).ok_or(ErrorCode::InvalidResponse)?;
        self.store.save(refresh_token)?;
        *cached = Some(to_access_token(&response)?);
        Ok(())
    }

    /// Returns a valid access token, refreshing it once if needed.
    pub(super) async fn access_token(&self, client_id: &str) -> Result<IssuedToken, SpotifyError> {
        let mut cached = self.cached.lock().await;
        if let Some(token) = cached.as_ref()
            && let Some(remaining) = token.expires_at.checked_duration_since(Instant::now())
            && remaining > EXPIRY_MARGIN
        {
            return Ok(IssuedToken { access_token: token.value.clone(), expires_in_secs: remaining.as_secs() });
        }
        *cached = None;
        let refresh_token = self.store.load()?.ok_or(ErrorCode::NotConnected)?;
        let form = [("grant_type", "refresh_token"), ("refresh_token", refresh_token.as_str()), ("client_id", client_id)];
        let response = match self.post(&form).await {
            Ok(response) => response,
            Err(error) if error.code == ErrorCode::Revoked => {
                // The refresh token is dead (revoked access or changed Client ID): forget it.
                let _ = self.store.delete();
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        if let Some(rotated) = response.refresh_token.as_deref().filter(|token| !token.is_empty()) {
            self.store.save(rotated)?;
        }
        let token = to_access_token(&response)?;
        let issued = IssuedToken { access_token: token.value.clone(), expires_in_secs: response.expires_in };
        *cached = Some(token);
        Ok(issued)
    }

    /// Drops the cached access token after Spotify rejected it (HTTP 401).
    pub(super) async fn invalidate(&self) {
        *self.cached.lock().await = None;
    }

    pub(super) async fn disconnect(&self) -> Result<(), SpotifyError> {
        let mut cached = self.cached.lock().await;
        *cached = None;
        self.store.delete()
    }

    async fn post(&self, form: &[(&str, &str)]) -> Result<TokenResponse, SpotifyError> {
        let response = self.http.post(&self.token_url).form(form).send().await.map_err(|error| from_transport(&error))?;
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.bytes().await.map_err(|error| from_transport(&error))?;
        if status.is_success() {
            let parsed: TokenResponse = serde_json::from_slice(&bytes).map_err(|_| ErrorCode::InvalidResponse)?;
            if parsed.access_token.is_empty() || !parsed.token_type.eq_ignore_ascii_case("bearer") {
                return Err(ErrorCode::InvalidResponse.into());
            }
            return Ok(parsed);
        }
        Err(match status {
            StatusCode::TOO_MANY_REQUESTS => SpotifyError::rate_limited(retry_after(&headers)),
            status if status.is_server_error() => ErrorCode::Unavailable.into(),
            StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED => {
                let error = serde_json::from_slice::<TokenErrorBody>(&bytes).map(|body| body.error).unwrap_or_default();
                match error.as_str() {
                    "invalid_grant" => ErrorCode::Revoked.into(),
                    "invalid_client" | "unauthorized_client" => ErrorCode::InvalidConfig.into(),
                    _ => ErrorCode::InvalidResponse.into(),
                }
            }
            StatusCode::FORBIDDEN => ErrorCode::DevModeRestricted.into(),
            _ => ErrorCode::InvalidResponse.into(),
        })
    }
}

fn to_access_token(response: &TokenResponse) -> Result<AccessToken, SpotifyError> {
    if response.expires_in == 0 {
        return Err(ErrorCode::InvalidResponse.into());
    }
    Ok(AccessToken { value: response.access_token.clone(), expires_at: Instant::now() + Duration::from_secs(response.expires_in) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spotify::{credentials::memory::MemoryStore, test_server::TestServer};

    fn manager(server: &TestServer, store: Arc<MemoryStore>) -> TokenManager {
        TokenManager::new(Client::new(), server.url("/api/token"), store)
    }

    const OK: &str = r#"{"access_token":"access-1","token_type":"Bearer","expires_in":3600,"refresh_token":"refresh-1","scope":"streaming"}"#;

    #[test]
    fn code_exchange_sends_pkce_verifier_without_secret_and_stores_refresh_token() {
        let server = TestServer::start(vec![(200, OK.into())]);
        let store = Arc::new(MemoryStore::default());
        let tokens = manager(&server, store.clone());
        tauri::async_runtime::block_on(tokens.complete_login("client", "the-code", "http://127.0.0.1:5000/callback", "the-verifier")).unwrap();
        let body = &server.requests()[0];
        assert!(body.contains("grant_type=authorization_code"));
        assert!(body.contains("code_verifier=the-verifier"));
        assert!(body.contains("client_id=client"));
        assert!(!body.contains("client_secret"));
        assert_eq!(store.load().unwrap().as_deref(), Some("refresh-1"));
        // The fresh access token is cached: no second request.
        let issued = tauri::async_runtime::block_on(tokens.access_token("client")).unwrap();
        assert_eq!(issued.access_token, "access-1");
        assert_eq!(server.requests().len(), 1);
    }

    #[test]
    fn code_exchange_errors_are_mapped_and_store_nothing() {
        for (status, body, code) in [
            (400, r#"{"error":"invalid_grant"}"#, ErrorCode::Revoked),
            (400, r#"{"error":"invalid_client"}"#, ErrorCode::InvalidConfig),
            (503, "", ErrorCode::Unavailable),
            (200, r#"{"access_token":"a","token_type":"Bearer","expires_in":3600}"#, ErrorCode::InvalidResponse),
            (200, "not json", ErrorCode::InvalidResponse),
        ] {
            let server = TestServer::start(vec![(status, body.into())]);
            let store = Arc::new(MemoryStore::default());
            let error = tauri::async_runtime::block_on(manager(&server, store.clone()).complete_login("c", "code", "uri", "v")).unwrap_err();
            assert_eq!(error.code, code, "status {status} body {body}");
            assert_eq!(store.load().unwrap(), None);
        }
    }

    #[test]
    fn rate_limit_reports_retry_after() {
        let server = TestServer::start(vec![(429, String::new())]);
        let store = Arc::new(MemoryStore(std::sync::Mutex::new(Some("r".into()))));
        let error = tauri::async_runtime::block_on(manager(&server, store).access_token("c")).unwrap_err();
        assert_eq!(error, SpotifyError::rate_limited(Some(7)));
    }

    #[test]
    fn refresh_uses_stored_token_and_rotates_it() {
        let server = TestServer::start(vec![(200, OK.into())]);
        let store = Arc::new(MemoryStore(std::sync::Mutex::new(Some("old-refresh".into()))));
        let issued = tauri::async_runtime::block_on(manager(&server, store.clone()).access_token("client")).unwrap();
        assert_eq!(issued.access_token, "access-1");
        assert!(server.requests()[0].contains("refresh_token=old-refresh"));
        assert_eq!(store.load().unwrap().as_deref(), Some("refresh-1"));
    }

    #[test]
    fn refresh_keeps_the_old_refresh_token_when_spotify_does_not_rotate_it() {
        let server = TestServer::start(vec![(200, r#"{"access_token":"a2","token_type":"Bearer","expires_in":3600}"#.into())]);
        let store = Arc::new(MemoryStore(std::sync::Mutex::new(Some("keep-me".into()))));
        tauri::async_runtime::block_on(manager(&server, store.clone()).access_token("client")).unwrap();
        assert_eq!(store.load().unwrap().as_deref(), Some("keep-me"));
    }

    #[test]
    fn revoked_refresh_token_is_deleted() {
        let server = TestServer::start(vec![(400, r#"{"error":"invalid_grant","error_description":"Refresh token revoked"}"#.into())]);
        let store = Arc::new(MemoryStore(std::sync::Mutex::new(Some("revoked".into()))));
        let error = tauri::async_runtime::block_on(manager(&server, store.clone()).access_token("client")).unwrap_err();
        assert_eq!(error.code, ErrorCode::Revoked);
        assert_eq!(store.load().unwrap(), None);
    }

    #[test]
    fn no_stored_credentials_means_not_connected_without_network() {
        let server = TestServer::start(vec![]);
        let error = tauri::async_runtime::block_on(manager(&server, Arc::new(MemoryStore::default())).access_token("c")).unwrap_err();
        assert_eq!(error.code, ErrorCode::NotConnected);
        assert!(server.requests().is_empty());
    }

    #[test]
    fn concurrent_callers_share_one_refresh() {
        let server = TestServer::start(vec![(200, OK.into()), (200, OK.into())]);
        let store = Arc::new(MemoryStore(std::sync::Mutex::new(Some("r".into()))));
        let tokens = Arc::new(manager(&server, store));
        tauri::async_runtime::block_on(async {
            let calls = (0..8).map(|_| {
                let tokens = tokens.clone();
                tauri::async_runtime::spawn(async move { tokens.access_token("c").await.map(|t| t.access_token) })
            });
            for call in futures_util::future::join_all(calls).await {
                assert_eq!(call.unwrap().unwrap(), "access-1");
            }
        });
        assert_eq!(server.requests().len(), 1);
    }

    #[test]
    fn expired_or_invalidated_tokens_are_refreshed_and_disconnect_clears_everything() {
        let server = TestServer::start(vec![
            (200, r#"{"access_token":"short","token_type":"Bearer","expires_in":30,"refresh_token":"r1"}"#.into()),
            (200, OK.into()),
            (200, OK.into()),
        ]);
        let store = Arc::new(MemoryStore(std::sync::Mutex::new(Some("r0".into()))));
        let tokens = manager(&server, store.clone());
        tauri::async_runtime::block_on(async {
            assert_eq!(tokens.access_token("c").await.unwrap().access_token, "short");
            // 30 s is inside the 60 s safety margin, so the next call refreshes.
            assert_eq!(tokens.access_token("c").await.unwrap().access_token, "access-1");
            tokens.invalidate().await;
            tokens.access_token("c").await.unwrap();
            assert_eq!(server.requests().len(), 3);
            tokens.disconnect().await.unwrap();
            assert_eq!(store.load().unwrap(), None);
            assert_eq!(tokens.access_token("c").await.unwrap_err().code, ErrorCode::NotConnected);
        });
    }
}
