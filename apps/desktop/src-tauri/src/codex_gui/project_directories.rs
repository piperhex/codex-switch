//! Directory-only browsing for choosing a new chat's workspace on the connected computer.
use super::{
    error::{GuiError, Result},
    platform::{directory_roots, execution_path},
    protocol::GuiResponse,
};
use serde::Serialize;
use std::{fs, path::Path};

const MAX_ENTRIES: usize = 500;
const MAX_SCANNED_ENTRIES: usize = 10_000;
const MAX_PATH_BYTES: usize = 4096;

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct DirectoryListing {
    directory: String,
    parent: Option<String>,
    entries: Vec<Entry>,
    truncated: bool,
}

pub(super) async fn list(directory: String) -> Result<GuiResponse> {
    let listing = tauri::async_runtime::spawn_blocking(move || browse(&directory))
        .await
        .map_err(|_| GuiError::ProjectDirectories)??;
    let data = serde_json::to_value(listing).map_err(|_| GuiError::ProjectDirectories)?;
    Ok(GuiResponse { data })
}

fn browse(directory: &str) -> Result<DirectoryListing> {
    if directory.is_empty() {
        return Ok(DirectoryListing {
            directory: String::new(),
            parent: None,
            entries: directory_roots().iter().map(|path| entry(path)).collect(),
            truncated: false,
        });
    }
    if directory.len() > MAX_PATH_BYTES || directory.chars().any(char::is_control) {
        return Err(GuiError::ProjectDirectories);
    }
    let directory =
        super::protocol::directory(directory).map_err(|_| GuiError::ProjectDirectories)?;
    let (entries, truncated) = children(&directory)?;
    Ok(DirectoryListing {
        directory: execution_path(&directory),
        parent: Some(directory.parent().map(execution_path).unwrap_or_default()),
        entries,
        truncated,
    })
}

fn children(directory: &Path) -> Result<(Vec<Entry>, bool)> {
    let mut entries = Vec::new();
    let mut truncated = false;
    for (index, child) in fs::read_dir(directory)
        .map_err(|_| GuiError::ProjectDirectories)?
        .enumerate()
    {
        if entries.len() >= MAX_ENTRIES || index >= MAX_SCANNED_ENTRIES {
            truncated = true;
            break;
        }
        // Unreadable or disappearing children must not prevent browsing their accessible siblings.
        let Ok(child) = child else { continue };
        let Ok(kind) = child.file_type() else {
            continue;
        };
        if kind.is_dir() && !kind.is_symlink() {
            entries.push(entry(&child.path()));
        }
    }
    entries.sort_by_key(|entry| entry.name.to_lowercase());
    Ok((entries, truncated))
}

fn entry(path: &Path) -> Entry {
    let path_string = execution_path(path);
    Entry {
        name: path.file_name().map_or_else(
            || path_string.clone(),
            |name| name.to_string_lossy().into_owned(),
        ),
        path: path_string,
    }
}

#[cfg(test)]
#[path = "project_directories_tests.rs"]
mod tests;
