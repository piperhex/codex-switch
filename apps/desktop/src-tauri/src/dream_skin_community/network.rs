fn client(timeout_seconds: u64) -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .user_agent(concat!(
            "Codex-Switch/",
            env!("CARGO_PKG_VERSION"),
            " DreamSkin"
        ))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|error| format!("Could not prepare the DreamSkin request: {error}"))
}

fn download(
    url: &str,
    limit: usize,
    expected_content_type: &str,
    timeout_seconds: u64,
) -> Result<Vec<u8>, String> {
    let response = client(timeout_seconds)?
        .get(url)
        .header(header::ACCEPT, expected_content_type)
        .send()
        .map_err(|error| format!("Could not reach DreamSkin community: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "DreamSkin community returned HTTP {}.",
            response.status()
        ));
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default();
    if content_type != expected_content_type {
        return Err("DreamSkin community returned an unsupported response.".to_string());
    }
    if response
        .content_length()
        .is_some_and(|length| length == 0 || length > limit as u64)
    {
        return Err("The DreamSkin response is too large.".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("The DreamSkin response could not be read: {error}"))?;
    if bytes.is_empty() || bytes.len() > limit {
        return Err("The DreamSkin response is empty or too large.".to_string());
    }
    Ok(bytes)
}

fn api_url(relative: &str) -> Result<String, String> {
    let origin = Url::parse(&format!("{API_ORIGIN}/")).expect("fixed DreamSkin URL is valid");
    let url = origin
        .join(relative)
        .map_err(|_| "The DreamSkin API path is invalid.".to_string())?;
    if url.scheme() != origin.scheme() || url.host_str() != origin.host_str() {
        return Err("The DreamSkin API path is invalid.".to_string());
    }
    Ok(url.to_string())
}

fn valid_theme_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value.len() <= 80
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_' | b'.')
        })
}

fn safe_text(value: &str, maximum: usize) -> bool {
    let trimmed = value.trim();
    value == trimmed
        && !value.is_empty()
        && value.chars().count() <= maximum
        && value.chars().all(|character| !character.is_control())
}

fn valid_semver(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && value.len() <= 32
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (*part == "0" || !part.starts_with('0'))
        })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn verify_sha256(bytes: &[u8], expected: &str, label: &str) -> Result<(), String> {
    if !valid_sha256(expected) || format!("{:x}", Sha256::digest(bytes)) != expected {
        Err(format!(
            "The downloaded {label} failed its integrity check."
        ))
    } else {
        Ok(())
    }
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}
