const ANTHROPIC_MESSAGES_PATHS: [&str; 6] = [
    "/messages",
    "/v1/messages",
    "/v1/v1/messages",
    "/claude-desktop/messages",
    "/claude-desktop/v1/messages",
    "/claude-desktop/v1/v1/messages",
];
const ANTHROPIC_COUNT_TOKENS_PATHS: [&str; 3] = [
    "/claude-desktop/v1/messages/count_tokens",
    "/claude-desktop/messages/count_tokens",
    "/v1/messages/count_tokens",
];

fn is_anthropic_messages_endpoint(path: &str) -> bool {
    ANTHROPIC_MESSAGES_PATHS.contains(&path)
}

fn is_anthropic_count_tokens_endpoint(path: &str) -> bool {
    ANTHROPIC_COUNT_TOKENS_PATHS.contains(&path)
}

fn forward_anthropic_official<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    _headers: &[(String, String)],
    body: Vec<u8>,
    session_id: Option<&str>,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let credentials = official_credentials(
        app,
        &client,
        OfficialCredentialPurpose::Default,
        session_id,
    )?;
    let request: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Anthropic request body is not valid JSON: {error}"))?;
    let stream = request
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("claude");
    let responses_body = anthropic_to_responses(&request);
    let encoded = serde_json::to_vec(&responses_body)
        .map_err(|error| format!("Failed to encode Anthropic request: {error}"))?;
    let mut payload = send_official_request(
        &client,
        &Method::Post,
        &official_url("/v1/responses"),
        // Claude Desktop sends Anthropic-specific headers that are not valid
        // Codex headers. The official route supplies its own authentication
        // and client identity; forwarding this request header set can make
        // reqwest reject the upstream builder before any network call.
        &[],
        &encoded,
        &credentials.authentication,
    )?;
    payload.token_usage_account = Some(credentials.token_usage_account);
    if !status_ok(payload.status) {
        return Ok(payload);
    }
    let response_body = read_payload_body(&mut payload)?;
    if stream {
        return Ok(UpstreamPayload {
            status: payload.status,
            content_type: Some("text/event-stream; charset=utf-8".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(
                responses_sse_to_anthropic(&response_body, model).into_bytes(),
            ),
            token_usage_account: payload.token_usage_account,
        });
    }
    let mut converted = json_payload(
        payload.status,
        responses_sse_to_anthropic_message(&response_body, model),
    );
    converted.response_headers = payload.response_headers;
    converted.token_usage_account = payload.token_usage_account;
    Ok(converted)
}

fn read_payload_body(payload: &mut UpstreamPayload) -> Result<Vec<u8>, String> {
    match std::mem::replace(&mut payload.body, UpstreamBody::Buffered(Vec::new())) {
        UpstreamBody::Buffered(body) => Ok(body),
        UpstreamBody::Streaming(mut stream) => {
            let mut body = Vec::new();
            stream
                .read_to_end(&mut body)
                .map_err(|error| format!("Failed to read Codex response: {error}"))?;
            Ok(body)
        }
    }
}

fn anthropic_to_responses(request: &Value) -> Value {
    let mut body = json!({
        "model": crate::providers::DEFAULT_OFFICIAL_MODEL,
        "input": anthropic_messages(request.get("messages")),
        // ChatGPT Codex's OAuth Responses endpoint only accepts streamed
        // requests. Non-streaming Claude probes are assembled back into a
        // normal Anthropic response after the upstream stream completes.
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

fn anthropic_messages(messages: Option<&Value>) -> Value {
    Value::Array(
        messages
            .and_then(Value::as_array)
            .map(|items| items.iter().map(anthropic_message).collect())
            .unwrap_or_default(),
    )
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
        Some("tool_result") => Some(json!({
            "type": "function_call_output",
            "call_id": block.get("tool_use_id").cloned().unwrap_or(Value::Null),
            "output": block.get("content").cloned().unwrap_or(Value::Null)
        })),
        _ => None,
    }
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

fn responses_to_anthropic(response: &Value, model: &str) -> Value {
    let mut text = String::new();
    let mut tools = Vec::new();
    if let Some(output) = response.get("output").and_then(Value::as_array) {
        for item in output {
            match item.get("type").and_then(Value::as_str) {
                Some("message") => collect_response_text(item, &mut text),
                Some("function_call") => tools.push(json!({
                    "type": "tool_use",
                    "id": item.get("call_id").cloned().unwrap_or(Value::Null),
                    "name": item.get("name").cloned().unwrap_or(Value::Null),
                    "input": parse_json_or_string(item.get("arguments"))
                })),
                _ => {}
            }
        }
    }
    let mut content = Vec::new();
    if !text.is_empty() {
        content.push(json!({ "type": "text", "text": text }));
    }
    content.extend(tools);
    let stop_reason = if content
        .iter()
        .any(|item| item.get("type").and_then(Value::as_str) == Some("tool_use"))
    {
        "tool_use"
    } else {
        "end_turn"
    };
    json!({
        "id": response.get("id").cloned().unwrap_or_else(|| json!("msg_codex_switch")),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": Value::Null,
        "usage": anthropic_usage(response.get("usage"))
    })
}

fn collect_response_text(item: &Value, text: &mut String) {
    if let Some(content) = item.get("content").and_then(Value::as_array) {
        for part in content {
            if let Some(value) = part.get("text").and_then(Value::as_str) {
                text.push_str(value);
            }
        }
    }
}

fn anthropic_usage(usage: Option<&Value>) -> Value {
    json!({
        "input_tokens": usage.and_then(|v| v.get("input_tokens")).cloned().unwrap_or(json!(0)),
        "output_tokens": usage.and_then(|v| v.get("output_tokens")).cloned().unwrap_or(json!(0))
    })
}

fn parse_json_or_string(value: Option<&Value>) -> Value {
    let Some(text) = value.and_then(Value::as_str) else {
        return value.cloned().unwrap_or(Value::Null);
    };
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
}

fn anthropic_text(value: &Value) -> Option<String> {
    value.as_str().map(str::to_string).or_else(|| {
        value.as_array().map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
    })
}

fn responses_sse_to_anthropic_message(sse: &[u8], model: &str) -> Value {
    let source = String::from_utf8_lossy(sse);
    let mut text = String::new();
    let mut response_id = "resp_codex_switch".to_string();
    let mut usage = json!({ "input_tokens": 0, "output_tokens": 0 });
    for block in source.split("\n\n") {
        let Some(data) = block
            .lines()
            .find_map(|line| line.strip_prefix("data:"))
        else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("response.created") => {
                if let Some(id) = value.pointer("/response/id").and_then(Value::as_str) {
                    response_id = id.to_string();
                }
            }
            Some("response.output_text.delta") => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    text.push_str(delta);
                }
            }
            Some("response.completed") => {
                if let Some(completed_usage) = value.pointer("/response/usage") {
                    usage = anthropic_usage(Some(completed_usage));
                }
            }
            _ => {}
        }
    }
    responses_to_anthropic(
        &json!({
            "id": response_id,
            "output": [{
                "type": "message",
                "content": [{ "type": "output_text", "text": text }]
            }],
            "usage": usage
        }),
        model,
    )
}

