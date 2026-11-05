//! PKCE (RFC 7636) verifier/challenge and OAuth state generation.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

fn random_urlsafe(bytes: usize) -> Result<String, getrandom::Error> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer)?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

/// 64 random bytes give an 86-character verifier (RFC 7636 allows 43–128).
pub fn code_verifier() -> Result<String, getrandom::Error> {
    random_urlsafe(64)
}

pub fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn oauth_state() -> Result<String, getrandom::Error> {
    random_urlsafe(32)
}

/// Constant-time comparison so the state check leaks nothing through timing.
pub fn states_match(expected: &str, received: &str) -> bool {
    expected.len() == received.len() && bool::from(expected.as_bytes().ct_eq(received.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_matches_the_rfc_7636_test_vector() {
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_has_allowed_length_and_alphabet_and_is_random() {
        let first = code_verifier().unwrap();
        let second = code_verifier().unwrap();
        assert!((43..=128).contains(&first.len()));
        assert!(first.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
        assert_ne!(first, second);
    }

    #[test]
    fn state_is_random_and_validated_exactly() {
        let state = oauth_state().unwrap();
        assert!(state.len() >= 43);
        assert_ne!(state, oauth_state().unwrap());
        assert!(states_match(&state, &state.clone()));
        assert!(!states_match(&state, &state[1..]));
        assert!(!states_match(&state, &format!("{}x", &state[..state.len() - 1])));
        assert!(!states_match(&state, ""));
    }
}
