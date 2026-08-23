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
            if block_type == Some("tool_result") {
                if !regular_blocks.is_empty() {
                    converted.push(json!({
                        "role": role,
                        "content": std::mem::take(&mut regular_blocks)
                    }));
                }
                converted.push(anthropic_tool_result(block));
            } else if block_type == Some("tool_use") {
                if !regular_blocks.is_empty() {
                    converted.push(json!({
                        "role": role,
                        "content": std::mem::take(&mut regular_blocks)
                    }));
                }
                converted.push(anthropic_tool_call(block));
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
        Some("tool_result") => None,
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
            "output": block.get("content").cloned().unwrap_or(Value::Null)
    })
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

#[derive(Default)]
struct ParsedResponsesStream {
    response_id: String,
    text: String,
    tools: Vec<ParsedToolCall>,
    usage: Value,
}

#[derive(Default)]
struct ParsedToolCall {
    id: String,
    name: String,
    arguments: String,
}

fn parse_responses_sse(sse: &[u8]) -> ParsedResponsesStream {
    let source = String::from_utf8_lossy(sse);
    let mut parsed = ParsedResponsesStream {
        response_id: "resp_codex_switch".to_string(),
        usage: json!({ "input_tokens": 0, "output_tokens": 0 }),
        ..Default::default()
    };
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
                    parsed.response_id = id.to_string();
                }
            }
            Some("response.output_text.delta") => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    parsed.text.push_str(delta);
                }
            }
            Some("response.output_item.added") => {
                if value.pointer("/item/type").and_then(Value::as_str) == Some("function_call") {
                    parsed.tools.push(ParsedToolCall {
                        id: value
                            .pointer("/item/call_id")
                            .or_else(|| value.pointer("/item/id"))
                            .and_then(Value::as_str)
                            .unwrap_or("call_codex_switch")
                            .to_string(),
                        name: value
                            .pointer("/item/name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string(),
                        arguments: String::new(),
                    });
                }
            }
            Some("response.function_call_arguments.delta") => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    if let Some(tool) = parsed.tools.last_mut() {
                        tool.arguments.push_str(delta);
                    }
                }
            }
            Some("response.function_call_arguments.done") => {
                if let Some(arguments) = value.get("arguments").and_then(Value::as_str) {
                    if let Some(tool) = parsed.tools.last_mut() {
                        tool.arguments = arguments.to_string();
                    }
                }
            }
            Some("response.completed") => {
                if let Some(completed_usage) = value.pointer("/response/usage") {
                    parsed.usage = anthropic_usage(Some(completed_usage));
                }
            }
            _ => {}
        }
    }
    parsed
}

fn responses_sse_to_anthropic_message(sse: &[u8], model: &str) -> Value {
    let parsed = parse_responses_sse(sse);
    let mut output = vec![json!({
        "type": "message",
        "content": [{ "type": "output_text", "text": parsed.text }]
    })];
    output.extend(parsed.tools.iter().map(|tool| {
        json!({
            "type": "function_call",
            "call_id": tool.id,
            "name": tool.name,
            "arguments": tool.arguments
        })
    }));
    responses_to_anthropic(
        &json!({
            "id": parsed.response_id,
            "output": output,
            "usage": parsed.usage
        }),
        model,
    )
}

fn responses_sse_to_anthropic(sse: &[u8], model: &str) -> String {
    let parsed = parse_responses_sse(sse);
    let mut output = String::new();
    let message = json!({
        "id": "msg_codex_switch", "type": "message", "role": "assistant",
        "model": model, "content": [], "stop_reason": Value::Null,
        "stop_sequence": Value::Null, "usage": { "input_tokens": 0, "output_tokens": 0 }
    });
    push_anthropic_sse(&mut output, "message_start", json!({
        "type": "message_start", "message": message
    }));
    let mut index = 0;
    if !parsed.text.is_empty() {
        push_anthropic_sse(&mut output, "content_block_start", json!({
            "type": "content_block_start", "index": index,
            "content_block": { "type": "text", "text": "" }
        }));
        push_anthropic_sse(&mut output, "content_block_delta", json!({
            "type": "content_block_delta", "index": index,
            "delta": { "type": "text_delta", "text": parsed.text }
        }));
        push_anthropic_sse(&mut output, "content_block_stop", json!({
            "type": "content_block_stop", "index": index
        }));
        index += 1;
    }
    for tool in &parsed.tools {
        push_anthropic_sse(&mut output, "content_block_start", json!({
            "type": "content_block_start", "index": index,
            "content_block": {
                "type": "tool_use", "id": tool.id, "name": tool.name, "input": {}
            }
        }));
        push_anthropic_sse(&mut output, "content_block_delta", json!({
            "type": "content_block_delta", "index": index,
            "delta": { "type": "input_json_delta", "partial_json": tool.arguments }
        }));
        push_anthropic_sse(&mut output, "content_block_stop", json!({
            "type": "content_block_stop", "index": index
        }));
        index += 1;
    }
    push_anthropic_sse(&mut output, "message_delta", json!({
        "type": "message_delta",
        "delta": {
            "stop_reason": if parsed.tools.is_empty() { "end_turn" } else { "tool_use" },
            "stop_sequence": Value::Null
        },
        "usage": parsed.usage
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
        let tool_result = json!({
            "messages": [{
                "role": "user",
                "content": [{ "type": "tool_result", "tool_use_id": "call-1", "content": "done" }]
            }]
        });
        assert_eq!(
            anthropic_to_responses(&tool_result)["input"][0]["type"],
            "function_call_output"
        );
        let tool_turn = json!({
            "messages": [
                { "role": "assistant", "content": [{
                    "type": "tool_use", "id": "call-1", "name": "search", "input": { "q": "desktop" }
                }]},
                { "role": "user", "content": [{
                    "type": "tool_result", "tool_use_id": "call-1", "content": "done"
                }]}
            ]
        });
        let tool_responses = anthropic_to_responses(&tool_turn);
        let tool_input = tool_responses["input"]
            .as_array()
            .expect("tool input");
        assert_eq!(tool_input[0]["type"], "function_call");
        assert_eq!(tool_input[1]["type"], "function_call_output");
        let image = json!({
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "image",
                    "source": { "type": "base64", "media_type": "image/png", "data": "abc123" }
                }]
            }]
        });
        assert_eq!(
            anthropic_to_responses(&image)["input"][0]["content"][0]["type"],
            "input_image"
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
