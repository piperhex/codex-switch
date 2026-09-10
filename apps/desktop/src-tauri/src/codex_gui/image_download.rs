//! Fetch public image URLs without exposing the PC's private network to remote chat clients.
use std::{net::IpAddr, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::redirect::Policy;

use super::error::{GuiError, Result};

const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

fn public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && ip.octets()[0] != 0
                && ip.octets()[0] < 240
                && !(ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
                && !(ip.octets()[0] == 198 && (18..=19).contains(&ip.octets()[1]))
        }
        IpAddr::V6(ip) => ip.to_ipv4_mapped().map_or_else(
            || {
                let segments = ip.segments();
                segments[0] & 0xe000 == 0x2000
                    && segments[0] != 0x2002
                    && segments[0] != 0x3fff
                    && !(segments[0] == 0x2001 && (segments[1] < 0x200 || segments[1] == 0xdb8))
            },
            |ip| public_address(IpAddr::V4(ip)),
        ),
    }
}

pub(super) async fn download(source: &str) -> Result<String> {
    let url = url::Url::parse(source).map_err(|_| GuiError::ImagePreview)?;
    if source.len() > 4096
        || !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(GuiError::ImagePreview);
    }
    let host = url.host_str().ok_or(GuiError::ImagePreview)?;
    let port = url.port_or_known_default().ok_or(GuiError::ImagePreview)?;
    let addresses: Vec<_> = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::lookup_host((host, port)),
    )
    .await
    .map_err(|_| GuiError::ImagePreview)?
    .map_err(|_| GuiError::ImagePreview)?
    .collect();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !public_address(address.ip()))
    {
        return Err(GuiError::ImagePreview);
    }
    // Pin the checked DNS answers and reject redirects so neither can switch to a private address.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|_| GuiError::ImagePreview)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| GuiError::ImagePreview)?;
    encode_response(response).await
}

async fn encode_response(mut response: reqwest::Response) -> Result<String> {
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_IMAGE_BYTES as u64)
    {
        return Err(GuiError::ImagePreview);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| GuiError::ImagePreview)? {
        if bytes.len() + chunk.len() > MAX_IMAGE_BYTES {
            return Err(GuiError::ImagePreview);
        }
        bytes.extend_from_slice(&chunk);
    }
    let mime = match image::guess_format(&bytes).map_err(|_| GuiError::ImagePreview)? {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Gif => "image/gif",
        _ => return Err(GuiError::ImagePreview),
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excludes_private_loopback_shared_and_mapped_networks() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "224.0.0.1",
            "0.0.0.0",
        ] {
            assert!(!public_address(address.parse().unwrap()), "{address}");
        }
        assert!(public_address("8.8.8.8".parse().unwrap()));
        assert!(public_address("2001:4860:4860::8888".parse().unwrap()));
        assert!(!public_address("2001:db8::1".parse().unwrap()));
    }
}
