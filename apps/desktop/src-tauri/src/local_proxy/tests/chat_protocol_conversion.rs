#[test]
fn chat_protocol_promotes_runtime_tools_without_reading_tools_from_payload_data() {
    let request = json!({ "input": [
        { "type": "additional_tools", "tools": [
            { "type": "function", "name": "wait", "parameters": { "type": "object" } },
            { "type": "custom", "name": "exec" },
            { "type": "namespace", "name": "browser", "tools": [
                { "type": "function", "name": "open", "parameters": { "type": "object" } }
            ] }
        ] },
        { "type": "tool_search_output", "call_id": "discovery", "tools": [
            { "type": "function", "name": "loaded", "parameters": { "type": "object" } }
        ], "output": { "type": "additional_tools", "tools": [{ "type": "function", "name": "injected" }] } },
        { "role": "user", "content": "browse" }
    ], "tool_choice": { "type": "function", "namespace": "browser", "name": "open" } });
    let context = build_codex_tool_context_from_request(&request);
    let chat = responses_to_chat_completions_with_context(&request, &context, None);
    let names: Vec<_> = chat["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["function"]["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["wait", "exec", "browser__open", "loaded"]);
    assert_eq!(chat["tool_choice"]["function"]["name"], "browser__open");
    assert_eq!(chat["messages"].as_array().unwrap().len(), 2);
    let response = chat_to_responses_json(
        &json!({ "choices": [{ "message": {
        "tool_calls": [{ "id": "call1", "function": { "name": "exec", "arguments": "{\"input\":\"ls\"}" } }]
    } }] }),
        &context,
        None,
    );
    assert_eq!(response["output"][0]["type"], "custom_tool_call");
    assert_eq!(response["output"][0]["input"], "ls");
}

#[test]
fn chat_protocol_keeps_agent_task_body_in_order_without_exposing_reasoning_ciphertext() {
    let chat = responses_to_chat_completions(&json!({ "input": [
        { "type": "agent_message", "content": [
            { "type": "input_text", "text": "Payload:\n" },
            { "type": "encrypted_content", "encrypted_content": "Find the bug" }
        ] },
        { "type": "reasoning", "encrypted_content": "opaque-reasoning", "summary": [] },
        { "role": "assistant", "content": "done" }
    ] }));
    assert_eq!(chat["messages"][0]["content"], "Payload:\nFind the bug");
    assert!(!chat.to_string().contains("opaque-reasoning"));
}

