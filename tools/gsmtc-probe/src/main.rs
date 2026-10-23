#[cfg(windows)]
mod gsmtc;

#[cfg(windows)]
fn main() {
    if let Err(error) = gsmtc::run() {
        eprintln!("GSMTC query failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("This proof of concept only runs on Windows.");
    std::process::exit(2);
}
