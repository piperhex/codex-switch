use super::{platform, ComputerError, Result, VERSION};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const FILES: &[&str] = &[
    "cua-driver.exe",
    "cua-driver-uia.exe",
    "cua-cursor-theme.exe",
    "cua_driver_sdk.dll",
    "cua_driver_node_runtime.node",
    "cua_driver_abi.h",
];

pub(super) fn directory(root: &Path) -> Result<PathBuf> {
    Ok(root.join(format!("{VERSION}-{}", platform::asset()?.0)))
}

pub(super) fn executable(root: &Path) -> Result<PathBuf> {
    Ok(directory(root)?.join("cua-driver.exe"))
}

pub(super) fn present(root: &Path) -> Result<bool> {
    let directory = directory(root)?;
    Ok(FILES.iter().all(|name| directory.join(name).is_file()))
}

pub(super) fn ensure(root: &Path) -> Result<()> {
    if present(root)? {
        return Ok(());
    }
    let (target, digest) = platform::asset()?;
    let name = format!("cua-driver-rs-{VERSION}-{target}");
    let url = format!(
        "https://github.com/trycua/cua/releases/download/cua-driver-rs-v{VERSION}/{name}.zip"
    );
    let bytes = download(&url)?;
    verify(&bytes, digest)?;
    fs::create_dir_all(root).map_err(|_| ComputerError::Storage)?;
    let staging = root.join(format!("staging-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|_| ComputerError::Storage)?;
    let result = extract(&bytes, &name, &staging).and_then(|()| {
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

fn extract(bytes: &[u8], prefix: &str, destination: &Path) -> Result<()> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| ComputerError::Integrity)?;
    // Extract only exact known members to fixed filenames: archive paths never become filesystem paths.
    for name in FILES {
        let mut member = archive
            .by_name(&format!("{prefix}/{name}"))
            .map_err(|_| ComputerError::Integrity)?;
        if member.size() > MAX_FILE_BYTES || !member.is_file() {
            return Err(ComputerError::Integrity);
        }
        let mut file =
            fs::File::create(destination.join(name)).map_err(|_| ComputerError::Storage)?;
        std::io::copy(&mut member, &mut file).map_err(|_| ComputerError::Integrity)?;
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
    #[test]
    fn rejects_missing_driver_members() {
        let bytes = zip::ZipWriter::new(Cursor::new(Vec::new()))
            .finish()
            .unwrap()
            .into_inner();
        assert!(extract(&bytes, "release", Path::new("unused")).is_err());
    }
}