#[test]
fn chat_protocol_lifts_images_after_all_parallel_results_and_keeps_notices() {
    let mut input = vec![
        json!({ "type": "function_call", "call_id": "a", "name": "view", "arguments": "{}" }),
        json!({ "type": "function_call", "call_id": "b", "name": "view", "arguments": "{}" }),
    ];
    for id in ["a", "b"] {
        input.push(json!({ "type": "function_call_output", "call_id": id, "output": [
            { "type": "input_text", "text": format!("result {id}") },
            { "type": "input_image", "image_url": format!("data:image/png;base64,{id}"), "detail": "high" }
        ] }));
        input.push(json!({ "role": "developer", "content": format!("notice {id}") }));
    }
    let chat = responses_to_chat_completions(&json!({ "input": input }));
    let messages = chat["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 6);
    assert_eq!(messages[1]["tool_call_id"], "a");
    assert_eq!(messages[2]["tool_call_id"], "b");
    for message in &messages[1..3] {
        assert!(!message["content"].as_str().unwrap().contains("base64"));
    }
    assert_eq!(messages[3]["role"], "user");
    assert_eq!(
        messages[3]["content"][1]["image_url"]["url"],
        "data:image/png;base64,a"
    );
    assert_eq!(messages[3]["content"][3]["image_url"]["detail"], "high");
    assert_eq!(messages[4]["content"], "notice a");
    assert_eq!(messages[5]["content"], "notice b");
}

#[test]
fn chat_protocol_preserves_schema_and_reasoning_controls() {
    let format = json!({ "type": "json_schema", "name": "answer", "strict": true,
        "schema": { "type": "object", "properties": { "ok": { "type": "boolean" } },
            "required": ["ok"], "additionalProperties": false } });
    let request = json!({ "input": "answer", "text": { "format": format }, "reasoning": { "effort": "high" } });
    let chat = responses_to_chat_completions(&request);
    assert_eq!(chat["reasoning_effort"], "high");
    assert_eq!(
        chat["response_format"]["json_schema"]["schema"],
        format["schema"]
    );
    assert_eq!(chat["response_format"]["json_schema"]["strict"], true);
    let request = json!({ "reasoning": { "effort": "none" } });
    let mut chat = responses_to_chat_completions(&request);
    apply_deepseek_reasoning(&request, &mut chat);
    assert_eq!(chat["thinking"]["type"], "disabled");
    assert!(chat.get("reasoning_effort").is_none());
}

#[test]
fn chat_protocol_replays_reasoning_without_a_cache_or_tool_call() {
    let response = chat_to_responses_json(
        &json!({ "id": "reasoning-test", "choices": [{
        "message": { "content": "Found", "reasoning_content": "Inspect first" }, "finish_reason": "stop"
    }] }),
        &CodexToolContext::default(),
        None,
    );
    let mut input = response["output"].as_array().unwrap().clone();
    input.push(
        json!({ "type": "function_call", "call_id": "a", "name": "lookup", "arguments": "{}" }),
    );
    input.push(json!({ "type": "function_call_output", "call_id": "a", "output": "done" }));
    input.push(
        json!({ "type": "function_call", "call_id": "b", "name": "lookup", "arguments": "{}" }),
    );
    input.push(json!({ "type": "function_call_output", "call_id": "b", "output": "done" }));
    input.push(json!({ "role": "user", "content": "new turn" }));
    input.push(json!({ "role": "assistant", "content": "new answer" }));
    let chat = responses_to_chat_completions(&json!({ "input": input }));
    assert_eq!(chat["messages"][0]["reasoning_content"], "Inspect first");
    assert_eq!(chat["messages"][2]["reasoning_content"], "Inspect first");
    assert!(chat["messages"][5].get("reasoning_content").is_none());
}

#[test]
fn chat_protocol_restores_compacted_plain_reply_only_in_its_original_scope() {
    let context = CodexToolContext::default();
    let session = uuid::Uuid::new_v4().to_string();
    let scope = chat_bridge_continuation::ContinuationScope::new("original-provider", &session);
    let response = chat_to_responses_json(
        &json!({ "id": "plain-reply", "choices": [{
        "message": { "content": "answer", "reasoning_content": "private reasoning" }, "finish_reason": "stop"
    }] }),
        &context,
        Some(&scope),
    );
    let mut input = response["output"].clone();
    input[0]["summary"] = json!([]);
    input[0]["encrypted_content"] = json!("opaque-client-history");
    let request = json!({ "input": input });
    let restored = responses_to_chat_completions_with_context(&request, &context, Some(&scope));
    assert_eq!(
        restored["messages"][0]["reasoning_content"],
        "private reasoning"
    );
    for foreign in [
        chat_bridge_continuation::ContinuationScope::new("other-provider", &session),
        chat_bridge_continuation::ContinuationScope::new("original-provider", "other-session"),
    ] {
        let chat = responses_to_chat_completions_with_context(&request, &context, Some(&foreign));
        assert!(chat["messages"][0].get("reasoning_content").is_none());
    }
    assert_ne!(
        response_id(),
        response_id(),
        "concurrent streams need distinct cache identities"
    );
}

#[test]
fn chat_protocol_keeps_non_text_metadata_next_to_lifted_tool_images() {
    let chat = responses_to_chat_completions(&json!({ "input": [
        { "type": "function_call_output", "call_id": "mixed", "output": [
            { "type": "input_text", "text": "screen" },
            { "width": 120, "height": 80 },
            { "type": "input_image", "image_url": "data:image/png;base64,AQID" }
        ] }
    ] }));
    let text = chat["messages"][0]["content"].as_str().unwrap();
    assert!(text.contains("screen"));
    assert!(text.contains("\"width\":120"));
    assert!(!text.contains("base64"));
}
