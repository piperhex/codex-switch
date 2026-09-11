//! Materialize phone-selected bytes only inside the application's attachment directory.
use super::{
    error::{GuiError, Result},
    platform::execution_path,
    prompt::{AttachmentInput, AttachmentKind},
    protocol::GuiRequest,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, io::Write, path::Path};

const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TOTAL_ENCODED_BYTES: usize = 4 * 1024 * 1024;

pub(super) fn prepare_request(request: &mut GuiRequest, root: &Path) -> Result<()> {
    let attachments: Vec<&mut AttachmentInput> = match request {
        GuiRequest::Send { attachments, .. } | GuiRequest::Steer { attachments, .. } => {
            attachments.iter_mut().collect()
        }
        GuiRequest::SendBatch { messages, .. } => messages
            .iter_mut()
            .flat_map(|message| message.attachments.iter_mut())
            .collect(),
        _ => return Ok(()),
    };
    // Bound the complete request before decoding or creating files.
    let total: usize = attachments
        .iter()
        .filter_map(|item| item.data.as_ref())
        .map(String::len)
        .sum();
    if total > MAX_TOTAL_ENCODED_BYTES {
        return Err(GuiError::Attachment);
    }
    let uploads = attachments
        .into_iter()
        .filter(|item| item.data.is_some())
        .map(|item| decode(item).map(|bytes| (item, bytes)))
        .collect::<Result<Vec<_>>>()?;
    for (item, bytes) in uploads {
        save(item, &bytes, root)?;
    }
    Ok(())
}

fn decode(item: &AttachmentInput) -> Result<Vec<u8>> {
    if !matches!(item.kind, AttachmentKind::File)
        || !item.path.is_empty()
        || item.name.trim().is_empty()
        || item.name.len() > 500
        || item.name.chars().any(char::is_control)
    {
        return Err(GuiError::Attachment);
    }
    let data = item.data.as_deref().ok_or(GuiError::Attachment)?;
    if data.len() > MAX_FILE_BYTES.div_ceil(3) * 4 {
        return Err(GuiError::Attachment);
    }
    let bytes = STANDARD.decode(data).map_err(|_| GuiError::Attachment)?;
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err(GuiError::Attachment);
    }
    Ok(bytes)
}

fn save(item: &mut AttachmentInput, bytes: &[u8], root: &Path) -> Result<()> {
    // Prefixing also avoids Windows reserved basenames; caller names never become directory components.
    let name: String = item
        .name
        .chars()
        .map(|c| if "/\\:<>\"|?*".contains(c) { '_' } else { c })
        .collect();
    let directory = root
        .join("attachments")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&directory).map_err(|_| GuiError::Attachment)?;
    let directory = directory.canonicalize().map_err(|_| GuiError::Attachment)?;
    if !directory.starts_with(root) {
        return Err(GuiError::Attachment);
    }
    let target = directory.join(format!("attachment-{}", name.trim_end_matches([' ', '.'])));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|_| GuiError::Attachment)?;
    file.write_all(bytes).map_err(|_| GuiError::Attachment)?;
    item.path = execution_path(&target);
    item.data = None;
    Ok(())
}

#[cfg(test)]
#[path = "attachment_upload_tests.rs"]
mod tests;
