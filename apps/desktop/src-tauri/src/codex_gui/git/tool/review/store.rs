use super::{checks::Kind, GitError, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Check {
    pub kind: Kind,
    pub command: String,
    pub status: Status,
    pub revision: String,
    pub finished_revision: Option<String>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub output: String,
}

#[derive(Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Status {
    Running,
    Passed,
    Failed,
    Interrupted,
}

#[derive(Deserialize, Serialize)]
struct Receipt {
    session: String,
    check: Check,
}

fn session() -> &'static str {
    static SESSION: OnceLock<String> = OnceLock::new();
    SESSION.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.as_millis() as u64)
}

pub(super) fn location(data: &Path, cwd: &Path) -> Result<PathBuf> {
    let key = format!("{:x}", Sha256::digest(cwd.to_string_lossy().as_bytes()));
    let path = data.join("task-checks").join(key);
    fs::create_dir_all(&path).map_err(|_| GitError::ReviewStorage)?;
    Ok(path)
}

pub(super) fn read(storage: &Path) -> Result<Vec<Check>> {
    let mut result = Vec::new();
    for kind in [Kind::Build, Kind::Lint, Kind::Test] {
        let path = storage.join(format!("{}.json", kind.name()));
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err(GitError::ReviewStorage),
        };
        let mut receipt: Receipt =
            serde_json::from_slice(&bytes).map_err(|_| GitError::ReviewStorage)?;
        if receipt.session != session() && receipt.check.status == Status::Running {
            receipt.check.status = Status::Interrupted;
        }
        result.push(receipt.check);
    }
    Ok(result)
}

pub(super) fn save(storage: &Path, check: &Check) -> Result<()> {
    let path = storage.join(format!("{}.json", check.kind.name()));
    let temporary = storage.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    let receipt = Receipt {
        session: session().to_owned(),
        check: check.clone(),
    };
    let bytes = serde_json::to_vec(&receipt).map_err(|_| GitError::ReviewStorage)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| GitError::ReviewStorage)?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| GitError::ReviewStorage)?;
    drop(file);
    fs::rename(temporary, path).map_err(|_| GitError::ReviewStorage)
}
