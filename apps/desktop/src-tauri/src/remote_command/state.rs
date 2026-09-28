use super::{RemoteError, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
pub(super) struct Record {
    pub home: PathBuf,
    pub enabled: bool,
    pub token: String,
}

pub(super) fn home_id(home: &Path) -> String {
    let path = home.to_string_lossy().replace('\\', "/");
    let path = if cfg!(windows) {
        path.to_lowercase()
    } else {
        path
    };
    format!(
        "{:x}",
        Sha256::digest(path.trim_end_matches('/').as_bytes())
    )
}

pub(super) fn record_path(root: &Path, id: &str) -> Result<PathBuf> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(RemoteError::Disabled);
    }
    Ok(root.join("homes").join(format!("{id}.json")))
}

pub(super) fn read(root: &Path, id: &str) -> Result<Option<Record>> {
    let Some(record): Option<Record> = read_optional(&record_path(root, id)?)? else {
        return Ok(None);
    };
    if home_id(&record.home) != id {
        return Err(RemoteError::Disabled);
    }
    Ok(Some(record))
}

fn read_optional<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| RemoteError::Storage),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(RemoteError::Storage),
    }
}

pub(super) fn prepare(root: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(root)
            .map_err(|_| RemoteError::Storage)?;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))
            .map_err(|_| RemoteError::Storage)?;
    }
    // On Windows the application data directory inherits the current user's ACL.
    fs::create_dir_all(root.join("homes")).map_err(|_| RemoteError::Storage)
}

pub(super) fn save(root: &Path, record: &Record) -> Result<()> {
    prepare(root)?;
    write(&record_path(root, &home_id(&record.home))?, record)
}

pub(super) fn write(path: &Path, value: &impl Serialize) -> Result<()> {
    let value = serde_json::to_value(value).map_err(|_| RemoteError::Storage)?;
    crate::storage::write_json_atomic(path, &value).map_err(|_| RemoteError::Storage)
}

pub(super) fn authorized(root: &Path, id: &str, token: &str) -> bool {
    matches!(read(root, id), Ok(Some(record)) if record.enabled && record.token == token)
}

pub(super) fn incoming(root: &Path) -> Result<(String, String)> {
    let homes = fs::read_dir(root.join("homes")).map_err(|_| RemoteError::Denied)?;
    for entry in homes {
        let entry = entry.map_err(|_| RemoteError::Storage)?;
        let id = entry
            .path()
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_owned();
        if let Ok(Some(record)) = read(root, &id) {
            if record.enabled && super::install::configured(&record.home, true)? {
                return Ok((id, record.token));
            }
        }
    }
    Err(RemoteError::Denied)
}
