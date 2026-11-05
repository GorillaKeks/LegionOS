//! Temporary OAuth callback listener on 127.0.0.1 only.
//!
//! It answers only `GET /callback`, stops at the first valid or invalid OAuth
//! response, and is closed when it is dropped (after success, error, timeout or cancel).

use super::{
    error::{ErrorCode, SpotifyError},
    pkce::states_match,
};
use std::{
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

pub const CALLBACK_PATH: &str = "/callback";
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const MAX_CODE_BYTES: usize = 2048;

pub struct CallbackListener {
    listener: TcpListener,
    port: u16,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Handled {
    /// Not an OAuth response (for example /favicon.ico): keep waiting.
    Ignore,
    Done(Result<String, ErrorCode>),
}

impl CallbackListener {
    pub fn bind(port: u16) -> std::io::Result<Self> {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        Ok(Self { listener, port })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{CALLBACK_PATH}", self.port)
    }

    /// Waits for the OAuth redirect and returns the authorization code.
    pub fn wait(self, expected_state: &str, timeout: Duration, cancel: &AtomicBool) -> Result<String, SpotifyError> {
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(ErrorCode::Cancelled.into());
            }
            if Instant::now() >= deadline {
                return Err(ErrorCode::Timeout.into());
            }
            match self.listener.accept() {
                Ok((stream, peer)) => {
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    if let Handled::Done(result) = handle_connection(stream, expected_state) {
                        return result.map_err(SpotifyError::new);
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(50)),
                Err(_) => return Err(ErrorCode::Internal.into()),
            }
        }
    }
}

fn handle_connection(mut stream: TcpStream, expected_state: &str) -> Handled {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buffer.windows(4).any(|window| window == b"\r\n\r\n") && buffer.len() < MAX_REQUEST_BYTES {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            Err(_) => break,
        }
    }
    let request = String::from_utf8_lossy(&buffer);
    let handled = parse_request(&request, expected_state);
    let (status, body) = match &handled {
        Handled::Ignore => ("404 Not Found", "Not found."),
        Handled::Done(Ok(_)) => ("200 OK", "Spotify is connected. You can close this tab and return to LegionOS."),
        Handled::Done(Err(ErrorCode::AccessDenied)) => ("200 OK", "Spotify access was not granted. You can close this tab and try again in LegionOS."),
        Handled::Done(Err(_)) => ("400 Bad Request", "The Spotify sign-in response was invalid. Please close this tab and try again in LegionOS."),
    };
    let page = format!("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>LegionOS</title><body style=\"font-family:system-ui;background:#070b14;color:#e7f6ff;display:grid;place-items:center;height:100vh;margin:0\"><p>{body}</p></body></html>");
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    handled
}

