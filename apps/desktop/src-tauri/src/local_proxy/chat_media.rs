const TOOL_IMAGE_PLACEHOLDER: &str = "[Tool images are attached in the following user message.]";

/// Chat tool messages only accept text. Lift images after the complete parallel tool batch.
fn lift_chat_tool_images(messages: &mut Vec<Value>) {
    let mut converted = Vec::new();
    let mut pending_calls = HashSet::new();
    let mut images = Vec::new();
    let mut deferred = Vec::new();
    for mut message in std::mem::take(messages) {
        if message["role"] == "tool" {
            extract_chat_tool_images(&mut message, &mut images);
            if let Some(id) = message.get("tool_call_id").and_then(Value::as_str) {
                pending_calls.remove(id);
            }
            converted.push(message);
            if pending_calls.is_empty() {
                flush_chat_tool_images(&mut converted, &mut images, &mut deferred);
            }
            continue;
        }
        if !pending_calls.is_empty() && message.get("tool_calls").is_none() {
            deferred.push(message);
            continue;
        }
        flush_chat_tool_images(&mut converted, &mut images, &mut deferred);
        for call in message
            .get("tool_calls")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(id) = call.get("id").and_then(Value::as_str) {
                pending_calls.insert(id.to_string());
            }
        }
        converted.push(message);
    }
    flush_chat_tool_images(&mut converted, &mut images, &mut deferred);
    *messages = converted;
}

fn extract_chat_tool_images(message: &mut Value, images: &mut Vec<Value>) {
    let Some(content) = message.get("content").and_then(Value::as_str) else {
        return;
    };
    let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(content) else {
        return;
    };
    let mut media = Vec::new();
    let mut remaining = Vec::new();
    for part in parts {
        let image = part
            .as_object()
            .filter(|part| part.get("type") == Some(&json!("input_image")))
            .and_then(responses_image_to_chat);
        if let Some(image) = image {
            media.push(image);
        } else {
            remaining.push(part);
        }
    }
    if media.is_empty() {
        return;
    }
    let id = message
        .get("tool_call_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    images.push(json!({ "type": "text", "text": format!("Images returned by tool call {id}:") }));
    images.extend(media);
    let text = remaining
        .iter()
        .map(|part| match part.get("type").and_then(Value::as_str) {
            Some("input_text" | "output_text" | "text") => {
                value_to_text(part).unwrap_or_else(|| canonical_json_string(part))
            }
            _ => canonical_json_string(part),
        })
        .collect::<Vec<_>>()
        .join("\n");
    message["content"] = json!(format!("{text}\n{TOOL_IMAGE_PLACEHOLDER}"));
}

fn flush_chat_tool_images(
    messages: &mut Vec<Value>,
    images: &mut Vec<Value>,
    deferred: &mut Vec<Value>,
) {
    if !images.is_empty() {
        messages.push(json!({ "role": "user", "content": std::mem::take(images) }));
    }
    messages.append(deferred);
}
