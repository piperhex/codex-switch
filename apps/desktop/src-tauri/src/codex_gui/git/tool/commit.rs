use super::super::{command_options, output};
use super::{changes, GitError, Result, SelectedFile};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

struct IndexTransaction {
    index: PathBuf,
    lock: PathBuf,
    temporary: PathBuf,
}

impl IndexTransaction {
    fn new(root: &Path) -> Result<Self> {
        let index = PathBuf::from(output(
            root,
            &["rev-parse", "--path-format=absolute", "--git-path", "index"],
        )?);
        let lock = index.with_extension("lock");
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
            .map_err(|_| GitError::Locked)?;
        let temporary = index.with_file_name(format!("csw-index-{}", uuid::Uuid::new_v4()));
        let transaction = Self {
            index,
            lock,
            temporary,
        };
        if transaction.index.exists() {
            fs::copy(&transaction.index, &transaction.temporary)
                .map_err(|_| GitError::Operation)?;
        }
        Ok(transaction)
    }

    fn command(&self, root: &Path) -> Command {
        let mut command = command_options(root, false);
        command
            .env("GIT_INDEX_FILE", &self.temporary)
            .env("GIT_LITERAL_PATHSPECS", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
    }

    fn publish(&self) -> Result<()> {
        fs::copy(&self.temporary, &self.lock).map_err(|_| GitError::Operation)?;
        fs::rename(&self.lock, &self.index).map_err(|_| GitError::Operation)
    }
}

impl Drop for IndexTransaction {
    fn drop(&mut self) {
        for path in [
            &self.lock,
            &self.temporary,
            &self.temporary.with_extension("lock"),
        ] {
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("Git index cleanup: {error}");
                }
            }
        }
    }
}

fn selected_paths(current: &changes::Changes, selected: &[SelectedFile]) -> Result<Vec<String>> {
    if selected.is_empty() || selected.len() > current.files.len() {
        return Err(GitError::Selection);
    }
    let mut paths = Vec::new();
    for selected in selected {
        let file = current
            .files
            .iter()
            .find(|file| file.path == selected.path && file.version == selected.version)
            .ok_or(GitError::Changed)?;
        if file.conflict {
            return Err(GitError::Conflict);
        }
        paths.push(file.path.clone());
        if let Some(original) = &file.original_path {
            paths.push(original.clone());
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

pub(super) fn require_idle(root: &Path) -> Result<()> {
    for name in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
    ] {
        let path = output(
            root,
            &["rev-parse", "--path-format=absolute", "--git-path", name],
        )?;
        if Path::new(&path).exists() {
            return Err(GitError::Conflict);
        }
    }
    Ok(())
}

fn stage(transaction: &IndexTransaction, root: &Path, paths: &[String]) -> Result<()> {
    // Already staged deletions and rename sources no longer exist in the index; git add rejects them.
    let listed = transaction
        .command(root)
        .args(["ls-files", "-z", "--"])
        .args(paths)
        .stdout(Stdio::piped())
        .output()
        .map_err(|_| GitError::Unavailable)?;
    if !listed.status.success() {
        return Err(GitError::Commit);
    }
    let tracked = String::from_utf8(listed.stdout).map_err(|_| GitError::File)?;
    let stage: Vec<_> = paths
        .iter()
        .filter(|path| {
            root.join(path).symlink_metadata().is_ok()
                || tracked.split('\0').any(|entry| entry == path.as_str())
        })
        .collect();
    if stage.is_empty() {
        return Ok(());
    }
    let status = transaction
        .command(root)
        .args(["add", "-A", "--"])
        .args(stage)
        .status()
        .map_err(|_| GitError::Unavailable)?;
    if !status.success() {
        return Err(GitError::Commit);
    }
    Ok(())
}

/// Commit only selected working-tree files; keep all unrelated staging intact, including on failure.
pub(super) fn create(
    root: &Path,
    head: Option<&str>,
    message: &str,
    selected: &[SelectedFile],
) -> Result<String> {
    if message.trim().is_empty() || message.len() > 16_384 || message.contains('\0') {
        return Err(GitError::Selection);
    }
    require_idle(root)?;
    let transaction = IndexTransaction::new(root)?;
    let current = changes::read(root)?;
    if current.head.as_deref() != head {
        return Err(GitError::Changed);
    }
    if current.files.iter().any(|file| file.conflict) {
        return Err(GitError::Conflict);
    }
    let paths = selected_paths(&current, selected)?;
    stage(&transaction, root, &paths)?;
    let mut child = transaction
        .command(root)
        .args(["commit", "--only", "--file=-", "--"])
        .args(&paths)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|_| GitError::Unavailable)?;
    let written = child
        .stdin
        .take()
        .ok_or(GitError::Commit)?
        .write_all(message.trim().as_bytes());
    let status = child.wait().map_err(|_| GitError::Commit)?;
    written.map_err(|_| GitError::Commit)?;
    if !status.success() {
        return Err(GitError::Commit);
    }
    transaction.publish()?;
    changes::head(root).ok_or(GitError::Commit)
}
