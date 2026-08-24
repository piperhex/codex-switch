#[cfg(test)]
fn responses_to_chat_completions(body: &Value) -> Value {
    let tool_context = build_codex_tool_context_from_request(body);
    responses_to_chat_completions_with_context(body, &tool_context, None)
}

const LOCAL_REASONING_ITEM_ID_PREFIX: &str = "rs_resp_";

fn is_local_reasoning_item(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("reasoning")
        && value
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id.starts_with(LOCAL_REASONING_ITEM_ID_PREFIX))
}

fn remove_local_reasoning_items(value: &mut Value) -> bool {
    let Value::Array(items) = value else {
        return false;
    };
    let original_len = items.len();
    items.retain(|item| !is_local_reasoning_item(item));
    let mut changed = items.len() != original_len;
    for item in items {
        changed |= remove_local_reasoning_items(item);
    }
    changed
}

fn remove_local_reasoning_from_input(value: &mut Value) -> bool {
    let Some(input) = value.get_mut("input") else {
        return false;
    };
    if is_local_reasoning_item(input) {
        *input = Value::Array(Vec::new());
        return true;
    }
    remove_local_reasoning_items(input)
}

fn responses_to_chat_completions_with_context(
    body: &Value,
    tool_context: &CodexToolContext,
    continuation_scope: Option<&chat_bridge_continuation::ContinuationScope>,
) -> Value {
    let mut messages = Vec::new();
    if let Some(instructions) = body.get("instructions").and_then(value_to_text) {
        if !instructions.trim().is_empty() {
            messages.push(json!({ "role": "system", "content": instructions }));
        }
    }
    if let Some(input) = body.get("input") {
        append_input_messages(input, &mut messages, tool_context);
    }
    if let Some(scope) = continuation_scope {
        chat_bridge_continuation::restore_messages(scope, &mut messages);
    }
    if messages.is_empty() {
        messages.push(json!({ "role": "user", "content": "" }));
    }

    let mut result = json!({
        "model": body.get("model").cloned().unwrap_or_else(|| json!("gpt-5-codex")),
        "messages": messages
    });
    for key in [
        "temperature",
        "top_p",
        "stream",
        "presence_penalty",
        "frequency_penalty",
        "parallel_tool_calls",
    ] {
        if let Some(value) = body.get(key) {
            result[key] = value.clone();
        }
    }
    if let Some(value) = body
        .get("max_output_tokens")
        .or_else(|| body.get("max_tokens"))
        .or_else(|| body.get("max_completion_tokens"))
    {
        result["max_tokens"] = value.clone();
    }
    if !tool_context.chat_tools().is_empty() {
        result["tools"] = Value::Array(tool_context.chat_tools().to_vec());
    }
    if let Some(tool_choice) = body.get("tool_choice") {
        result["tool_choice"] = responses_tool_choice_to_chat(tool_choice, tool_context);
    }
    if result.get("tools").is_none() {
        if let Some(object) = result.as_object_mut() {
            object.remove("tool_choice");
            object.remove("parallel_tool_calls");
        }
    }
    if result
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        result["stream_options"] = json!({ "include_usage": true });
    }
    result
}

fn apply_deepseek_reasoning(responses_body: &Value, chat_body: &mut Value) {
    let effort = responses_body
        .pointer("/reasoning/effort")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(effort) = effort else {
        return;
    };
    let thinking_type = if effort == "none" {
        "disabled"
    } else {
        chat_body["reasoning_effort"] = Value::String(effort.to_string());
        "enabled"
    };
    chat_body["thinking"] = json!({ "type": thinking_type });
}

fn append_input_messages(
    input: &Value,
    messages: &mut Vec<Value>,
    tool_context: &CodexToolContext,
) {
    let mut pending_tool_calls = Vec::new();
    match input {
        Value::String(text) => messages.push(json!({ "role": "user", "content": text })),
        Value::Array(items) => {
            for item in items {
                append_input_item_as_chat_message(
                    item,
                    messages,
                    &mut pending_tool_calls,
                    tool_context,
                );
            }
        }
        Value::Object(map) => {
            append_input_item_as_chat_message(
                &Value::Object(map.clone()),
                messages,
                &mut pending_tool_calls,
                tool_context,
            );
        }
        _ => {}
    }
    flush_pending_tool_calls(messages, &mut pending_tool_calls);
}

fn append_input_item_as_chat_message(
    item: &Value,
    messages: &mut Vec<Value>,
    pending_tool_calls: &mut Vec<Value>,
    tool_context: &CodexToolContext,
) {
    if is_local_reasoning_item(item) {
        return;
    }
    match item {
        Value::String(text) => {
            flush_pending_tool_calls(messages, pending_tool_calls);
            messages.push(json!({ "role": "user", "content": text }));
            return;
        }
        Value::Array(items) => {
            for nested in items {
                append_input_item_as_chat_message(
                    nested,
                    messages,
                    pending_tool_calls,
                    tool_context,
                );
            }
            return;
        }
        _ => {}
    }

    let item_type = item.get("type").and_then(Value::as_str);
    match item_type {
        Some("function_call") => {
            pending_tool_calls.push(responses_function_call_to_chat_tool_call(
                item,
                tool_context,
            ));
        }
        Some("custom_tool_call") => {
            pending_tool_calls.push(responses_custom_tool_call_to_chat_tool_call(item));
        }
        Some("tool_search_call") => {
            pending_tool_calls.push(responses_tool_search_call_to_chat_tool_call(item));
        }
        Some("function_call_output") => {
            flush_pending_tool_calls(messages, pending_tool_calls);
            append_tool_output_message(item, messages);
        }
        Some("custom_tool_call_output") | Some("tool_search_output") => {
            flush_pending_tool_calls(messages, pending_tool_calls);
            append_tool_output_message(item, messages);
        }
        _ => {
            flush_pending_tool_calls(messages, pending_tool_calls);
            append_regular_input_message(item, messages);
        }
    }
}

