//! Refresh-token storage. Only the Spotify module can reach it (`pub(super)`).
//! On Windows the keyring crate's `windows-native` backend writes to Credential Manager.

use super::error::{ErrorCode, SpotifyError};

const SERVICE: &str = "LegionOS Spotify (personal build)";
const ACCOUNT: &str = "refresh-token";

pub(super) trait CredentialStore: Send + Sync {
    fn load(&self) -> Result<Option<String>, SpotifyError>;
    fn save(&self, refresh_token: &str) -> Result<(), SpotifyError>;
    fn delete(&self) -> Result<(), SpotifyError>;
}

pub(super) struct KeyringStore {
    service: String,
    account: String,
}

impl KeyringStore {
    pub(super) fn new() -> Self {
        Self::with_names(SERVICE, ACCOUNT)
    }

    pub(super) fn with_names(service: &str, account: &str) -> Self {
        Self { service: service.into(), account: account.into() }
    }

    fn entry(&self) -> Result<keyring::Entry, SpotifyError> {
        keyring::Entry::new(&self.service, &self.account).map_err(|_| ErrorCode::CredentialStore.into())
    }
}

impl CredentialStore for KeyringStore {
    fn load(&self) -> Result<Option<String>, SpotifyError> {
        match self.entry()?.get_password() {
            Ok(token) if !token.is_empty() => Ok(Some(token)),
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(ErrorCode::CredentialStore.into()),
        }
    }

    fn save(&self, refresh_token: &str) -> Result<(), SpotifyError> {
        self.entry()?.set_password(refresh_token).map_err(|_| ErrorCode::CredentialStore.into())
    }

    fn delete(&self) -> Result<(), SpotifyError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(ErrorCode::CredentialStore.into()),
        }
    }
}

#[cfg(test)]
pub(super) mod memory {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct MemoryStore(pub Mutex<Option<String>>);

    impl CredentialStore for MemoryStore {
        fn load(&self) -> Result<Option<String>, SpotifyError> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save(&self, refresh_token: &str) -> Result<(), SpotifyError> {
            *self.0.lock().unwrap() = Some(refresh_token.into());
            Ok(())
        }
        fn delete(&self) -> Result<(), SpotifyError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes, reads and deletes a throwaway entry in the real Windows Credential Manager.
    /// Run with: cargo test spotify::credentials -- --ignored
    #[test]
    #[ignore = "touches the real Windows Credential Manager"]
    fn windows_credential_manager_round_trip() {
        let store = KeyringStore::with_names("LegionOS Spotify test", &format!("test-{}", std::process::id()));
        store.delete().unwrap();
        assert_eq!(store.load().unwrap(), None);
        store.save("dummy-refresh-value").unwrap();
        assert_eq!(store.load().unwrap().as_deref(), Some("dummy-refresh-value"));
        store.save("rotated-value").unwrap();
        assert_eq!(store.load().unwrap().as_deref(), Some("rotated-value"));
        store.delete().unwrap();
        assert_eq!(store.load().unwrap(), None);
        store.delete().unwrap(); // deleting twice is fine
    }
}
