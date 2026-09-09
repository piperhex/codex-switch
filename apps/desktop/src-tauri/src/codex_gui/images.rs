use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use serde_json::{json, Value};

use super::error::{GuiError, Result};

pub(super) const MAX_IMAGES: usize = 8;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_BASE64_BYTES: usize = MAX_IMAGE_BYTES.div_ceil(3) * 4;

// Clipboard and file-picker images travel inline, without granting the WebView filesystem access.
pub(super) fn input(image: String) -> Result<Value> {
    if image.starts_with("data:") {
        validate_data_url(&image)?;
        return Ok(json!({"type": "image", "url": image}));
    }
    let path = Path::new(&image);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if !path.is_absolute()
        || !path.is_file()
        || path
            .metadata()
            .map(|metadata| metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES as u64)
            .unwrap_or(true)
        || !["png", "jpg", "jpeg", "webp", "gif"].contains(&extension.as_str())
    {
        return Err(GuiError::InvalidRequest);
    }
    Ok(json!({"type": "localImage", "path": image}))
}

fn validate_data_url(url: &str) -> Result<()> {
    let (header, encoded) = url.split_once(',').ok_or(GuiError::InvalidRequest)?;
    let format = match header {
        "data:image/png;base64" => ImageFormat::Png,
        "data:image/jpeg;base64" => ImageFormat::Jpeg,
        "data:image/webp;base64" => ImageFormat::WebP,
        "data:image/gif;base64" => ImageFormat::Gif,
        _ => return Err(GuiError::InvalidRequest),
    };
    if encoded.is_empty() || encoded.len() > MAX_BASE64_BYTES {
        return Err(GuiError::InvalidRequest);
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| GuiError::InvalidRequest)?;
    if bytes.len() > MAX_IMAGE_BYTES || image::guess_format(&bytes).ok() != Some(format) {
        return Err(GuiError::InvalidRequest);
    }
    Ok(())
}
