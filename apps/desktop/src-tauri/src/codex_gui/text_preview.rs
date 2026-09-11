//! Bounded, read-only text previews within the workspace recorded by the chat server.
use super::{
    client::Client,
    error::{GuiError, Result},
    protocol::{thread_params, GuiResponse},
};
use serde::Serialize;
use std::{fs::File, io::Read, path::Path};

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
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
) -> Result<GuiResponse> {
    validate_path(&path)?;
    let response = client
        .request("thread/read", thread_params(thread_id)?)
        .await?;
    let root = response["thread"]["cwd"]
        .as_str()
        .ok_or(GuiError::TextPreview)?
        .to_owned();
    let preview = tauri::async_runtime::spawn_blocking(move || read_text(Path::new(&root), &path))
        .await
        .map_err(|_| GuiError::TextPreview)??;
    Ok(GuiResponse {
        data: serde_json::to_value(preview).map_err(|_| GuiError::TextPreview)?,
    })
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

fn read_text(root: &Path, source: &str) -> Result<TextPreview> {
    validate_path(source)?;
    if !root.is_absolute() {
        return Err(GuiError::TextPreview);
    }
    let root = root.canonicalize().map_err(|_| GuiError::TextPreview)?;
    let path = root
        .join(source)
        .canonicalize()
        .map_err(|_| GuiError::TextPreview)?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(GuiError::TextPreview);
    }
    let file = File::open(&path).map_err(|_| GuiError::TextPreview)?;
    if file.metadata().map_err(|_| GuiError::TextPreview)?.len() > MAX_TEXT_BYTES {
        return Err(GuiError::TextPreview);
    }
    let mut text = String::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| GuiError::TextPreview)?;
    if text.len() as u64 > MAX_TEXT_BYTES || text.contains('\0') {
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
