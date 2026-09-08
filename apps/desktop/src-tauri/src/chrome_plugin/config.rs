use std::{
    fs,
    path::{Path, PathBuf},
};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{BrowserError, Result};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ClientRecord {
    pub(super) home: PathBuf,
    pub(super) token: String,
    pub(super) enabled: bool,
}

pub(super) fn client_id(home: &Path) -> String {
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

pub(super) fn client_path(root: &Path, id: &str) -> Result<PathBuf> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(BrowserError::InvalidRequest);
    }
    Ok(root.join("clients").join(format!("{id}.json")))
}

pub(super) fn load(root: &Path, id: &str) -> Result<ClientRecord> {
    let bytes = fs::read(client_path(root, id)?).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            BrowserError::Disabled
        } else {
            BrowserError::Storage
        }
    })?;
    serde_json::from_slice(&bytes).map_err(|_| BrowserError::Storage)
}

pub(super) fn save(root: &Path, id: &str, record: &ClientRecord) -> Result<()> {
    super::private_storage::prepare_clients(&root.join("clients"))?;
    let value = serde_json::to_value(record).map_err(|_| BrowserError::Storage)?;
    crate::storage::write_json_atomic(&client_path(root, id)?, &value)
        .map_err(|_| BrowserError::Storage)
}

pub(super) fn new_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn authorize(root: &Path, id: &str, token: &str) -> Result<ClientRecord> {
    let record = load(root, id)?;
    if !record.enabled {
        return Err(BrowserError::Disabled);
    }
    let expected = record.token.as_bytes();
    let candidate = token.as_bytes();
    if candidate.len() != 64 || expected.len() != 64 {
        return Err(BrowserError::Unauthorized);
    }
    let difference = expected
        .iter()
        .zip(candidate)
        .fold(0, |value, (a, b)| value | (a ^ b));
    if difference != 0 {
        return Err(BrowserError::Unauthorized);
    }
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn credentials_are_isolated_revocable_and_reject_forgery() {
        let root = std::env::temp_dir().join(format!("chrome-auth-{}", Uuid::new_v4()));
        let first = ClientRecord {
            home: root.join("first"),
            token: new_token(),
            enabled: true,
        };
        let mut second = ClientRecord {
            home: root.join("second"),
            token: new_token(),
            enabled: true,
        };
        let first_id = client_id(&first.home);
        let second_id = client_id(&second.home);
        save(&root, &first_id, &first).unwrap();
        save(&root, &second_id, &second).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.join("clients"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        assert!(authorize(&root, &first_id, &first.token).is_ok());
        assert!(authorize(&root, &first_id, &second.token).is_err());
        assert!(authorize(&root, &second_id, "").is_err());
        second.enabled = false;
        save(&root, &second_id, &second).unwrap();
        assert!(matches!(
            authorize(&root, &second_id, &second.token),
            Err(BrowserError::Disabled)
        ));
        assert!(authorize(&root, &first_id, &first.token).is_ok());
        assert!(client_path(&root, "../../outside").is_err());
        assert!(client_path(&root, &"x".repeat(64)).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
