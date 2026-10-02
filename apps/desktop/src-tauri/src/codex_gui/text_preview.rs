//! Bounded text previews for workspace files and exact edits recorded by the chat server.
use super::{
    client::Client,
    error::{GuiError, Result},
    protocol::{thread_params, GuiResponse},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs::File, io::Read, path::Path};

#[path = "text_references.rs"]
mod references;

const DEFAULT_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PATH_LENGTH: usize = 4096;

#[derive(Serialize)]
struct TextPreview {
    path: String,
    text: String,
}

pub(super) async fn preview(
    client: &Client,
    thread_id: String,
    path: String,
    max_bytes: Option<u64>,
) -> Result<GuiResponse> {
    let max_bytes = max_bytes.unwrap_or(DEFAULT_TEXT_BYTES).max(1);
    validate_path(&path)?;
    let mut params = thread_params(thread_id)?;
    params["includeTurns"] = json!(true);
    let response = client.request("thread/read", params).await?;
    let preview = tauri::async_runtime::spawn_blocking(move || {
        read_thread_text(&response["thread"], &path, max_bytes)
    })
    .await
    .map_err(|_| GuiError::TextPreview)??;
    Ok(GuiResponse {
        data: serde_json::to_value(preview).map_err(|_| GuiError::TextPreview)?,
    })
}

fn read_thread_text(thread: &Value, source: &str, max_bytes: u64) -> Result<TextPreview> {
    let root = thread["cwd"].as_str().ok_or(GuiError::TextPreview)?;
    read_text_with_references(
        Path::new(root),
        source,
        max_bytes,
        &references::changed_files(thread),
    )
}

fn validate_path(path: &str) -> Result<()> {
    let normalized = path.replace('\\', "/");
    let without_drive = if normalized.as_bytes().get(1) == Some(&b':')
        && normalized.as_bytes()[0].is_ascii_alphabetic()
        && normalized.as_bytes().get(2) == Some(&b'/')
    {
        &normalized[2..]
    } else {
        &normalized
    };
    if path.is_empty()
        || path.len() > MAX_PATH_LENGTH
        || path.chars().any(char::is_control)
        || normalized.starts_with("//")
        || without_drive.contains(':')
    {
        return Err(GuiError::TextPreview);
    }
    Ok(())
}

#[cfg(test)]
fn read_text(root: &Path, source: &str) -> Result<TextPreview> {
    read_text_limited(root, source, DEFAULT_TEXT_BYTES)
}

#[cfg(test)]
fn read_text_limited(root: &Path, source: &str, max_bytes: u64) -> Result<TextPreview> {
    read_text_with_references(root, source, max_bytes, &[])
}

fn read_text_with_references(
    root: &Path,
    source: &str,
    max_bytes: u64,
    references: &[&str],
) -> Result<TextPreview> {
    validate_path(source)?;
    if !root.is_absolute() {
        return Err(GuiError::TextPreview);
    }
    let root = root.canonicalize().map_err(|_| GuiError::TextPreview)?;
    let path = root
        .join(source)
        .canonicalize()
        .map_err(|_| GuiError::TextPreview)?;
    if !path.is_file()
        || (!path.starts_with(&root) && !references::matches_file(&path, &root, references))
    {
        return Err(GuiError::TextPreview);
    }
    let file = File::open(&path).map_err(|_| GuiError::TextPreview)?;
    if file.metadata().map_err(|_| GuiError::TextPreview)?.len() > max_bytes {
        return Err(GuiError::TextPreview);
    }
    let mut text = String::new();
    file.take(max_bytes.saturating_add(1))
        .read_to_string(&mut text)
        .map_err(|_| GuiError::TextPreview)?;
    if text.len() as u64 > max_bytes || text.contains('\0') {
        return Err(GuiError::TextPreview);
    }
    Ok(TextPreview {
        path: super::platform::execution_path(&path),
        text,
    })
}

#[cfg(test)]
#[path = "text_preview_tests.rs"]
mod tests;
