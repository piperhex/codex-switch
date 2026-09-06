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

fn anthropic_usage(usage: Option<&Value>) -> Value {
    json!({
        "input_tokens": usage.and_then(|v| v.get("input_tokens")).cloned().unwrap_or(json!(0)),
        "output_tokens": usage.and_then(|v| v.get("output_tokens")).cloned().unwrap_or(json!(0))
    })
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

#[cfg(test)]
mod anthropic_bridge_tests {
    use super::*;

    fn convert(request: &Value) -> Value {
        anthropic_to_responses(request, "sol")
    }

    #[test]
    fn converts_anthropic_messages_to_responses() {
        let request = json!({
            "model": "claude-sonnet", "max_tokens": 512, "system": "Be concise",
            "messages": [{ "role": "user", "content": "Hello" }]
        });
        let converted = convert(&request);
        assert_eq!(converted["instructions"], "Be concise");
        assert!(converted.get("max_output_tokens").is_none());
        assert_eq!(converted["store"], false);
        assert_eq!(converted["stream"], true);
        assert_eq!(converted["input"][0]["content"][0]["text"], "Hello");
        let assistant = json!({
            "messages": [{ "role": "assistant", "content": "Earlier answer" }]
        });
        assert_eq!(
            convert(&assistant)["input"][0]["content"][0]["type"],
            "output_text"
        );
        let tool_result = json!({
            "messages": [{
                "role": "user",
                "content": [{ "type": "tool_result", "tool_use_id": "call-1", "content": "done" }]
            }]
        });
        assert_eq!(
            convert(&tool_result)["input"][0]["type"],
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
        let tool_responses = convert(&tool_turn);
        let tool_input = tool_responses["input"].as_array().expect("tool input");
        assert_eq!(tool_input[0]["type"], "function_call");
        assert_eq!(tool_input[1]["type"], "function_call_output");
        let structured_result = json!({
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "call-2",
                    "content": [{ "type": "text", "text": "completed" }]
                }]
            }]
        });
        assert_eq!(
            convert(&structured_result)["input"][0]["output"][0]["type"],
            "input_text"
        );
        assert_eq!(
            convert(&json!({ "model": "claude-haiku-4-5" }))["model"],
            "gpt-5.6-luna"
        );
        assert_eq!(
            convert(&json!({ "model": "claude-opus-5" }))["model"],
            "gpt-5.6-sol"
        );
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
            convert(&image)["input"][0]["content"][0]["type"],
            "input_image"
        );
        let subagent = json!({
            "model": "claude-sonnet-5",
            "metadata": { "user_id": "session_agent_worker" }
        });
        assert_eq!(
            anthropic_to_responses(&subagent, "terra",)["model"],
            "gpt-5.6-terra"
        );
        assert_eq!(
            anthropic_to_responses(&subagent, "provider-model")["model"],
            "provider-model"
        );
        assert!(is_anthropic_token_probe(
            br#"{"max_tokens":1,"messages":[{"role":"user","content":"count"}]}"#
        ));
    }

    #[test]
    fn converts_responses_text_to_anthropic_message() {
        let response = json!({
            "id": "resp-1", "status": "completed",
            "output": [{ "type": "message", "content": [{ "type": "output_text", "text": "Hi" }] }],
            "usage": { "input_tokens": 2, "output_tokens": 1 }
        });
        let converted =
            anthropic_stream::convert_response(&response, "claude-sonnet").expect("message");
        assert_eq!(converted["content"][0]["text"], "Hi");
        assert_eq!(converted["usage"]["input_tokens"], 2);
    }
}
