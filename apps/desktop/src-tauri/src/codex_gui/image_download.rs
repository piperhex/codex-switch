//! Fetch public image URLs without exposing the PC's private network to remote chat clients.
use std::{net::IpAddr, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::redirect::Policy;

use super::error::{GuiError, Result};

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

pub(super) async fn download(source: &str, max_bytes: u64) -> Result<String> {
    let (mime, bytes) = download_bytes(source, max_bytes).await?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// Download bounded image bytes using the same public-network policy as image previews.
async fn download_bytes(source: &str, max_bytes: u64) -> Result<(&'static str, Vec<u8>)> {
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
    read_response(response, max_bytes).await
}

pub(super) async fn read_response(
    mut response: reqwest::Response,
    max_bytes: u64,
) -> Result<(&'static str, Vec<u8>)> {
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > max_bytes)
    {
        return Err(GuiError::ImagePreview);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| GuiError::ImagePreview)? {
        if bytes.len().saturating_add(chunk.len()) as u64 > max_bytes {
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
    Ok((mime, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn response(body: &[u8], status: u16) -> reqwest::Response {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let body = body.to_vec();
        let worker = std::thread::spawn(move || {
            let request = server
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap();
            request
                .respond(tiny_http::Response::from_data(body).with_status_code(status))
                .unwrap();
        });
        let response = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/image"))
            .send()
            .await
            .unwrap();
        worker.join().unwrap();
        response
    }

    #[tokio::test]
    async fn verifies_image_bytes_and_size_instead_of_trusting_url_or_content_type() {
        let png = b"\x89PNG\r\n\x1a\n";
        let (mime, bytes) = read_response(response(png, 200).await, 8).await.unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, png);
        assert!(read_response(response(png, 200).await, 7).await.is_err());
        assert!(
            read_response(response(b"<html>Sign in</html>", 200).await, 1024)
                .await
                .is_err()
        );
        assert!(read_response(response(png, 302).await, 1024).await.is_err());
        assert!(read_response(response(png, 403).await, 1024).await.is_err());
    }

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