/// Parses the raw HTTP request. Pure so it can be tested without sockets.
pub fn parse_request(request: &str, expected_state: &str) -> Handled {
    let Some(line) = request.lines().next() else { return Handled::Ignore };
    let mut parts = line.split(' ');
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else { return Handled::Ignore };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if method != "GET" || path != CALLBACK_PATH {
        return Handled::Ignore;
    }

    let mut state = None;
    let mut code = None;
    let mut error = None;
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        let slot = match key.as_ref() {
            "state" => &mut state,
            "code" => &mut code,
            "error" => &mut error,
            _ => continue,
        };
        if slot.is_some() {
            return Handled::Done(Err(ErrorCode::InvalidCallback)); // duplicated parameter
        }
        *slot = Some(value.into_owned());
    }

    // The state must match before anything else in the response is trusted.
    match state {
        Some(state) if states_match(expected_state, &state) => {}
        _ => return Handled::Done(Err(ErrorCode::StateMismatch)),
    }
    match (code, error) {
        (_, Some(error)) if error == "access_denied" => Handled::Done(Err(ErrorCode::AccessDenied)),
        (_, Some(_)) => Handled::Done(Err(ErrorCode::InvalidCallback)),
        (Some(code), None) if !code.is_empty() && code.len() <= MAX_CODE_BYTES && code.bytes().all(|byte| byte.is_ascii_graphic()) => Handled::Done(Ok(code)),
        _ => Handled::Done(Err(ErrorCode::InvalidCallback)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn get(target: &str) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
    }

    #[test]
    fn accepts_a_matching_state_and_code() {
        assert_eq!(parse_request(&get("/callback?code=abc-123&state=s1"), "s1"), Handled::Done(Ok("abc-123".into())));
    }

    #[test]
    fn rejects_state_mismatch_missing_state_and_duplicates() {
        assert_eq!(parse_request(&get("/callback?code=abc&state=other"), "s1"), Handled::Done(Err(ErrorCode::StateMismatch)));
        assert_eq!(parse_request(&get("/callback?code=abc"), "s1"), Handled::Done(Err(ErrorCode::StateMismatch)));
        assert_eq!(parse_request(&get("/callback?code=a&code=b&state=s1"), "s1"), Handled::Done(Err(ErrorCode::InvalidCallback)));
    }

    #[test]
    fn maps_user_cancel_and_other_oauth_errors() {
        assert_eq!(parse_request(&get("/callback?error=access_denied&state=s1"), "s1"), Handled::Done(Err(ErrorCode::AccessDenied)));
        assert_eq!(parse_request(&get("/callback?error=server_error&state=s1"), "s1"), Handled::Done(Err(ErrorCode::InvalidCallback)));
        assert_eq!(parse_request(&get("/callback?state=s1"), "s1"), Handled::Done(Err(ErrorCode::InvalidCallback)));
        assert_eq!(parse_request(&get("/callback?code=&state=s1"), "s1"), Handled::Done(Err(ErrorCode::InvalidCallback)));
    }

    #[test]
    fn ignores_other_paths_and_methods() {
        assert_eq!(parse_request(&get("/favicon.ico"), "s1"), Handled::Ignore);
        assert_eq!(parse_request(&get("/callback/extra?code=a&state=s1"), "s1"), Handled::Ignore);
        assert_eq!(parse_request("POST /callback?code=a&state=s1 HTTP/1.1\r\n\r\n", "s1"), Handled::Ignore);
        assert_eq!(parse_request("", "s1"), Handled::Ignore);
    }

    #[test]
    fn listener_binds_only_to_ipv4_loopback_and_builds_the_redirect_uri() {
        let listener = CallbackListener::bind(0).unwrap();
        let address = listener.listener.local_addr().unwrap();
        assert!(address.ip().is_loopback());
        assert_eq!(listener.redirect_uri(), format!("http://127.0.0.1:{}/callback", address.port()));
    }

    #[test]
    fn real_socket_flow_ignores_favicon_then_returns_the_code_and_closes() {
        let listener = CallbackListener::bind(0).unwrap();
        let port = listener.port;
        let cancel = AtomicBool::new(false);
        let client = thread::spawn(move || {
            for target in ["/favicon.ico", "/callback?code=the-code&state=s1"] {
                let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
                stream.write_all(get(target).as_bytes()).unwrap();
                let mut response = String::new();
                stream.read_to_string(&mut response).unwrap();
                assert!(response.starts_with(if target.starts_with("/favicon") { "HTTP/1.1 404" } else { "HTTP/1.1 200" }));
            }
        });
        assert_eq!(listener.wait("s1", Duration::from_secs(5), &cancel), Ok("the-code".into()));
        client.join().unwrap();
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err(), "listener must be closed after the flow");
    }

    #[test]
    fn times_out_and_can_be_cancelled() {
        let cancel = AtomicBool::new(false);
        let started = Instant::now();
        let result = CallbackListener::bind(0).unwrap().wait("s1", Duration::from_millis(200), &cancel);
        assert_eq!(result.unwrap_err().code, ErrorCode::Timeout);
        assert!(started.elapsed() < Duration::from_secs(2));

        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let waiter = thread::spawn(move || CallbackListener::bind(0).unwrap().wait("s1", Duration::from_secs(30), &flag));
        thread::sleep(Duration::from_millis(100));
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(waiter.join().unwrap().unwrap_err().code, ErrorCode::Cancelled);
    }
}
