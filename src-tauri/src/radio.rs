use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const API_BASE: &str = "https://de1.api.radio-browser.info/json";
const USER_AGENT: &str = "LegionOS Radio/1.0";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RadioStation {
    #[serde(rename = "stationuuid")]
    pub stationuuid: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub codec: String,
    #[serde(default)]
    pub bitrate: u32,
}

#[derive(Debug, Deserialize)]
struct ResolvedStream {
    url: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("Radio service client could not start: {error}"))
}

#[tauri::command]
pub async fn radio_search_stations(query: Option<String>) -> Result<Vec<RadioStation>, String> {
    let client = client()?;
    let query = query.unwrap_or_default().trim().chars().take(100).collect::<String>();
    let mut request = client
        .get(format!("{API_BASE}/stations/search"))
        .query(&[("hidebroken", "true"), ("limit", "40"), ("order", "clickcount"), ("reverse", "true")]);
    if !query.is_empty() {
        request = request.query(&[("name", query.as_str())]);
    }
    request
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Radio stations could not be loaded: {error}"))?
        .json::<Vec<RadioStation>>()
        .await
        .map_err(|error| format!("Radio station response was invalid: {error}"))
}

#[tauri::command]
pub async fn radio_resolve_stream(station_uuid: String) -> Result<String, String> {
    if station_uuid.len() > 64
        || !station_uuid
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    {
        return Err("Invalid radio station identifier.".into());
    }
    let response = client()?
        .get(format!("{API_BASE}/url/{station_uuid}"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Radio station could not be started: {error}"))?
        .json::<ResolvedStream>()
        .await
        .map_err(|error| format!("Radio stream response was invalid: {error}"))?;
    validate_stream_url(&response.url)
        .then_some(response.url)
        .ok_or_else(|| "Radio service returned an unsupported stream URL.".into())
}

fn validate_stream_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://")) && lower.len() <= 2048
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_urls_are_limited_to_http_protocols() {
        assert!(validate_stream_url("https://radio.example/stream"));
        assert!(validate_stream_url("http://radio.example/live"));
        assert!(!validate_stream_url("javascript:alert(1)"));
        assert!(!validate_stream_url("file:///secret"));
        assert!(!validate_stream_url(" "));
    }

    #[test]
    fn station_response_uses_radio_browser_field_names() {
        let station: RadioStation = serde_json::from_str(
            r#"{"stationuuid":"a-b","name":"Test Radio","url_resolved":"https://radio.example/live","country":"Germany","language":"german","codec":"MP3","bitrate":128}"#,
        ).unwrap();
        assert_eq!(station.stationuuid, "a-b");
        assert_eq!(station.name, "Test Radio");
    }
}
