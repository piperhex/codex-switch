#[test]
fn anthropic_protocol_maps_tool_choice_thinking_and_route_specific_limits() {
    for (choice, expected) in [("auto", "auto"), ("any", "required"), ("none", "none")] {
        let request = json!({ "max_tokens": 512, "temperature": 0.5,
            "tool_choice": { "type": choice, "disable_parallel_tool_use": true },
            "thinking": { "type": "disabled" }, "output_config": { "effort": "high" } });
        let mut converted = anthropic_to_responses(&request, "sol");
        assert_eq!(converted["tool_choice"], expected);
        assert_eq!(converted["parallel_tool_calls"], false);
        assert_eq!(converted["reasoning"]["effort"], "none");
        assert_eq!(converted["max_output_tokens"], 512);
        prepare_anthropic_official_request(&mut converted);
        assert!(converted.get("max_output_tokens").is_none());
        assert!(converted.get("temperature").is_none());
    }
    let converted = anthropic_to_responses(
        &json!({
            "tool_choice": { "type": "tool", "name": "lookup" }, "output_config": { "effort": "high" }
        }),
        "sol",
    );
    assert_eq!(
        converted["tool_choice"],
        json!({ "type": "function", "name": "lookup" })
    );
    assert_eq!(
        converted["reasoning"],
        json!({ "effort": "high", "summary": "auto" })
    );
}

#[test]
fn anthropic_protocol_reasoning_roundtrip_keeps_ciphertext_and_rejects_foreign_signatures() {
    let response = json!({ "id": "resp-reasoning", "status": "completed", "output": [
        { "type": "reasoning", "id": "rs_native", "encrypted_content": "native-ciphertext",
            "summary": [{ "type": "summary_text", "text": "Plan" }] },
        { "type": "message", "content": [{ "type": "output_text", "text": "Answer" }] }
    ] });
    let message = anthropic_stream::convert_response(&response, "claude").unwrap();
    assert_eq!(message["content"][0]["thinking"], "Plan");
    let request = json!({ "messages": [{ "role": "assistant", "content": message["content"] }] });
    let replay = anthropic_to_responses(&request, "sol");
    assert_eq!(replay["input"][0]["id"], "rs_native");
    assert_eq!(replay["input"][0]["encrypted_content"], "native-ciphertext");
    let foreign = anthropic_reasoning::restore(
        &json!({ "thinking": "Visible", "signature": "claude-private" }),
    );
    assert!(foreign.get("encrypted_content").is_none());
    let mut body = json!({ "input": [foreign] });
    prepare_anthropic_official_request(&mut body);
    assert_eq!(body["input"], json!([]));
}

#[test]
fn anthropic_protocol_preserves_chat_thinking_across_both_conversions_without_cache() {
    let response = chat_to_responses_json(
        &json!({ "id": "chat-1", "choices": [{ "message": {
        "reasoning_content": "Need a lookup", "tool_calls": [
            { "id": "call-1", "function": { "name": "lookup", "arguments": "{}" } }
        ] }, "finish_reason": "tool_calls" }] }),
        &CodexToolContext::default(),
        None,
    );
    let message = anthropic_stream::convert_response(&response, "claude").unwrap();
    let replay = anthropic_to_responses(
        &json!({ "messages": [
        { "role": "assistant", "content": message["content"] },
        { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "call-1", "content": "found" }] }
    ] }),
        "sol",
    );
    let chat = responses_to_chat_completions(&replay);
    assert_eq!(chat["messages"][0]["reasoning_content"], "Need a lookup");
    assert_eq!(chat["messages"][0]["tool_calls"][0]["id"], "call-1");
    assert_eq!(chat["messages"][1]["tool_call_id"], "call-1");
}

#[test]
fn anthropic_protocol_cache_usage_preserves_internal_totals() {
    let source = json!({ "input_tokens": 100, "output_tokens": 10,
        "input_tokens_details": { "cached_tokens": 80 }, "cache_creation_input_tokens": 5,
        "total_tokens": 110 });
    let usage = anthropic_usage(Some(&source));
    assert_eq!(usage["input_tokens"], 15);
    assert_eq!(usage["cache_read_input_tokens"], 80);
    assert_eq!(usage["cache_creation_input_tokens"], 5);
    let recorded = token_usage_values_from_usage(&usage);
    assert_eq!(recorded.input_tokens, Some(100));
    assert_eq!(recorded.cached_tokens, Some(80));
    assert_eq!(recorded.total_tokens, Some(110));
    assert_eq!(
        token_usage_values_from_usage(&source).input_tokens,
        Some(100)
    );
}

#[test]
fn anthropic_protocol_server_search_stays_on_the_server() {
    let request = anthropic_to_responses(
        &json!({ "tools": [{
        "type": "web_search_20250305", "name": "web_search", "allowed_domains": ["example.com"]
    }] }),
        "sol",
    );
    assert_eq!(request["tools"][0]["type"], "web_search");
    assert_eq!(
        request["tools"][0]["filters"]["allowed_domains"],
        json!(["example.com"])
    );
    let response = json!({ "status": "completed", "output": [
        { "id": "ws1", "type": "web_search_call", "action": { "query": "query", "sources": [
            { "type": "url", "url": "https://example.com", "title": "Example" }
        ] } },
        { "type": "message", "content": [{ "type": "output_text", "text": "Answer" }] }
    ] });
    let message = anthropic_stream::convert_response(&response, "claude").unwrap();
    assert_eq!(message["content"][0]["type"], "server_tool_use");
    assert_eq!(message["content"][1]["type"], "web_search_tool_result");
    assert_eq!(
        message["content"][1]["content"][0]["url"],
        "https://example.com"
    );
    assert_eq!(message["stop_reason"], "end_turn");
}
