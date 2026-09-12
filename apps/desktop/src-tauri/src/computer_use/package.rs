use super::{archive, platform, ComputerError, Result, VERSION};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;

pub(super) fn directory(root: &Path) -> Result<PathBuf> {
    Ok(root.join(format!("{VERSION}-{}", platform::asset()?.target)))
}

pub(super) fn executable(root: &Path) -> Result<PathBuf> {
    Ok(directory(root)?.join(platform::asset()?.executable()))
}

pub(super) fn present(root: &Path) -> Result<bool> {
    let directory = directory(root)?;
    Ok(platform::asset()?
        .files
        .iter()
        .all(|name| directory.join(name).is_file())
        && platform::executable_present(&executable(root)?))
}

pub(super) fn ensure(root: &Path) -> Result<()> {
    if present(root)? {
        return Ok(());
    }
    let asset = platform::asset()?;
    let name = format!("cua-driver-rs-{VERSION}-{}", asset.target);
    let url = format!(
        "https://github.com/trycua/cua/releases/download/cua-driver-rs-v{VERSION}/{name}{}",
        asset.suffix
    );
    let bytes = download(&url)?;
    verify(&bytes, asset.digest)?;
    fs::create_dir_all(root).map_err(|_| ComputerError::Storage)?;
    let staging = root.join(format!("staging-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|_| ComputerError::Storage)?;
    let result = archive::extract(&bytes, &name, &staging, &asset).and_then(|()| {
        let destination = directory(root)?;
        // Only our fixed version directory is replaced; no user-selected paths or shared CUA install.
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|_| ComputerError::Storage)?;
        }
        fs::rename(&staging, destination).map_err(|_| ComputerError::Storage)
    });
    if staging.exists() && fs::remove_dir_all(&staging).is_err() {
        eprintln!("Could not clean computer-use staging directory");
    }
    result
}

fn download(url: &str) -> Result<Vec<u8>> {
    let client = crate::system_proxy::apply(reqwest::blocking::Client::builder())
        .user_agent("Codex-Switch-Computer-Use")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| ComputerError::Download)?;
    let response = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|_| ComputerError::Download)?;
    let mut bytes = Vec::new();
    response
        .take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ComputerError::Download)?;
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(ComputerError::Integrity);
    }
    Ok(bytes)
}

fn verify(bytes: &[u8], digest: &str) -> Result<()> {
    if format!("{:x}", Sha256::digest(bytes)) != digest {
        return Err(ComputerError::Integrity);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_modified_downloads() {
        let digest = format!("{:x}", Sha256::digest(b"original"));
        assert!(verify(b"original", &digest).is_ok());
        assert!(verify(b"changed", &digest).is_err());
    }
}
