//! Export only images explicitly copied by the user, without accepting frontend file paths.
use std::{fs::File, io::Read, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use serde::Serialize;

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 40 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
enum ClipboardImageError {
    #[error("图片粘贴失败，请重新复制后再试。")]
    Read,
    #[error("请选择 JPG、PNG、WebP、GIF 或 BMP 图片。")]
    Format,
    #[error("图片过大，请减少图片数量或选择较小的图片。")]
    Size,
}

/// Inline image bytes for remote upload. Local filesystem paths never leave this command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardImage {
    mime_type: &'static str,
    data: String,
}

fn read_image(path: &Path, total: &mut u64) -> Result<ClipboardImage, ClipboardImageError> {
    if !path.is_absolute() {
        return Err(ClipboardImageError::Read);
    }
    let file = File::open(path).map_err(|_| ClipboardImageError::Read)?;
    let metadata = file.metadata().map_err(|_| ClipboardImageError::Read)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES {
        return Err(ClipboardImageError::Size);
    }
    let limit = MAX_IMAGE_BYTES.min(MAX_TOTAL_BYTES.saturating_sub(*total));
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ClipboardImageError::Read)?;
    if bytes.len() as u64 > limit {
        return Err(ClipboardImageError::Size);
    }
    let mime_type = match image::guess_format(&bytes) {
        Ok(ImageFormat::Png) => "image/png",
        Ok(ImageFormat::Jpeg) => "image/jpeg",
        Ok(ImageFormat::WebP) => "image/webp",
        Ok(ImageFormat::Gif) => "image/gif",
        Ok(ImageFormat::Bmp) => "image/bmp",
        _ => return Err(ClipboardImageError::Format),
    };
    *total += bytes.len() as u64;
    Ok(ClipboardImage {
        mime_type,
        data: STANDARD.encode(bytes),
    })
}

fn read_images() -> Result<Vec<ClipboardImage>, ClipboardImageError> {
    let paths = super::clipboard_paths::read_paths().map_err(|_| ClipboardImageError::Read)?;
    if paths.len() > super::images::MAX_IMAGES {
        return Err(ClipboardImageError::Size);
    }
    let mut total = 0;
    paths
        .iter()
        .map(|path| read_image(path, &mut total))
        .collect()
}

#[tauri::command]
pub(crate) async fn codex_gui_remote_clipboard_images(
    window: tauri::WebviewWindow,
) -> Result<Vec<ClipboardImage>, String> {
    if window.label() != "main" {
        return Err(ClipboardImageError::Read.to_string());
    }
    tauri::async_runtime::spawn_blocking(read_images)
        .await
        .map_err(|_| ClipboardImageError::Read.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copied_images_export_bytes_without_local_paths() {
        let root = std::env::temp_dir().join(format!("clipboard-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("private-name.png");
        let bytes = b"\x89PNG\r\n\x1a\n";
        std::fs::write(&path, bytes).unwrap();
        let image = read_image(&path, &mut 0).unwrap();
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(STANDARD.decode(&image.data).unwrap(), bytes);
        assert!(!serde_json::to_string(&image)
            .unwrap()
            .contains("private-name"));
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn rejects_non_images_missing_paths_and_excessive_size() {
        let root = std::env::temp_dir().join(format!("clipboard-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("not-an-image.png");
        std::fs::write(&path, "not an image").unwrap();
        assert!(matches!(
            read_image(&path, &mut 0),
            Err(ClipboardImageError::Format)
        ));
        assert!(read_image(Path::new("relative.png"), &mut 0).is_err());
        assert!(read_image(&root.join("missing.png"), &mut 0).is_err());
        let mut total = MAX_TOTAL_BYTES;
        assert!(matches!(
            read_image(&path, &mut total),
            Err(ClipboardImageError::Size)
        ));
        File::create(&path)
            .unwrap()
            .set_len(MAX_IMAGE_BYTES + 1)
            .unwrap();
        assert!(matches!(
            read_image(&path, &mut 0),
            Err(ClipboardImageError::Size)
        ));
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
