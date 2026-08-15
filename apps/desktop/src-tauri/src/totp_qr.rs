use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{ImageReader, Limits};
use serde::Deserialize;
use std::{fmt, io::Cursor};

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_BASE64_BYTES: usize = MAX_IMAGE_BYTES.div_ceil(3) * 4 + 4;
const MAX_IMAGE_EDGE: u32 = 8_000;
const MAX_IMAGE_ALLOCATION: u64 = 256 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DecodeQrImageInput {
    data_base64: String,
}

#[derive(Debug, PartialEq)]
enum DecodeQrImageError {
    UnsupportedImage,
    ImageLoadFailed,
    QrNotFound,
}

impl DecodeQrImageError {
    fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedImage => "unsupported-image",
            Self::ImageLoadFailed => "image-load-failed",
            Self::QrNotFound => "qr-not-found",
        }
    }
}

impl fmt::Display for DecodeQrImageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

fn decode_image(input: DecodeQrImageInput) -> Result<image::GrayImage, DecodeQrImageError> {
    if input.data_base64.len() > MAX_BASE64_BYTES {
        return Err(DecodeQrImageError::UnsupportedImage);
    }
    let bytes = BASE64_STANDARD
        .decode(input.data_base64)
        .map_err(|_| DecodeQrImageError::ImageLoadFailed)?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(DecodeQrImageError::UnsupportedImage);
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| DecodeQrImageError::ImageLoadFailed)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_EDGE);
    limits.max_image_height = Some(MAX_IMAGE_EDGE);
    limits.max_alloc = Some(MAX_IMAGE_ALLOCATION);
    reader.limits(limits);
    reader
        .decode()
        .map(|image| image.to_luma8())
        .map_err(|_| DecodeQrImageError::ImageLoadFailed)
}

fn decode_qr_image(input: DecodeQrImageInput) -> Result<String, DecodeQrImageError> {
    let mut prepared = rqrr::PreparedImage::prepare(decode_image(input)?);
    for grid in prepared.detect_grids() {
        if let Ok((_, content)) = grid.decode() {
            if !content.trim().is_empty() {
                return Ok(content);
            }
        }
    }
    Err(DecodeQrImageError::QrNotFound)
}

#[tauri::command]
pub(crate) async fn decode_totp_qr_image(input: DecodeQrImageInput) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || decode_qr_image(input))
        .await
        .map_err(|_| "image-read-failed".to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_URI: &str = "otpauth://totp/Example:test@example.com?secret=JBSWY3DPEHPK3PXP";

    fn encoded_test_qr() -> String {
        let code = qrcode::QrCode::new(TEST_URI).unwrap();
        let image = code
            .render::<image::Luma<u8>>()
            .min_dimensions(300, 300)
            .build();
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::ImageLuma8(image)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        BASE64_STANDARD.encode(bytes.into_inner())
    }

    #[test]
    fn decodes_authenticator_qr_image() {
        let result = decode_qr_image(DecodeQrImageInput {
            data_base64: encoded_test_qr(),
        });
        assert_eq!(result.unwrap(), TEST_URI);
    }

    #[test]
    fn rejects_invalid_image_data() {
        let result = decode_image(DecodeQrImageInput {
            data_base64: "not-base64".to_string(),
        });
        assert_eq!(result.unwrap_err(), DecodeQrImageError::ImageLoadFailed);
    }

    #[test]
    fn rejects_oversized_input_before_decoding() {
        let result = decode_image(DecodeQrImageInput {
            data_base64: "A".repeat(MAX_BASE64_BYTES + 1),
        });
        assert_eq!(result.unwrap_err(), DecodeQrImageError::UnsupportedImage);
    }
}
