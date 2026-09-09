//! Read raster images within the server-owned task workspace or its generated-image directory.
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use serde_json::json;

use super::{
    client::Client,
    error::{GuiError, Result},
    protocol::{thread_params, GuiResponse},
};

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_SOURCE_LENGTH: usize = 4096;

pub(super) async fn preview(
    client: &Client,
    thread_id: String,
    source: String,
) -> Result<GuiResponse> {
    uuid::Uuid::parse_str(&thread_id).map_err(|_| GuiError::InvalidRequest)?;
    let params = thread_params(thread_id.clone())?;
    // Read the actual workspace before the presentation layer hides projectless paths.
    let response = client.request("thread/read", params).await?;
    let workspace = response["thread"]["cwd"]
        .as_str()
        .ok_or(GuiError::ImagePreview)?;
    let workspace = PathBuf::from(workspace);
    let generated = client.home.join("generated_images").join(thread_id);
    let data =
        tauri::async_runtime::spawn_blocking(move || read_image(&source, &workspace, &generated))
            .await
            .map_err(|_| GuiError::ImagePreview)??;
    Ok(GuiResponse {
        data: json!({ "url": data }),
    })
}

fn source_path(source: &str) -> Result<PathBuf> {
    if source.is_empty() || source.len() > MAX_SOURCE_LENGTH || source.contains('\0') {
        return Err(GuiError::ImagePreview);
    }
    let path = if source
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:"))
    {
        let url = url::Url::parse(source).map_err(|_| GuiError::ImagePreview)?;
        if url.host_str().is_some_and(|host| host != "localhost")
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(GuiError::ImagePreview);
        }
        url.to_file_path().map_err(|_| GuiError::ImagePreview)?
    } else {
        PathBuf::from(source)
    };
    // Do not turn model-provided image references into network shares or device access.
    let text = path.to_string_lossy();
    if text.replace('\\', "/").starts_with("//") || text.contains("://") {
        return Err(GuiError::ImagePreview);
    }
    Ok(path)
}

fn within(path: &Path, root: &Path) -> bool {
    root.canonicalize().is_ok_and(|root| path.starts_with(root))
}

fn read_image(source: &str, workspace: &Path, generated: &Path) -> Result<String> {
    let source = source_path(source)?;
    let path = workspace
        .join(source)
        .canonicalize()
        .map_err(|_| GuiError::ImagePreview)?;
    if !within(&path, workspace) && !within(&path, generated) {
        return Err(GuiError::ImagePreview);
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "webp", "gif"].contains(&extension.as_str()) {
        return Err(GuiError::ImagePreview);
    }
    encode_image(&path)
}

fn encode_image(path: &Path) -> Result<String> {
    let file = File::open(path).map_err(|_| GuiError::ImagePreview)?;
    let metadata = file.metadata().map_err(|_| GuiError::ImagePreview)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES {
        return Err(GuiError::ImagePreview);
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| GuiError::ImagePreview)?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(GuiError::ImagePreview);
    }
    let mime = match image::guess_format(&bytes).map_err(|_| GuiError::ImagePreview)? {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        ImageFormat::Gif => "image/gif",
        _ => return Err(GuiError::ImagePreview),
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
#[path = "image_preview_tests.rs"]
mod tests;
