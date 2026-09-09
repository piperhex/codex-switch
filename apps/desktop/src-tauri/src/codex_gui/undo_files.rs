use super::{Change, Result, UndoError, MAX_EDIT_BYTES};
use std::{collections::BTreeMap, fs, io::Write, path::Path, process::Stdio};

type Snapshot = BTreeMap<String, Option<Vec<u8>>>;

fn read(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() || metadata.len() > MAX_EDIT_BYTES as u64 => {
            Err(UndoError::Invalid)
        }
        Ok(_) => fs::read(path).map(Some).map_err(|_| UndoError::Io),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(UndoError::Io),
    }
}

fn write(path: &Path, bytes: Option<&[u8]>) -> Result<()> {
    if let Some(bytes) = bytes {
        fs::create_dir_all(path.parent().ok_or(UndoError::Invalid)?).map_err(|_| UndoError::Io)?;
        replace_file(path, bytes)
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(UndoError::Io),
        }
    }
}

fn replace_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_file_name(format!(".codex-undo-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if let Ok(metadata) = fs::metadata(path) {
            file.set_permissions(metadata.permissions())?;
        }
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() && temporary.exists() && fs::remove_file(&temporary).is_err() {
        eprintln!("Could not remove an edit undo temporary file");
    }
    result.map_err(|_| UndoError::Io)
}

fn patch_hunks(staging: &Path, edit: &Change) -> Result<String> {
    let offset = edit.diff.find("@@ ").ok_or(UndoError::Invalid)?;
    let hunks = &edit.diff[offset..];
    let target = staging.join(edit.kind.move_path.as_ref().unwrap_or(&edit.path));
    let bytes = read(&target)?.ok_or(UndoError::Conflict)?;
    let crlf = bytes.contains(&b'\n')
        && bytes
            .iter()
            .enumerate()
            .filter(|(_, byte)| **byte == b'\n')
            .all(|(index, _)| index > 0 && bytes[index - 1] == b'\r');
    if !crlf {
        return Ok(hunks.to_owned());
    }
    // Hunk metadata stays LF; match and restore file content with its existing Windows line endings.
    Ok(hunks
        .split_inclusive('\n')
        .map(|line| {
            if line.starts_with(['+', '-', ' ']) && line.ends_with('\n') && !line.ends_with("\r\n")
            {
                format!("{}\r\n", &line[..line.len() - 1])
            } else {
                line.to_owned()
            }
        })
        .collect())
}

fn capture(root: &Path, edits: &[Change]) -> Result<Snapshot> {
    let mut snapshot = Snapshot::new();
    let mut bytes = 0;
    for path in edits
        .iter()
        .flat_map(|edit| std::iter::once(&edit.path).chain(edit.kind.move_path.iter()))
    {
        if snapshot.contains_key(path) {
            continue;
        }
        let content = read(&root.join(path))?;
        bytes += content.as_ref().map_or(0, Vec::len);
        if bytes > MAX_EDIT_BYTES {
            return Err(UndoError::Invalid);
        }
        snapshot.insert(path.clone(), content);
    }
    Ok(snapshot)
}

fn reverse_update(staging: &Path, edit: &Change) -> Result<()> {
    let destination = edit.kind.move_path.as_ref().unwrap_or(&edit.path);
    let old = serde_json::to_string(&format!("a/{}", edit.path)).map_err(|_| UndoError::Invalid)?;
    let new = serde_json::to_string(&format!("b/{destination}")).map_err(|_| UndoError::Invalid)?;
    let patch = format!(
        "diff --git {old} {new}\n--- {old}\n+++ {new}\n{}",
        patch_hunks(staging, edit)?
    );
    let mut command = crate::codex_gui::git::command(staging);
    // Stage outside the repository; Git validates paths and rejects conflicting hunks atomically.
    command
        .args([
            "-c",
            "core.autocrlf=false",
            "apply",
            "--no-index",
            "--reverse",
            "--unidiff-zero",
            "--whitespace=nowarn",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| UndoError::Git)?;
    let input = child
        .stdin
        .take()
        .ok_or(UndoError::Io)?
        .write_all(patch.as_bytes());
    let output = child.wait().map_err(|_| UndoError::Io)?;
    if input.is_err() || !output.success() {
        return Err(UndoError::Conflict);
    }
    Ok(())
}

fn reverse(staging: &Path, edit: &Change) -> Result<()> {
    let target = staging.join(edit.kind.move_path.as_ref().unwrap_or(&edit.path));
    match edit.kind.kind.as_str() {
        "add" => {
            let content = read(&target)?.ok_or(UndoError::Conflict)?;
            if content != edit.diff.as_bytes() {
                return Err(UndoError::Conflict);
            }
            write(&target, None)
        }
        "delete" => {
            if target.exists() {
                return Err(UndoError::Conflict);
            }
            write(&target, Some(edit.diff.as_bytes()))
        }
        "update" if edit.kind.move_path.is_some() && edit.diff.is_empty() => {
            if staging.join(&edit.path).exists() {
                return Err(UndoError::Conflict);
            }
            let content = read(&target)?.ok_or(UndoError::Conflict)?;
            write(&staging.join(&edit.path), Some(&content))?;
            write(&target, None)
        }
        "update" => reverse_update(staging, edit),
        _ => Err(UndoError::Invalid),
    }
}

fn apply(root: &Path, before: &Snapshot, after: &Snapshot) -> Result<()> {
    // Check again after preparation so intervening edits cannot be silently overwritten.
    for (path, bytes) in before {
        super::relative_path(root, path)?;
        if read(&root.join(path))? != *bytes {
            return Err(UndoError::Conflict);
        }
    }
    let mut written: Vec<&String> = Vec::new();
    for (path, bytes) in after {
        if before[path] == *bytes {
            continue;
        }
        if write(&root.join(path), bytes.as_deref()).is_ok() {
            written.push(path);
            continue;
        }
        let mut recovered = true;
        for path in written.into_iter().rev() {
            if write(&root.join(path), before[path].as_deref()).is_err() {
                recovered = false;
            }
        }
        return Err(if recovered {
            UndoError::Io
        } else {
            UndoError::Recovery
        });
    }
    Ok(())
}

pub(super) fn prepare_and_apply(root: &Path, staging: &Path, edits: &[Change]) -> Result<()> {
    let before = capture(root, edits)?;
    // Backups remain available when an OS error prevents a complete recovery.
    let backups = staging.join("before.json");
    fs::write(
        &backups,
        serde_json::to_vec(&before).map_err(|_| UndoError::Io)?,
    )
    .map_err(|_| UndoError::Io)?;
    let workspace = staging.join("workspace");
    fs::create_dir(&workspace).map_err(|_| UndoError::Io)?;
    for (path, bytes) in &before {
        write(&workspace.join(path), bytes.as_deref())?;
    }
    for edit in edits.iter().rev() {
        reverse(&workspace, edit)?;
    }
    let after = capture(&workspace, edits)?;
    let marker = staging.join("completed");
    fs::write(&marker, b"undone").map_err(|_| UndoError::Io)?;
    apply(root, &before, &after)?;
    let receipt = staging
        .parent()
        .ok_or(UndoError::Invalid)?
        .join("completed");
    if fs::rename(marker, receipt).is_err() {
        apply(root, &after, &before).map_err(|_| UndoError::Recovery)?;
        return Err(UndoError::Io);
    }
    Ok(())
}
