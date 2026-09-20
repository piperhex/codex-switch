fn relay_message() -> Value {
    json!({
        "type": "message", "role": "assistant", "status": "completed", "phase": "final_answer",
        "id": "item_d8f6396d6dd14e9e4b56d7ce",
        "content": [{ "type": "output_text", "text": "Previous answer", "annotations": [] }]
    })
}

#[test]
fn official_input_replays_relay_message_after_repeated_continuations() {
    let mut message_without_id = relay_message();
    message_without_id.as_object_mut().unwrap().remove("id");
    for index in [19, 21] {
        let mut input = vec![json!({ "role": "user", "content": "Earlier turn" }); index];
        input.push(relay_message());
        input.push(json!({ "role": "user", "content": "Continue" }));
        let body = serde_json::to_vec(&json!({ "model": "gpt-5.6-sol", "input": input })).unwrap();

        let forwarded =
            official_body_for_upstream(&Method::Post, "/v1/responses", body, "gpt-5.6-sol");
        let parsed: Value = serde_json::from_slice(&forwarded).unwrap();

        assert_eq!(parsed["input"][index], message_without_id);
        assert_eq!(parsed["input"].as_array().unwrap().len(), input.len());
        assert_eq!(parsed["input"][index + 1], input[index + 1]);
    }
}

#[test]
fn official_input_cleans_message_ids_for_create_and_compact_endpoints() {
    let mut implicit_message = relay_message();
    implicit_message.as_object_mut().unwrap().remove("type");
    for path in [
        "/responses",
        "/v1/responses",
        "/codex/v1/responses?stream=true",
        "/responses/compact",
        "/v1/responses/compact",
        "/codex/v1/responses/compact",
    ] {
        for input in [
            relay_message(),
            json!([implicit_message, [relay_message()]]),
        ] {
            let body =
                serde_json::to_vec(&json!({ "model": "gpt-5.6-sol", "input": input })).unwrap();
            let forwarded = official_body_for_upstream(&Method::Post, path, body, "gpt-5.6-sol");
            let parsed: Value = serde_json::from_slice(&forwarded).unwrap();
            let input = &parsed["input"];
            if input.is_array() {
                assert!(input[0].get("id").is_none());
                assert!(input[1][0].get("id").is_none());
                assert_eq!(input[0]["content"], implicit_message["content"]);
            } else {
                assert!(input.get("id").is_none());
                assert_eq!(input["content"], relay_message()["content"]);
            }
        }
    }
}

#[test]
fn official_input_keeps_valid_messages_and_tool_relationships_unchanged() {
    let body = serde_json::to_vec_pretty(&json!({
        "model": "gpt-5.6-sol", "previous_response_id": "resp_previous",
        "input": [
            { "type": "message", "id": "msg_official", "role": "assistant", "content": "Answer" },
            { "role": "user", "content": "Continue" },
            { "type": "message", "id": "item_reference_without_content" },
            { "type": "item_reference", "id": "item_reference" },
            { "type": "reasoning", "id": "rs_official", "encrypted_content": "opaque", "summary": [] },
            { "type": "function_call", "id": "item_tool", "call_id": "call_1",
              "name": "read", "arguments": "{}" },
            { "type": "function_call_output", "id": "item_result", "call_id": "call_1", "output": "ok" },
            { "type": "custom_tool_call", "id": "item_custom", "call_id": "call_2",
              "name": "patch", "input": "patch text" },
            { "type": "custom_tool_call_output", "id": "item_custom_result",
              "call_id": "call_2", "output": "ok" }
        ]
    })).unwrap();

    let forwarded =
        official_body_for_upstream(&Method::Post, "/v1/responses", body.clone(), "gpt-5.6-sol");

    assert_eq!(forwarded, body);
}

#[test]
fn official_input_cleans_relay_messages_alongside_incompatible_reasoning() {
    let mut message = relay_message();
    message["content"][0]["annotations"] =
        json!([{ "type": "file_citation", "file_id": "item_file" }]);
    let body = serde_json::to_vec(&json!({
        "model": "gpt-5.6-sol", "store": false,
        "input": [
            { "type": "reasoning", "id": "item_reasoning", "summary": [] },
            { "type": "reasoning", "id": "rs_resp_local", "summary": [] },
            message
        ]
    }))
    .unwrap();

    let forwarded = official_body_for_upstream(&Method::Post, "/v1/responses", body, "gpt-5.6-sol");
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();

    message.as_object_mut().unwrap().remove("id");
    assert_eq!(parsed["input"], json!([message]));
    assert_eq!(parsed["store"], false);
}

#[test]
fn official_input_compatibility_applies_to_openai_providers_only() {
    let mut provider = openai_provider("https://upstream.example.com/v1".to_string());
    let body =
        serde_json::to_vec(&json!({ "model": "gpt-5.6-sol", "input": [relay_message()] })).unwrap();
    let forwarded =
        provider_body_for_upstream(&Method::Post, "/v1/responses", body.clone(), &provider);
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();
    assert!(parsed["input"][0].get("id").is_none());
    assert_eq!(parsed["input"][0]["content"], relay_message()["content"]);

    provider.kind = ProviderKind::Custom;
    let forwarded = provider_body_for_upstream(&Method::Post, "/v1/responses", body, &provider);
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();
    assert_eq!(parsed["input"], json!([relay_message()]));
}

#[test]
fn official_input_leaves_unrelated_requests_and_invalid_json_unchanged() {
    let body =
        serde_json::to_vec(&json!({ "model": "gpt-5.6-sol", "input": [relay_message()] })).unwrap();
    for (method, path) in [
        (Method::Get, "/v1/responses"),
        (Method::Post, "/v1/chat/completions"),
    ] {
        assert_eq!(
            official_body_for_upstream(&method, path, body.clone(), "gpt-5.6-sol"),
            body
        );
    }
    for body in [
        br#"{"input":"unfinished"#.to_vec(),
        br#"{ "input": "hello", "model": "gpt-5.6-sol" }"#.to_vec(),
    ] {
        assert_eq!(
            official_body_for_upstream(&Method::Post, "/v1/responses", body.clone(), "gpt-5.6-sol"),
            body
        );
    }
}