fn responses_sse_to_anthropic(sse: &[u8], model: &str) -> String {
    let source = String::from_utf8_lossy(sse);
    let mut output = String::new();
    let message = json!({
        "id": "msg_codex_switch", "type": "message", "role": "assistant",
        "model": model, "content": [], "stop_reason": Value::Null,
        "stop_sequence": Value::Null, "usage": { "input_tokens": 0, "output_tokens": 0 }
    });
    push_anthropic_sse(&mut output, "message_start", json!({
        "type": "message_start", "message": message
    }));
    push_anthropic_sse(&mut output, "content_block_start", json!({
        "type": "content_block_start", "index": 0,
        "content_block": { "type": "text", "text": "" }
    }));
    for block in source.split("\n\n") {
        let Some(data) = block
            .lines()
            .find_map(|line| line.strip_prefix("data:"))
        else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("response.output_text.delta") {
            if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                push_anthropic_sse(&mut output, "content_block_delta", json!({
                    "type": "content_block_delta", "index": 0,
                    "delta": { "type": "text_delta", "text": delta }
                }));
            }
        }
    }
    push_anthropic_sse(&mut output, "content_block_stop", json!({
        "type": "content_block_stop", "index": 0
    }));
    push_anthropic_sse(&mut output, "message_delta", json!({
        "type": "message_delta",
        "delta": { "stop_reason": "end_turn", "stop_sequence": Value::Null },
        "usage": { "output_tokens": 0 }
    }));
    push_anthropic_sse(&mut output, "message_stop", json!({ "type": "message_stop" }));
    output
}

fn push_anthropic_sse(output: &mut String, event: &str, value: Value) {
    output.push_str("event: ");
    output.push_str(event);
    output.push_str("\ndata: ");
    output.push_str(&value.to_string());
    output.push_str("\n\n");
}

#[cfg(test)]
mod anthropic_bridge_tests {
    use super::*;

    #[test]
    fn converts_anthropic_messages_to_responses() {
        let request = json!({
            "model": "claude-sonnet", "max_tokens": 512, "system": "Be concise",
            "messages": [{ "role": "user", "content": "Hello" }]
        });
        let converted = anthropic_to_responses(&request);
        assert_eq!(converted["instructions"], "Be concise");
        assert!(converted.get("max_output_tokens").is_none());
        assert_eq!(converted["store"], false);
        assert_eq!(converted["stream"], true);
        assert_eq!(converted["input"][0]["content"][0]["text"], "Hello");
        let assistant = json!({
            "messages": [{ "role": "assistant", "content": "Earlier answer" }]
        });
        assert_eq!(
            anthropic_to_responses(&assistant)["input"][0]["content"][0]["type"],
            "output_text"
        );
    }

    #[test]
    fn converts_responses_text_to_anthropic_message() {
        let response = json!({
            "id": "resp-1",
            "output": [{ "type": "message", "content": [{ "type": "output_text", "text": "Hi" }] }],
            "usage": { "input_tokens": 2, "output_tokens": 1 }
        });
        let converted = responses_to_anthropic(&response, "claude-sonnet");
        assert_eq!(converted["content"][0]["text"], "Hi");
        assert_eq!(converted["usage"]["input_tokens"], 2);
    }
}
