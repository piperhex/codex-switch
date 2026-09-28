//! The installed runtime must match the hashes embedded in this executable at build time.
use super::{Result, ServiceError};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, path::Path};

const MANIFEST: &str = include_str!(concat!(env!("OUT_DIR"), "/desktop-service-manifest.json"));
pub(super) fn ready() -> bool {
    serde_json::from_str::<BTreeMap<String, String>>(MANIFEST).is_ok_and(|entries| {
        entries.contains_key("resources/desktop-service/node.exe")
            && entries.contains_key("resources/desktop-service/host.mjs")
    })
}
pub(super) fn verify(root: &Path) -> Result<()> {
    if !ready() {
        return Err(ServiceError::Setup);
    }
    let entries: BTreeMap<String, String> =
        serde_json::from_str(MANIFEST).map_err(|_| ServiceError::Setup)?;
    for directory in ["resources/desktop-service", "resources/remote-desktop"] {
        check_tree(root, &root.join(directory), &entries)?;
    }
    for (relative, expected) in entries {
        let path = root.join(relative);
        let mut file = std::fs::File::open(path).map_err(|_| ServiceError::Setup)?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let length = file.read(&mut buffer).map_err(|_| ServiceError::Setup)?;
            if length == 0 {
                break;
            }
            hash.update(&buffer[..length]);
        }
        if format!("{:x}", hash.finalize()) != expected {
            return Err(ServiceError::Setup);
        }
    }
    Ok(())
}

fn check_tree(root: &Path, directory: &Path, entries: &BTreeMap<String, String>) -> Result<()> {
    use std::os::windows::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(directory).map_err(|_| ServiceError::Setup)?;
    if metadata.file_attributes() & 0x400 != 0 {
        return Err(ServiceError::Invalid);
    }
    for entry in std::fs::read_dir(directory).map_err(|_| ServiceError::Setup)? {
        let path = entry.map_err(|_| ServiceError::Setup)?.path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| ServiceError::Setup)?;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(ServiceError::Invalid);
        }
        if metadata.is_dir() {
            check_tree(root, &path, entries)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| ServiceError::Invalid)?
            .to_string_lossy()
            .replace('\\', "/");
        if !entries.contains_key(&relative) {
            return Err(ServiceError::Setup);
        }
    }
    Ok(())
}
