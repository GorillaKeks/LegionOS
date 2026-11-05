//! The few Spotify Web API calls the player needs that the Web Playback SDK cannot
//! do itself (account name, transfer, shuffle, repeat, playlists, start a playlist).
//! They run in Rust so the frontend never needs a token for them.

use super::{
    error::{ErrorCode, SpotifyError, from_transport, retry_after},
    tokens::TokenManager,
};
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const API_BASE: &str = "https://api.spotify.com/v1";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub display_name: Option<String>,
    pub image_url: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub uri: String,
    pub name: String,
    pub owner: Option<String>,
    pub image_url: Option<String>,
    pub track_count: Option<u64>,
}

#[derive(Deserialize)]
struct Image {
    url: String,
}

#[derive(Deserialize)]
struct ProfileResponse {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    images: Vec<Image>,
}

#[derive(Deserialize)]
struct Count {
    #[serde(default)]
    total: Option<u64>,
}

#[derive(Deserialize)]
struct Owner {
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct PlaylistItem {
    uri: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    owner: Option<Owner>,
    #[serde(default)]
    images: Option<Vec<Image>>,
    // Spotify renamed `tracks` to `items` for Development Mode apps in February 2026.
    #[serde(default)]
    items: Option<Count>,
    #[serde(default)]
    tracks: Option<Count>,
}

#[derive(Deserialize)]
struct Paging<T> {
    #[serde(default = "Vec::new")]
    items: Vec<Option<T>>,
}

pub(super) struct WebApi {
    http: Client,
    base: String,
}

pub fn valid_device_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub fn valid_context_uri(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("spotify:") else { return false };
    let Some((kind, id)) = rest.split_once(':') else { return false };
    matches!(kind, "playlist" | "album" | "artist") && id.len() == 22 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

impl WebApi {
    pub(super) fn new(http: Client, base: impl Into<String>) -> Self {
        Self { http, base: base.into() }
    }

    pub(super) async fn profile(&self, tokens: &TokenManager, client_id: &str) -> Result<Profile, SpotifyError> {
        let body = self.send(tokens, client_id, Method::GET, "/me", &[], None).await?;
        let profile: ProfileResponse = serde_json::from_slice(&body).map_err(|_| ErrorCode::InvalidResponse)?;
        Ok(Profile {
            display_name: profile.display_name.filter(|name| !name.trim().is_empty()),
            image_url: profile.images.into_iter().next().map(|image| image.url),
        })
    }

    pub(super) async fn playlists(&self, tokens: &TokenManager, client_id: &str) -> Result<Vec<PlaylistSummary>, SpotifyError> {
        let body = self.send(tokens, client_id, Method::GET, "/me/playlists", &[("limit", "50")], None).await?;
        let page: Paging<PlaylistItem> = serde_json::from_slice(&body).map_err(|_| ErrorCode::InvalidResponse)?;
        Ok(page
            .items
            .into_iter()
            .flatten()
            .filter(|item| valid_context_uri(&item.uri))
            .map(|item| PlaylistSummary {
                track_count: item.items.and_then(|count| count.total).or(item.tracks.and_then(|count| count.total)),
                image_url: item.images.and_then(|images| images.into_iter().next()).map(|image| image.url),
                owner: item.owner.and_then(|owner| owner.display_name),
                name: item.name,
                uri: item.uri,
            })
            .collect())
    }

    pub(super) async fn transfer(&self, tokens: &TokenManager, client_id: &str, device_id: &str, play: bool) -> Result<(), SpotifyError> {
        require(valid_device_id(device_id))?;
        self.send(tokens, client_id, Method::PUT, "/me/player", &[], Some(json!({ "device_ids": [device_id], "play": play }))).await.map(drop)
    }

    pub(super) async fn play_context(&self, tokens: &TokenManager, client_id: &str, device_id: &str, context_uri: &str) -> Result<(), SpotifyError> {
        require(valid_device_id(device_id) && valid_context_uri(context_uri))?;
        self.send(tokens, client_id, Method::PUT, "/me/player/play", &[("device_id", device_id)], Some(json!({ "context_uri": context_uri }))).await.map(drop)
    }

    pub(super) async fn set_shuffle(&self, tokens: &TokenManager, client_id: &str, device_id: &str, enabled: bool) -> Result<(), SpotifyError> {
        require(valid_device_id(device_id))?;
        let state = if enabled { "true" } else { "false" };
        self.send(tokens, client_id, Method::PUT, "/me/player/shuffle", &[("state", state), ("device_id", device_id)], None).await.map(drop)
    }

    pub(super) async fn set_repeat(&self, tokens: &TokenManager, client_id: &str, device_id: &str, mode: &str) -> Result<(), SpotifyError> {
        require(valid_device_id(device_id) && matches!(mode, "off" | "context" | "track"))?;
        self.send(tokens, client_id, Method::PUT, "/me/player/repeat", &[("state", mode), ("device_id", device_id)], None).await.map(drop)
    }

    /// Sends one request; on HTTP 401 drops the cached token and retries once.
    async fn send(&self, tokens: &TokenManager, client_id: &str, method: Method, path: &str, query: &[(&str, &str)], body: Option<Value>) -> Result<Vec<u8>, SpotifyError> {
        for attempt in 0..2 {
            let token = tokens.access_token(client_id).await?;
            let mut request = self.http.request(method.clone(), format!("{}{path}", self.base)).bearer_auth(&token.access_token).query(query);
            request = match &body {
                Some(body) => request.json(body),
                None if method == Method::PUT => request.header(reqwest::header::CONTENT_LENGTH, "0"),
                None => request,
            };
            let response = request.send().await.map_err(|error| from_transport(&error))?;
            let status = response.status();
            let headers = response.headers().clone();
            let bytes = response.bytes().await.map_err(|error| from_transport(&error))?;
            if status.is_success() {
                return Ok(bytes.to_vec());
            }
            if status == StatusCode::UNAUTHORIZED && attempt == 0 {
                tokens.invalidate().await;
                continue;
            }
            return Err(map_status(status, &headers, &bytes));
        }
        Err(ErrorCode::NotConnected.into())
    }
}

fn require(valid: bool) -> Result<(), SpotifyError> {
    if valid { Ok(()) } else { Err(ErrorCode::InvalidInput.into()) }
}

fn map_status(status: StatusCode, headers: &reqwest::header::HeaderMap, body: &[u8]) -> SpotifyError {
    match status {
        StatusCode::UNAUTHORIZED => ErrorCode::NotConnected.into(),
        StatusCode::NOT_FOUND => ErrorCode::NoActiveDevice.into(),
        StatusCode::TOO_MANY_REQUESTS => SpotifyError::rate_limited(retry_after(headers)),
        StatusCode::FORBIDDEN => {
            let error = serde_json::from_slice::<Value>(body).ok();
            let reason = error.as_ref().and_then(|value| value.pointer("/error/reason")).and_then(Value::as_str).unwrap_or_default();
            let message = error.as_ref().and_then(|value| value.pointer("/error/message")).and_then(Value::as_str).unwrap_or_default().to_ascii_lowercase();
            if reason == "PREMIUM_REQUIRED" || message.contains("premium") {
                ErrorCode::PremiumRequired.into()
            } else if message.contains("not registered") || message.contains("developer dashboard") {
                ErrorCode::DevModeRestricted.into()
            } else {
                ErrorCode::Forbidden.into()
            }
        }
        status if status.is_server_error() => ErrorCode::Unavailable.into(),
        _ => ErrorCode::InvalidResponse.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spotify::{credentials::memory::MemoryStore, test_server::TestServer, tokens::TOKEN_URL};
    use std::sync::{Arc, Mutex};

    const TOKEN: &str = r#"{"access_token":"access-1","token_type":"Bearer","expires_in":3600}"#;

    /// Token server and API server are the same mock: first reply is always the token.
    fn setup(api_responses: Vec<(u16, String)>) -> (TestServer, TokenManager, WebApi) {
        let mut responses = vec![(200, TOKEN.to_string())];
        responses.extend(api_responses);
        let server = TestServer::start(responses);
        let tokens = TokenManager::new(Client::new(), server.url("/api/token"), Arc::new(MemoryStore(Mutex::new(Some("r".into())))));
        let api = WebApi::new(Client::new(), server.url("/v1"));
        (server, tokens, api)
    }

    #[test]
    fn token_url_is_the_official_endpoint() {
        assert_eq!(TOKEN_URL, "https://accounts.spotify.com/api/token");
        assert_eq!(API_BASE, "https://api.spotify.com/v1");
    }

    #[test]
    fn profile_and_playlists_are_parsed_including_the_2026_field_rename() {
        let (_server, tokens, api) = setup(vec![
            (200, r#"{"display_name":"Markus","images":[{"url":"https://i.scdn.co/a.jpg"}]}"#.into()),
            (200, r#"{"items":[{"uri":"spotify:playlist:37i9dQZF1DXcBWIGoYBM5M","name":"Hits","owner":{"display_name":"Spotify"},"images":null,"items":{"total":50}},{"uri":"spotify:playlist:0000000000000000000000","name":"Old","tracks":{"total":3}},null,{"uri":"javascript:alert(1)","name":"bad"}]}"#.into()),
        ]);
        tauri::async_runtime::block_on(async {
            let profile = api.profile(&tokens, "c").await.unwrap();
            assert_eq!(profile, Profile { display_name: Some("Markus".into()), image_url: Some("https://i.scdn.co/a.jpg".into()) });
            let playlists = api.playlists(&tokens, "c").await.unwrap();
            assert_eq!(playlists.len(), 2);
            assert_eq!(playlists[0].track_count, Some(50));
            assert_eq!(playlists[1].track_count, Some(3));
            assert_eq!(playlists[0].image_url, None);
        });
    }

    #[test]
    fn transfer_sends_bearer_token_and_device_without_autoplay() {
        let (server, tokens, api) = setup(vec![(204, String::new())]);
        tauri::async_runtime::block_on(api.transfer(&tokens, "c", "device123", false)).unwrap();
        let request = &server.requests()[1];
        assert!(request.starts_with("PUT /v1/me/player "));
        assert!(request.to_ascii_lowercase().contains("authorization: bearer access-1"));
        assert!(request.contains(r#""device_ids":["device123"]"#) && request.contains(r#""play":false"#));
    }

    #[test]
    fn unauthorized_is_retried_once_with_a_fresh_token() {
        let (server, tokens, api) = setup(vec![(401, String::new()), (200, TOKEN.into()), (204, String::new())]);
        tauri::async_runtime::block_on(api.set_shuffle(&tokens, "c", "device123", true)).unwrap();
        assert_eq!(server.requests().len(), 4);
        assert!(server.requests()[3].starts_with("PUT /v1/me/player/shuffle?state=true&device_id=device123 "));
    }

    #[test]
    fn spotify_errors_map_to_user_facing_codes() {
        for (status, body, code) in [
            (403, r#"{"error":{"status":403,"message":"Player command failed: Premium required","reason":"PREMIUM_REQUIRED"}}"#, ErrorCode::PremiumRequired),
            (403, r#"{"error":{"status":403,"message":"User not registered in the Developer Dashboard"}}"#, ErrorCode::DevModeRestricted),
            (403, r#"{"error":{"status":403,"message":"Restriction violated"}}"#, ErrorCode::Forbidden),
            (404, r#"{"error":{"status":404,"message":"Device not found"}}"#, ErrorCode::NoActiveDevice),
            (502, "", ErrorCode::Unavailable),
        ] {
            let (_server, tokens, api) = setup(vec![(status, body.into())]);
            let error = tauri::async_runtime::block_on(api.set_repeat(&tokens, "c", "device123", "context")).unwrap_err();
            assert_eq!(error.code, code, "{status} {body}");
        }
        let (_server, tokens, api) = setup(vec![(429, String::new())]);
        let error = tauri::async_runtime::block_on(api.transfer(&tokens, "c", "device123", true)).unwrap_err();
        assert_eq!(error, SpotifyError::rate_limited(Some(7)));
    }

    #[test]
    fn invalid_frontend_input_is_rejected_before_any_request() {
        let (server, tokens, api) = setup(vec![]);
        tauri::async_runtime::block_on(async {
            assert_eq!(api.transfer(&tokens, "c", "../x", true).await.unwrap_err().code, ErrorCode::InvalidInput);
            assert_eq!(api.set_repeat(&tokens, "c", "device123", "all").await.unwrap_err().code, ErrorCode::InvalidInput);
            assert_eq!(api.play_context(&tokens, "c", "device123", "https://evil").await.unwrap_err().code, ErrorCode::InvalidInput);
        });
        assert!(server.requests().is_empty());
        assert!(valid_context_uri("spotify:album:4aawyAB9vmqN3uQ7FjRGTy"));
        assert!(!valid_context_uri("spotify:track:4aawyAB9vmqN3uQ7FjRGTy"));
    }
}
