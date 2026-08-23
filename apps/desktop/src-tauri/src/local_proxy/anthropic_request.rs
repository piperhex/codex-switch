fn anthropic_to_responses(
    request: &Value,
    subagent_model: crate::models::ClaudeSubagentModel,
) -> Value {
    let mut body = json!({
        "model": codex_model_for_anthropic_request(request, subagent_model),
        "input": anthropic_messages(request.get("messages")),
        // ChatGPT Codex OAuth only accepts streams. Non-streaming Claude
        // probes are assembled after the upstream stream completes.
        "stream": true,
        "store": false
    });
    if let Some(system) = request.get("system").and_then(anthropic_text) {
        body["instructions"] = Value::String(system);
    }
    if let Some(tools) = request.get("tools").and_then(Value::as_array) {
        body["tools"] = Value::Array(tools.iter().map(anthropic_tool).collect());
    }
    body
}

fn codex_model_for_anthropic_request(
    request: &Value,
    subagent_model: crate::models::ClaudeSubagentModel,
) -> &'static str {
    if is_anthropic_subagent_request(request) {
        return match subagent_model {
            crate::models::ClaudeSubagentModel::Sol => "gpt-5.6-sol",
            crate::models::ClaudeSubagentModel::Terra => "gpt-5.6-terra",
            crate::models::ClaudeSubagentModel::Luna => "gpt-5.6-luna",
        };
    }
    let requested = request
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if requested.contains("haiku") {
        "gpt-5.6-luna"
    } else {
        crate::providers::DEFAULT_OFFICIAL_MODEL
    }
}

fn is_anthropic_subagent_request(request: &Value) -> bool {
    if request
        .pointer("/metadata/user_id")
        .and_then(Value::as_str)
        .is_some_and(|value| value.contains("_agent_"))
    {
        return true;
    }
    if request
        .get("system")
        .and_then(anthropic_text)
        .is_some_and(|text| text.contains("__SUBAGENT_MARKER__"))
    {
        return true;
    }
    request
        .get("messages")
        .and_then(Value::as_array)
        .is_some_and(|messages| messages.iter().any(message_has_subagent_marker))
}

fn message_has_subagent_marker(message: &Value) -> bool {
    match message.get("content") {
        Some(Value::String(text)) => text.contains("__SUBAGENT_MARKER__"),
        Some(Value::Array(parts)) => parts.iter().any(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| text.contains("__SUBAGENT_MARKER__"))
        }),
        _ => false,
    }
}

fn anthropic_messages(messages: Option<&Value>) -> Value {
    let mut converted = Vec::new();
    for message in messages.and_then(Value::as_array).into_iter().flatten() {
        let Some(blocks) = message.get("content").and_then(Value::as_array) else {
            converted.push(anthropic_message(message));
            continue;
        };
        let role = message.get("role").and_then(Value::as_str).unwrap_or("user");
        let mut regular_blocks = Vec::new();
        for block in blocks {
            let block_type = block.get("type").and_then(Value::as_str);
            if matches!(block_type, Some("tool_result" | "tool_use")) {
                if !regular_blocks.is_empty() {
                    converted.push(json!({
                        "role": role,
                        "content": std::mem::take(&mut regular_blocks)
                    }));
                }
                let tool_item = if block_type == Some("tool_result") {
                    anthropic_tool_result(block)
                } else {
                    anthropic_tool_call(block)
                };
                converted.push(tool_item);
            } else if let Some(converted_block) = anthropic_content_block(block, role) {
                regular_blocks.push(converted_block);
            }
        }
        if !regular_blocks.is_empty() {
            converted.push(json!({ "role": role, "content": regular_blocks }));
        }
    }
    Value::Array(converted)
}

fn anthropic_message(message: &Value) -> Value {
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("user");
    json!({
        "role": role,
        "content": anthropic_content(message.get("content"), role)
    })
}

fn anthropic_content(content: Option<&Value>, role: &str) -> Value {
    if let Some(text) = content.and_then(Value::as_str) {
        return json!([{ "type": response_text_type(role), "text": text }]);
    }
    Value::Array(
        content
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| anthropic_content_block(item, role))
                    .collect()
            })
            .unwrap_or_default(),
    )
}

fn anthropic_content_block(block: &Value, role: &str) -> Option<Value> {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => block
            .get("text")
            .and_then(Value::as_str)
            .map(|text| json!({ "type": response_text_type(role), "text": text })),
        Some("image") if role != "assistant" => anthropic_image_block(block),
        _ => None,
    }
}

fn anthropic_image_block(block: &Value) -> Option<Value> {
    let source = block.get("source")?;
    match source.get("type").and_then(Value::as_str) {
        Some("base64") => {
            let media_type = source.get("media_type").and_then(Value::as_str)?;
            let data = source.get("data").and_then(Value::as_str)?;
            Some(json!({
                "type": "input_image",
                "image_url": format!("data:{media_type};base64,{data}")
            }))
        }
        Some("url") => source
            .get("url")
            .and_then(Value::as_str)
            .map(|url| json!({ "type": "input_image", "image_url": url })),
        _ => None,
    }
}

fn anthropic_tool_result(block: &Value) -> Value {
    json!({
        "type": "function_call_output",
        "call_id": block.get("tool_use_id").cloned().unwrap_or(Value::Null),
        "output": anthropic_tool_result_output(block)
    })
}

fn anthropic_tool_result_output(block: &Value) -> Value {
    let content = block.get("content");
    if block.get("is_error").and_then(Value::as_bool) != Some(true) {
        if let Some(text @ Value::String(_)) = content {
            return text.clone();
        }
    }
    let mut output = Vec::new();
    if block.get("is_error").and_then(Value::as_bool) == Some(true) {
        output.push(json!({ "type": "input_text", "text": "Tool execution failed" }));
    }
    match content {
        Some(Value::Array(parts)) => output.extend(parts.iter().map(anthropic_tool_result_part)),
        Some(Value::String(text)) => {
            output.push(json!({ "type": "input_text", "text": text }));
        }
        Some(value) => output.push(json!({ "type": "input_text", "text": value.to_string() })),
        None => {}
    }
    Value::Array(output)
}

fn anthropic_tool_result_part(part: &Value) -> Value {
    match part.get("type").and_then(Value::as_str) {
        Some("text") => json!({
            "type": "input_text",
            "text": part.get("text").and_then(Value::as_str).unwrap_or_default()
        }),
        Some("image") => anthropic_image_block(part).unwrap_or_else(|| json!({
            "type": "input_text",
            "text": part.to_string()
        })),
        _ => json!({ "type": "input_text", "text": part.to_string() }),
    }
}

fn anthropic_tool_call(block: &Value) -> Value {
    let arguments = block.get("input").cloned().unwrap_or_else(|| json!({}));
    json!({
        "type": "function_call",
        "call_id": block.get("id").cloned().unwrap_or(Value::Null),
        "name": block.get("name").cloned().unwrap_or(Value::Null),
        "arguments": arguments.to_string()
    })
}

fn response_text_type(role: &str) -> &'static str {
    if role == "assistant" {
        "output_text"
    } else {
        "input_text"
    }
}

fn anthropic_tool(tool: &Value) -> Value {
    json!({
        "type": "function",
        "name": tool.get("name").cloned().unwrap_or(Value::Null),
        "description": tool.get("description").cloned().unwrap_or(Value::Null),
        "parameters": tool.get("input_schema").cloned().unwrap_or_else(|| json!({}))
    })
}
