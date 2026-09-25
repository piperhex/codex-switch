use super::super::{output, run};
use super::{validate_path, GitError, Result};
use crate::codex_gui::platform::execution_path;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const MAX_FILES: usize = 2_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Changes {
    pub root: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub files: Vec<Change>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Change {
    pub path: String,
    pub original_path: Option<String>,
    pub status: String,
    pub conflict: bool,
    pub version: String,
}

pub(super) fn head(root: &Path) -> Option<String> {
    output(root, &["rev-parse", "--verify", "HEAD"]).ok()
}

pub(super) fn read(root: &Path) -> Result<Changes> {
    let result = run(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !result.status.success() {
        return Err(GitError::Repository);
    }
    let head = head(root);
    let index = output(
        root,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
    )?;
    let index_stamp = stamp(Path::new(&index));
    let files = parse(&result.stdout)?
        .into_iter()
        .map(|mut file| {
            let mut hash = Sha256::new();
            hash.update(format!(
                "{head:?}:{index_stamp}:{}:{}:{}",
                file.status,
                file.path,
                stamp(&root.join(&file.path))
            ));
            if let Some(original) = &file.original_path {
                hash.update(stamp(&root.join(original)));
            }
            file.version = format!("{:x}", hash.finalize());
            file
        })
        .collect();
    Ok(Changes {
        root: execution_path(root),
        branch: output(root, &["symbolic-ref", "--short", "HEAD"]).ok(),
        head,
        files,
    })
}

fn stamp(path: &Path) -> String {
    match fs::symlink_metadata(path) {
        Ok(meta) => format!(
            "{}:{:?}:{:?}",
            meta.len(),
            meta.modified(),
            meta.file_type()
        ),
        Err(error) => format!("{:?}", error.kind()),
    }
}

pub(super) fn parse(bytes: &[u8]) -> Result<Vec<Change>> {
    let text = std::str::from_utf8(bytes).map_err(|_| GitError::File)?;
    let mut records = text.split('\0').filter(|line| !line.is_empty());
    let mut files = Vec::new();
    while let Some(record) = records.next() {
        if record.len() < 4 || !record.is_char_boundary(3) {
            return Err(GitError::File);
        }
        let status = &record[..2];
        let path = &record[3..];
        validate_path(path)?;
        let original_path = if status.contains(['R', 'C']) {
            let original = records.next().ok_or(GitError::File)?;
            validate_path(original)?;
            Some(original.to_owned())
        } else {
            None
        };
        files.push(Change {
            path: path.to_owned(),
            original_path,
            status: status.to_owned(),
            conflict: status.contains('U') || matches!(status, "AA" | "DD"),
            version: String::new(),
        });
        if files.len() > MAX_FILES {
            return Err(GitError::TooManyFiles);
        }
    }
    Ok(files)
}
