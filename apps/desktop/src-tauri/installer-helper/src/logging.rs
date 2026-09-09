//! Bounded local diagnostics for Windows Installer's otherwise hidden executable actions.
use std::{
    fs::OpenOptions,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn write(message: impl std::fmt::Display) {
    let path = std::env::temp_dir().join("codex-switch-installer.log");
    let truncate = path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 64 * 1024);
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(!truncate)
            .truncate(truncate)
            .open(path)?;
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        writeln!(file, "{time} pid={} {message}", std::process::id())
    })();
    if let Err(error) = result {
        eprintln!("installer log unavailable: {error}");
    }
}
