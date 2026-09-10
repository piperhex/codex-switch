//! Bounded thumbnails keep image synchronization independent of original image size.
use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{codecs::jpeg::JpegEncoder, ImageReader};
use serde::Deserialize;

use super::error::{GuiError, Result};

// Includes base64 overhead, so the complete thumbnail URL stays below 100 kB on the wire.
const MAX_THUMBNAIL_BYTES: usize = 74_000;
const MAX_INLINE_CHARS: usize = 28 * 1024 * 1024;
const MAX_DECODE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ImageVariant {
    #[default]
    Original,
    Thumbnail,
}

pub(super) fn render(url: String, variant: ImageVariant) -> Result<String> {
    if matches!(variant, ImageVariant::Original) {
        return Ok(url);
    }
    let (header, encoded) = url.split_once(',').ok_or(GuiError::ImagePreview)?;
    if url.len() > MAX_INLINE_CHARS || !header.starts_with("data:image/") {
        return Err(GuiError::ImagePreview);
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| GuiError::ImagePreview)?;
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| GuiError::ImagePreview)?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| GuiError::ImagePreview)?;
    let mut size = 1600;
    loop {
        let rgb = decoded.thumbnail(size, size).to_rgb8();
        for quality in [82, 65, 45] {
            let mut output = Vec::new();
            JpegEncoder::new_with_quality(&mut output, quality)
                .encode_image(&rgb)
                .map_err(|_| GuiError::ImagePreview)?;
            if output.len() <= MAX_THUMBNAIL_BYTES {
                return Ok(format!(
                    "data:image/jpeg;base64,{}",
                    STANDARD.encode(output)
                ));
            }
        }
        if size <= 100 {
            return Err(GuiError::ImagePreview);
        }
        size /= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_high_detail_thumbnail_and_preserves_original() {
        let image = image::RgbImage::from_fn(1800, 1400, |x, y| {
            let seed = x.wrapping_mul(1664525) ^ y.wrapping_mul(1013904223);
            image::Rgb([seed as u8, (seed >> 8) as u8, (seed >> 16) as u8])
        });
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let original = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(bytes.into_inner())
        );
        assert!(original.len() > 100_000);
        let thumbnail = render(original.clone(), ImageVariant::Thumbnail).unwrap();
        assert!(thumbnail.len() < 100_000);
        assert_eq!(
            render(original.clone(), ImageVariant::Original).unwrap(),
            original
        );
        assert!(render("data:image/png;base64,YmFk".into(), ImageVariant::Thumbnail).is_err());
    }
}
