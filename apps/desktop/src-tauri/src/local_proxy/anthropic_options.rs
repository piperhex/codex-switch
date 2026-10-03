const ANTHROPIC_BRIDGE_HEADER: &str = "x-codex-switch-anthropic-bridge";

#[derive(Debug, thiserror::Error)]
enum AnthropicBridgeError {
    #[error(
        "The selected service cannot apply the requested search restrictions. \
        Remove these restrictions or choose a service that supports them."
    )]
    SearchRestrictionsUnsupported,
    #[error(
        "The selected service does not support built-in web search. \
        Choose a service that supports web search."
    )]
    SearchUnavailable,
}

fn apply_anthropic_request_options(request: &Value, body: &mut Value) {
    for (source, target) in [
        ("max_tokens", "max_output_tokens"),
        ("temperature", "temperature"),
        ("top_p", "top_p"),
        ("service_tier", "service_tier"),
    ] {
        if let Some(value) = request.get(source) {
            body[target] = value.clone();
        }
    }
    body["include"] = json!([
        "reasoning.encrypted_content",
        "web_search_call.action.sources"
    ]);
    let thinking = request.pointer("/thinking/type").and_then(Value::as_str);
    let effort = request
        .pointer("/output_config/effort")
        .and_then(Value::as_str);
    if thinking == Some("disabled") {
        body["reasoning"] = json!({ "effort": "none" });
    } else if thinking.is_some() || effort.is_some() {
        body["reasoning"] = json!({ "summary": "auto" });
        let effort = effort.unwrap_or("medium");
        body["reasoning"]["effort"] = json!(if effort == "max" { "xhigh" } else { effort });
    }
    if let Some(choice) = request.get("tool_choice") {
        apply_anthropic_tool_choice(choice, body);
    }
    if let Some(format) = request
        .pointer("/output_config/format")
        .or_else(|| request.get("output_format"))
    {
        let mut format = format.clone();
        if format["type"] == "json_schema" && format.get("name").is_none() {
            format["name"] = json!("structured_output");
        }
        body["text"] = json!({ "format": format });
    }
}

fn apply_anthropic_tool_choice(choice: &Value, body: &mut Value) {
    let converted = match choice.get("type").and_then(Value::as_str) {
        Some("auto") => json!("auto"),
        Some("any") => json!("required"),
        Some("none") => json!("none"),
        Some("tool")
            if choice["name"] == "web_search"
                && body
                    .get("tools")
                    .and_then(Value::as_array)
                    .is_some_and(|tools| tools.iter().any(|tool| tool["type"] == "web_search")) =>
        {
            json!({ "type": "web_search" })
        }
        Some("tool") => json!({ "type": "function", "name": choice["name"] }),
        _ => return,
    };
    body["tool_choice"] = converted;
    if let Some(disabled) = choice
        .get("disable_parallel_tool_use")
        .and_then(Value::as_bool)
    {
        body["parallel_tool_calls"] = json!(!disabled);
    }
}

fn validate_anthropic_search_options(request: &Value) -> Result<(), AnthropicBridgeError> {
    for tool in request
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !tool
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|kind| kind.starts_with("web_search"))
        {
            continue;
        }
        if tool.get("blocked_domains").is_some() || tool.get("max_uses").is_some() {
            return Err(AnthropicBridgeError::SearchRestrictionsUnsupported);
        }
    }
    Ok(())
}

fn validate_anthropic_chat_tools(
    body: &Value,
    headers: &[(String, String)],
) -> Result<(), AnthropicBridgeError> {
    let is_anthropic = header_value(headers, ANTHROPIC_BRIDGE_HEADER) == Some("true");
    let has_search = body
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| tools.iter().any(|tool| tool["type"] == "web_search"));
    if is_anthropic && has_search {
        return Err(AnthropicBridgeError::SearchUnavailable);
    }
    Ok(())
}

fn anthropic_web_search_tool(tool: &Value) -> Value {
    let mut converted = json!({ "type": "web_search" });
    if let Some(domains) = tool.get("allowed_domains") {
        converted["filters"] = json!({ "allowed_domains": domains });
    }
    if let Some(location) = tool.get("user_location") {
        converted["user_location"] = location.clone();
    }
    converted
}

/// OAuth Codex accepts fewer generation controls than the public Responses endpoint.
fn prepare_anthropic_official_request(body: &mut Value) {
    if let Some(object) = body.as_object_mut() {
        for field in ["max_output_tokens", "temperature", "top_p"] {
            object.remove(field);
        }
    }
    remove_incompatible_official_reasoning_from_input(body);
}
