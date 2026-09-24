//! Fetch copied DingTalk media through the user's configured network, including fake-IP proxies.
use std::time::Duration;

use super::error::{GuiError, Result};

const MAX_IMAGE_URL_LENGTH: usize = 4096;

/// Only the fixed HTTPS media origin may use this clipboard-specific download route.
pub(super) fn image_url(source: &str) -> Option<url::Url> {
    let url = url::Url::parse(source).ok()?;
    (source.len() <= MAX_IMAGE_URL_LENGTH
        && url.scheme() == "https"
        && url.host_str() == Some("static.dingtalk.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with("/media/"))
    .then_some(url)
}

pub(super) async fn download(source: &str, max_bytes: u64) -> Result<(&'static str, Vec<u8>)> {
    let url = image_url(source).ok_or(GuiError::ImagePreview)?;
    // The fixed origin, TLS validation and disabled redirects bound access without rejecting
    // the synthetic DNS addresses used by local proxies. General image URLs keep their DNS checks.
    let builder = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30));
    let client = crate::system_proxy::apply_async(builder, &url)
        .await
        .map_err(|_| GuiError::ImagePreview)?
        .build()
        .map_err(|_| GuiError::ImagePreview)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| GuiError::ImagePreview)?;
    super::image_download::read_response(response, max_bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_other_origins_before_using_the_system_network() {
        for source in [
            "https://127.0.0.1/media/a.png",
            "https://example.com/media/a.png",
        ] {
            assert!(download(source, 1024).await.is_err());
        }
    }
}
