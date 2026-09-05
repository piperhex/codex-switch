fn capture_session_request_conversation(
    body: &[u8],
    headers: &[(String, String)],
) -> CapturedConversation {
    let content_type = header_value(headers, "content-type").unwrap_or_default();
    if !content_type.starts_with("multipart/form-data") {
        return capture_request_conversation(body);
    }
    let Some(boundary) = multipart_boundary(content_type).filter(|boundary| !boundary.is_empty())
    else {
        return CapturedConversation::default();
    };
    let marker = format!("--{boundary}");
    let separator = format!("\r\n{marker}");
    let mut remaining = body;
    let mut content = Vec::new();
    while let Some(start) = find_bytes(remaining, marker.as_bytes()) {
        remaining = &remaining[start + marker.len()..];
        let Some(part) = remaining.strip_prefix(b"\r\n") else {
            break;
        };
        let Some(end) = find_bytes(part, separator.as_bytes()) else {
            break;
        };
        if let Some(value) = conversation_multipart_part(&part[..end]) {
            content.push(value);
        }
        remaining = &part[end + 2..];
        if content.len() >= MAX_CONVERSATION_ATTACHMENTS {
            break;
        }
    }
    capture_conversation_value(Value::Array(content))
}

fn conversation_multipart_part(part: &[u8]) -> Option<Value> {
    use base64::Engine;

    let header_end = find_bytes(part, b"\r\n\r\n")?;
    let headers = std::str::from_utf8(&part[..header_end]).ok()?;
    let body = &part[header_end + 4..];
    let disposition = headers.lines().find(|line| {
        line.to_ascii_lowercase()
            .starts_with("content-disposition:")
    })?;
    let name = disposition.split(';').find_map(|field| {
        field
            .trim()
            .strip_prefix("name=")
            .map(|name| name.trim_matches('"'))
    })?;
    if name == "prompt" {
        return Some(json!({ "type": "input_text", "text": String::from_utf8_lossy(body) }));
    }
    if !matches!(name, "image" | "image[]" | "mask") {
        return None;
    }
    if body.len() > MAX_CONVERSATION_ATTACHMENT_BYTES / 4 * 3 {
        return Some(json!({ "type": "input_image" }));
    }
    let Ok(format) = image::guess_format(body) else {
        return Some(json!({ "type": "input_image" }));
    };
    let mime = format.to_mime_type();
    let data = base64::engine::general_purpose::STANDARD.encode(body);
    Some(json!({ "type": "input_image", "image_url": format!("data:{mime};base64,{data}") }))
}
