use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use sha2::{Digest, Sha256};

use super::{
    document::{self, MAX_CONTENT_BYTES},
    error::ConfigError,
    models::{ConfigDocument, PatchConfigRequest, SaveConfigRequest},
    patch,
};

// Serialize editor reads and mutations, including both revision checks and atomic replacement.
static CONFIG_EDIT_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn with_current_config<T>(
    operation: impl FnOnce(&Path) -> Result<T, ConfigError>,
) -> Result<T, ConfigError> {
    let _guard = CONFIG_EDIT_LOCK.lock().map_err(|_| ConfigError::Busy)?;
    let path = crate::codex_home::resolve()
        .map_err(|_| ConfigError::HomeUnavailable)?
        .join("config.toml");
    operation(&path)
}

pub(super) fn read(path: &Path) -> Result<ConfigDocument, ConfigError> {
    let snapshot = snapshot(path)?;
    Ok(to_document(snapshot))
}

pub(super) fn save(path: &Path, request: SaveConfigRequest) -> Result<ConfigDocument, ConfigError> {
    document::parse(&request.content)?;
    ensure_revision(path, &request.expected_revision)?;
    persist(path, &request.content, &request.expected_revision)?;
    read(path)
}

pub(super) fn patch(
    path: &Path,
    request: PatchConfigRequest,
) -> Result<ConfigDocument, ConfigError> {
    let current = ensure_revision(path, &request.expected_revision)?;
    let content = patch::apply(&current.content, &request.path, &request.value)?;
    persist(path, &content, &request.expected_revision)?;
    read(path)
}

struct Snapshot {
    content: String,
    revision: String,
}

fn snapshot(path: &Path) -> Result<Snapshot, ConfigError> {
    let mut bytes = Vec::new();
    let exists = match File::open(path) {
        Ok(file) => {
            file.take(MAX_CONTENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| ConfigError::Read)?;
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => return Err(ConfigError::Read),
    };
    if bytes.len() > MAX_CONTENT_BYTES {
        return Err(ConfigError::TooLarge);
    }
    let mut hash = Sha256::new();
    hash.update(path.as_os_str().as_encoded_bytes());
    hash.update([0, u8::from(exists)]);
    hash.update(&bytes);
    Ok(Snapshot {
        content: String::from_utf8(bytes).map_err(|_| ConfigError::Read)?,
        revision: format!("{:x}", hash.finalize()),
    })
}

fn to_document(snapshot: Snapshot) -> ConfigDocument {
    let parsed =
        document::parse(&snapshot.content).and_then(|document| document::values(&document));
    let (values, error) = match parsed {
        Ok(values) => (Some(values), None),
        Err(error) => (None, Some(error.diagnostic())),
    };
    ConfigDocument {
        content: snapshot.content,
        revision: snapshot.revision,
        values,
        error,
    }
}

fn ensure_revision(path: &Path, expected: &str) -> Result<Snapshot, ConfigError> {
    let current = snapshot(path)?;
    if expected != current.revision {
        return Err(ConfigError::Conflict);
    }
    Ok(current)
}

fn persist(path: &Path, content: &str, revision: &str) -> Result<(), ConfigError> {
    let parent = path.parent().ok_or(ConfigError::Write)?;
    fs::create_dir_all(parent).map_err(|_| ConfigError::Write)?;
    let temporary = TemporaryFile(parent.join(format!(".config-{}.tmp", uuid::Uuid::new_v4())));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary.0)
        .map_err(|_| ConfigError::Write)?;
    if let Ok(metadata) = fs::metadata(path) {
        file.set_permissions(metadata.permissions())
            .map_err(|_| ConfigError::Write)?;
    }
    file.write_all(content.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|_| ConfigError::Write)?;
    drop(file);
    // Check again after staging, so external edits made while writing the temp file are retained.
    ensure_revision(path, revision)?;
    crate::storage::replace_file(&temporary.0, path).map_err(|_| ConfigError::Write)
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.0) {
            // After a successful rename there is nothing to clean up.
            if error.kind() != io::ErrorKind::NotFound {
                eprintln!("Could not clean up a temporary Codex configuration file");
            }
        }
    }
}
