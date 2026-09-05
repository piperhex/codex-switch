fn snapshot_request_service_tier(
    method: &Method,
    path: &str,
    body: Vec<u8>,
    tier: Option<ProxyServiceTier>,
) -> Vec<u8> {
    let path = request_path(path);
    let supports_tier = is_responses_endpoint(path)
        || matches!(path, "/chat/completions" | "/v1/chat/completions")
        || is_anthropic_messages_endpoint(path);
    if *method != Method::Post || !supports_tier || tier.is_none() {
        return body;
    }
    let Ok(mut value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    // Freeze the choice before routing or retries. Forwarders must not read a later toggle.
    apply_proxy_service_tier(&mut value, tier);
    serde_json::to_vec(&value).unwrap_or(body)
}

#[derive(Clone, Default)]
struct ChatCompletionMetadata {
    usage: Option<Value>,
    service_tier: Option<String>,
}

impl ChatCompletionMetadata {
    fn observe(&mut self, value: &Value) {
        if let Some(usage) = value
            .get("usage")
            .filter(|usage| !usage.is_null())
            .and_then(chat_usage_to_responses_usage)
        {
            self.usage = Some(usage);
        }
        if let Some(tier) = extract_service_tier_from_value(value) {
            self.service_tier = Some(tier);
        }
    }
}

fn normalized_usage_service_tier(value: &str) -> Option<String> {
    const MAX_SERVICE_TIER_LENGTH: usize = 64;
    let value = value.trim();
    (!value.is_empty()
        && value.len() <= MAX_SERVICE_TIER_LENGTH
        && !value.chars().any(char::is_control))
    .then(|| value.to_ascii_lowercase())
}

fn forwarded_request_service_tier(body: &[u8], headers: &[(String, String)]) -> Option<String> {
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        return value.as_object().map(|value| {
            value
                .get("service_tier")
                .and_then(Value::as_str)
                .and_then(normalized_usage_service_tier)
                .unwrap_or_else(|| "default".to_string())
        });
    }
    let content_type = header_value(headers, "content-type")?;
    if !content_type.starts_with("multipart/form-data") {
        return None;
    }
    Some(
        multipart_request_text_field(body, headers, "service_tier")
            .and_then(|value| normalized_usage_service_tier(&value))
            .unwrap_or_else(|| "default".to_string()),
    )
}

fn extract_service_tier_from_value(value: &Value) -> Option<String> {
    [
        "/response/service_tier",
        "/service_tier",
        "/message/service_tier",
    ]
    .into_iter()
    .filter_map(|path| value.pointer(path).and_then(Value::as_str))
    .find_map(normalized_usage_service_tier)
}

fn extract_service_tier_from_bytes(
    bytes: &[u8],
    content_type: Option<&str>,
    expects_event_stream: bool,
) -> Option<String> {
    if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
        return extract_service_tier_from_value(&value);
    }
    if !expects_event_stream && !is_event_stream(content_type) {
        return None;
    }
    let text = String::from_utf8_lossy(bytes).replace("\r\n", "\n");
    text.split("\n\n")
        .filter_map(|block| {
            let data = block
                .lines()
                .filter_map(|line| line.trim_start().strip_prefix("data:"))
                .map(str::trim_start)
                .collect::<Vec<_>>()
                .join("\n");
            serde_json::from_str::<Value>(&data)
                .ok()
                .and_then(|value| extract_service_tier_from_value(&value))
        })
        .last()
}

fn enforce_provider_service_tier(
    body: Vec<u8>,
    headers: &[(String, String)],
    provider: &ProviderProfile,
) -> Vec<u8> {
    if provider.fast_mode_enabled {
        return body;
    }
    if let Ok(mut value) = serde_json::from_slice::<Value>(&body) {
        if value.get("service_tier").is_none() {
            return body;
        }
        apply_proxy_service_tier(&mut value, Some(ProxyServiceTier::Default));
        return serde_json::to_vec(&value).unwrap_or(body);
    }
    let Some(boundary) = header_value(headers, "content-type").and_then(multipart_boundary) else {
        return body;
    };
    replace_multipart_service_tier(body, boundary)
}

fn replace_multipart_service_tier(mut body: Vec<u8>, boundary: &str) -> Vec<u8> {
    let marker = format!("--{boundary}");
    let separator = format!("\r\n{marker}");
    let mut cursor = 0;
    while let Some(start) = find_bytes(&body[cursor..], marker.as_bytes()) {
        let part_start = cursor + start + marker.len() + 2;
        if part_start >= body.len() {
            break;
        }
        let Some(part_length) = find_bytes(&body[part_start..], separator.as_bytes()) else {
            break;
        };
        let part_end = part_start + part_length;
        let part = &body[part_start..part_end];
        if multipart_text_part(part, "service_tier").is_some() {
            if let Some(header_end) = find_bytes(part, b"\r\n\r\n") {
                body.splice(
                    part_start + header_end + 4..part_end,
                    b"default".iter().copied(),
                );
                return body;
            }
        }
        cursor = part_end + 2;
    }
    body
}