fn flush_pending_tool_calls(messages: &mut Vec<Value>, pending_tool_calls: &mut Vec<Value>) {
    if pending_tool_calls.is_empty() {
        return;
    }
    if let Some(message) = messages.last_mut().filter(|message| {
        message.get("role").and_then(Value::as_str) == Some("assistant")
            && message.get("tool_calls").is_none()
    }) {
        message["tool_calls"] = Value::Array(std::mem::take(pending_tool_calls));
        return;
    }
    messages.push(json!({
        "role": "assistant",
        "content": Value::Null,
        "tool_calls": std::mem::take(pending_tool_calls)
    }));
}

fn append_tool_output_message(item: &Value, messages: &mut Vec<Value>) {
    let call_id = item.get("call_id").and_then(Value::as_str).unwrap_or("");
    if call_id.is_empty() {
        return;
    }
    let content = match item.get("output") {
        Some(output) => output_to_chat_tool_content(output),
        None => canonical_json_string(item),
    };
    messages.push(json!({
        "role": "tool",
        "tool_call_id": call_id,
        "content": content
    }));
}

fn append_regular_input_message(item: &Value, messages: &mut Vec<Value>) {
    if let Value::Object(map) = item {
        if map.get("type").and_then(Value::as_str) == Some("input_image") {
            if let Some(content) = responses_content_to_chat(item) {
                messages.push(json!({ "role": "user", "content": content }));
            }
            return;
        }
        let role = map
            .get("role")
            .and_then(Value::as_str)
            .map(normalize_chat_role)
            .unwrap_or("user");
        if let Some(content) = map.get("content").and_then(responses_content_to_chat) {
            messages.push(json!({ "role": role, "content": content }));
        } else if matches!(
            map.get("type").and_then(Value::as_str),
            Some("input_text" | "output_text" | "text")
        ) {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                messages.push(json!({ "role": role, "content": text }));
            }
        }
    }
}

fn responses_content_to_chat(value: &Value) -> Option<Value> {
    if !contains_input_image(value) {
        return value_to_text(value).map(Value::String);
    }
    let mut parts = Vec::new();
    append_chat_content_parts(value, &mut parts);
    (!parts.is_empty()).then_some(Value::Array(parts))
}

fn contains_input_image(value: &Value) -> bool {
    match value {
        Value::Array(items) => items.iter().any(contains_input_image),
        Value::Object(map) => {
            map.get("type").and_then(Value::as_str) == Some("input_image")
                || map.get("content").is_some_and(contains_input_image)
        }
        _ => false,
    }
}

fn append_chat_content_parts(value: &Value, parts: &mut Vec<Value>) {
    match value {
        Value::String(text) => parts.push(json!({ "type": "text", "text": text })),
        Value::Array(items) => {
            for item in items {
                append_chat_content_parts(item, parts);
            }
        }
        Value::Object(map) => append_chat_content_object(map, parts),
        _ => {}
    }
}

fn append_chat_content_object(map: &serde_json::Map<String, Value>, parts: &mut Vec<Value>) {
    match map.get("type").and_then(Value::as_str) {
        Some("input_image") => {
            if let Some(part) = responses_image_to_chat(map) {
                parts.push(part);
            }
        }
        Some("input_text" | "output_text" | "text") => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                parts.push(json!({ "type": "text", "text": text }));
            }
        }
        _ => {
            if let Some(content) = map.get("content") {
                append_chat_content_parts(content, parts);
            }
        }
    }
}

fn responses_image_to_chat(map: &serde_json::Map<String, Value>) -> Option<Value> {
    let image_url = map.get("image_url")?;
    let url = image_url
        .as_str()
        .or_else(|| image_url.get("url").and_then(Value::as_str))?;
    let mut descriptor = json!({ "url": url });
    if let Some(detail) = map.get("detail").and_then(Value::as_str) {
        descriptor["detail"] = Value::String(detail.to_string());
    }
    Some(json!({ "type": "image_url", "image_url": descriptor }))
}

fn normalize_chat_role(role: &str) -> &'static str {
    match role {
        "assistant" => "assistant",
        "system" | "developer" => "system",
        "tool" => "tool",
        _ => "user",
    }
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items.iter().filter_map(value_to_text).collect::<Vec<_>>();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        Value::Object(map) => {
            for key in [
                "text",
                "input_text",
                "output_text",
                "content",
                "reasoning_content",
                "output",
            ] {
                if let Some(text) = map.get(key).and_then(value_to_text) {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}
