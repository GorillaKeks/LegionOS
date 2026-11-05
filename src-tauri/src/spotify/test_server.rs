//! Minimal HTTP server for tests: replies with canned responses in order and
//! records each request (start line plus body). No real Spotify traffic in tests.

use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    thread,
};

pub struct TestServer {
    port: u16,
    requests: Arc<Mutex<Vec<String>>>,
}

impl TestServer {
    pub fn start(responses: Vec<(u16, String)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let log = requests.clone();
        thread::spawn(move || {
            for (status, body) in responses {
                let Ok((mut stream, _)) = listener.accept() else { return };
                let mut raw = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let read = stream.read(&mut chunk).unwrap_or(0);
                    if read == 0 { break; }
                    raw.extend_from_slice(&chunk[..read]);
                    let text = String::from_utf8_lossy(&raw);
                    if let Some(split) = text.find("\r\n\r\n") {
                        let length = text[..split].lines().find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok()).flatten()
                        }).unwrap_or(0);
                        if raw.len() >= split + 4 + length { break; }
                    }
                }
                log.lock().unwrap().push(String::from_utf8_lossy(&raw).into_owned());
                let reason = match status { 200 => "OK", 204 => "No Content", 400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found", 429 => "Too Many Requests", _ => "Error" };
                let extra = if status == 429 { "Retry-After: 7\r\n" } else { "" };
                let response = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(response.as_bytes());
            }
        });
        Self { port, requests }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    pub fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}
