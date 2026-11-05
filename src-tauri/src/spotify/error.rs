use serde::Serialize;

/// Stable error codes for the frontend. They never carry tokens, codes or verifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotConfigured,
    InvalidConfig,
    Busy,
    Cancelled,
    AccessDenied,
    StateMismatch,
    Timeout,
    InvalidCallback,
    BrowserOpen,
    Network,
    InvalidResponse,
    NotConnected,
    Revoked,
    Forbidden,
    DevModeRestricted,
    PremiumRequired,
    NoActiveDevice,
    InvalidInput,
    RateLimited,
    Unavailable,
    CredentialStore,
    Internal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyError {
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_secs: Option<u64>,
}

impl SpotifyError {
    pub fn new(code: ErrorCode) -> Self {
        Self { code, retry_after_secs: None }
    }

    pub fn rate_limited(retry_after_secs: Option<u64>) -> Self {
        Self { code: ErrorCode::RateLimited, retry_after_secs }
    }
}

impl From<ErrorCode> for SpotifyError {
    fn from(code: ErrorCode) -> Self {
        Self::new(code)
    }
}

/// Maps transport failures without exposing request details.
pub fn from_transport(error: &reqwest::Error) -> SpotifyError {
    if error.is_timeout() || error.is_connect() || error.is_request() {
        SpotifyError::new(ErrorCode::Network)
    } else {
        SpotifyError::new(ErrorCode::InvalidResponse)
    }
}

pub fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}
