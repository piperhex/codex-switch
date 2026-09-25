use super::super::command;
use super::{changes, validate_path, GitError, Result};
use serde::Serialize;
use std::{io::Read, path::Path, process::Stdio};

const DIFF_BYTES: u64 = 256 * 1024;
const HISTORY_BYTES: u64 = 1024 * 1024;
const PAGE_SIZE: usize = 80;

#[derive(Serialize)]
pub(crate) struct Diff {
    text: String,
    truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct History {
    commits: Vec<Commit>,
    has_more: bool,
}
#[derive(Serialize)]
pub(super) struct Commit {
    hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    subject: String,
    refs: Vec<String>,
}

fn bounded(root: &Path, args: &[&str], limit: u64) -> Result<(Vec<u8>, bool)> {
    let mut child = command(root)
        .args(args)
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|_| GitError::Unavailable)?;
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .ok_or(GitError::Operation)?
        .take(limit + 1)
        .read_to_end(&mut bytes);
    let truncated = bytes.len() as u64 > limit;
    if truncated || read.is_err() {
        // The process can finish between reaching the limit and kill; wait still reaps it.
        if let Err(error) = child.kill() {
            eprintln!("Git output reader cleanup: {error}");
        }
    }
    let status = child.wait().map_err(|_| GitError::Operation)?;
    read.map_err(|_| GitError::Operation)?;
    let difference = args.contains(&"--no-index") && status.code() == Some(1);
    if !truncated && !status.success() && !difference {
        return Err(GitError::Operation);
    }
    bytes.truncate(limit as usize);
    Ok((bytes, truncated))
}

pub(super) fn diff(root: &Path, path: &str, commit: Option<&str>) -> Result<Diff> {
    if !path.is_empty() {
        validate_path(path)?;
    }
    let mut args = vec!["--no-pager"];
    let current;
    if let Some(hash) = commit {
        if !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(GitError::File);
        }
        args.extend([
            "show",
            "--format=",
            "--first-parent",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            hash,
            "--",
        ]);
        if !path.is_empty() {
            args.push(path);
        }
    } else {
        current = changes::read(root)?;
        let file = current
            .files
            .iter()
            .find(|file| file.path == path)
            .ok_or(GitError::Changed)?;
        args.extend(["diff", "--no-ext-diff", "--no-textconv", "--no-color"]);
        if file.status == "??" || current.head.is_none() {
            args.extend(["--no-index", "--", "/dev/null", path]);
        } else {
            args.extend(["HEAD", "--", path]);
            if let Some(original) = &file.original_path {
                args.push(original);
            }
        }
    }
    let (bytes, truncated) = bounded(root, &args, DIFF_BYTES)?;
    Ok(Diff {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    })
}

pub(super) fn read(root: &Path, skip: usize) -> Result<History> {
    if skip > 100_000 {
        return Err(GitError::File);
    }
    if changes::head(root).is_none() {
        return Ok(History {
            commits: Vec::new(),
            has_more: false,
        });
    }
    let skip = format!("--skip={skip}");
    let count = format!("--max-count={}", PAGE_SIZE + 1);
    let (bytes, truncated) = bounded(
        root,
        &[
            "log",
            "--all",
            "HEAD",
            "--topo-order",
            "-z",
            &skip,
            &count,
            "--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%D",
        ],
        HISTORY_BYTES,
    )?;
    if truncated {
        return Err(GitError::Operation);
    }
    Ok(parse_history(&bytes))
}

fn parse_history(bytes: &[u8]) -> History {
    let text = String::from_utf8_lossy(bytes);
    let fields: Vec<_> = text.split_terminator('\0').collect();
    let mut commits: Vec<_> = fields
        .chunks_exact(6)
        .map(|row| Commit {
            hash: row[0].to_owned(),
            parents: row[1].split_whitespace().map(str::to_owned).collect(),
            author: row[2].to_owned(),
            date: row[3].to_owned(),
            subject: row[4].to_owned(),
            refs: row[5]
                .split(", ")
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect(),
        })
        .collect();
    let has_more = commits.len() > PAGE_SIZE;
    commits.truncate(PAGE_SIZE);
    History { commits, has_more }
}
