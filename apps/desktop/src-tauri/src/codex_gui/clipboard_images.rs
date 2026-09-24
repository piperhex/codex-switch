//! Export only images explicitly copied by the user, without accepting frontend file paths.
use std::{fs::File, io::Read, path::Path, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use serde::Serialize;

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 40 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, thiserror::Error)]
enum ClipboardImageError {
    #[error("图片粘贴失败，请重新复制后再试。")]
    Read,
    #[error("请选择 JPG、PNG、WebP、GIF 或 BMP 图片。")]
    Format,
    #[error("图片过大，请减少图片数量或选择较小的图片。")]
    Size,
}

/// Inline image bytes for local or remote chat. Local filesystem paths never leave this command.
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

struct PendingImages {
    images: Vec<ClipboardImage>,
    image_urls: Vec<String>,
    total_bytes: u64,
}

fn read_images() -> Result<PendingImages, ClipboardImageError> {
    let references =
        super::clipboard_paths::read_references().map_err(|_| ClipboardImageError::Read)?;
    if references.paths.len() + references.image_urls.len() > super::images::MAX_IMAGES {
        return Err(ClipboardImageError::Size);
    }
    let mut total = 0;
    let images = references
        .paths
        .iter()
        .map(|path| read_image(path, &mut total))
        .collect::<Result<_, _>>()?;
    Ok(PendingImages {
        images,
        image_urls: references.image_urls,
        total_bytes: total,
    })
}

async fn download_images(
    mut pending: PendingImages,
) -> Result<Vec<ClipboardImage>, ClipboardImageError> {
    for source in pending.image_urls {
        let limit = MAX_IMAGE_BYTES.min(MAX_TOTAL_BYTES.saturating_sub(pending.total_bytes));
        if limit == 0 {
            return Err(ClipboardImageError::Size);
        }
        let (mime_type, bytes) = super::clipboard_dingtalk::download(&source, limit)
            .await
            .map_err(|_| ClipboardImageError::Read)?;
        pending.total_bytes += bytes.len() as u64;
        let image = tauri::async_runtime::spawn_blocking(move || ClipboardImage {
            mime_type,
            data: STANDARD.encode(bytes),
        })
        .await
        .map_err(|_| ClipboardImageError::Read)?;
        pending.images.push(image);
    }
    Ok(pending.images)
}

#[tauri::command]
pub(crate) async fn codex_gui_remote_clipboard_images(
    window: tauri::WebviewWindow,
) -> Result<Vec<ClipboardImage>, String> {
    if window.label() != "main" {
        return Err(ClipboardImageError::Read.to_string());
    }
    let pending = tauri::async_runtime::spawn_blocking(read_images)
        .await
        .map_err(|_| ClipboardImageError::Read.to_string())?
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(DOWNLOAD_TIMEOUT, download_images(pending))
        .await
        .map_err(|_| ClipboardImageError::Read.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn refuses_an_exhausted_total_before_downloading_another_image() {
        let result = download_images(PendingImages {
            images: Vec::new(),
            image_urls: vec!["https://static.dingtalk.com/media/example.jpg".into()],
            total_bytes: MAX_TOTAL_BYTES,
        })
        .await;
        assert!(matches!(result, Err(ClipboardImageError::Size)));
    }

    #[tokio::test]
    #[ignore = "Requires a live DingTalk image URL in CSW_TEST_CLIPBOARD_IMAGE_URL"]
    async fn live_dingtalk_image_is_ready_for_chat() {
        let source = std::env::var("CSW_TEST_CLIPBOARD_IMAGE_URL").unwrap();
        let url = url::Url::parse(&source).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("static.dingtalk.com"));
        let images = download_images(PendingImages {
            images: Vec::new(),
            image_urls: vec![source],
            total_bytes: 0,
        })
        .await
        .unwrap();
        assert_eq!(images.len(), 1);
        let bytes = STANDARD.decode(&images[0].data).unwrap();
        let image = image::load_from_memory(&bytes).unwrap();
        assert!(image.width() > 0 && image.height() > 0);
        println!(
            "Downloaded {} image bytes, {} x {} pixels",
            bytes.len(),
            image.width(),
            image.height()
        );
    }

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
