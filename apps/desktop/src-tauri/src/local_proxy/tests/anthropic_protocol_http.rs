fn protocol_chat_upstream() -> (ProviderProfile, thread::JoinHandle<Vec<Value>>) {
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut provider = openai_provider(format!("http://{}/v1", server.server_addr()));
    provider.id = uuid::Uuid::new_v4().to_string();
    provider.api_format = ProviderApiFormat::OpenaiChat;
    let worker = thread::spawn(move || {
        let replies = [
            json!({ "role": "assistant", "reasoning_content": "Inspect the screenshot", "tool_calls": [
                { "id": "call-image", "type": "function", "function": { "name": "view", "arguments": "{}" },
                    "extra_content": { "google": { "thought_signature": "signature-for-this-call" } } }
            ] }),
            json!({ "role": "assistant", "reasoning_content": "The image arrived", "content": "Done" }),
        ];
        replies.into_iter().map(|message| {
            let mut request = server.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
            assert_eq!(request.url(), "/v1/chat/completions");
            assert!(!request.headers().iter().any(|header| header.field.equiv(ANTHROPIC_BRIDGE_HEADER)));
            assert!(request.headers().iter().any(|header| header.field.equiv("session-id")));
            let body: Value = serde_json::from_reader(request.as_reader()).unwrap();
            let finish = if message.get("tool_calls").is_some() { "tool_calls" } else { "stop" };
            request.respond(Response::from_string(json!({
                "choices": [{ "message": message, "finish_reason": finish }],
                "usage": { "prompt_tokens": 100, "completion_tokens": 5, "prompt_cache_hit_tokens": 80 }
            }).to_string()).with_header(Header::from_bytes("Content-Type", "application/json").unwrap())).unwrap();
            body
        }).collect()
    });
    (provider, worker)
}

#[test]
fn anthropic_protocol_http_roundtrip_preserves_tools_images_reasoning_and_session_signatures() {
    let (provider, worker) = protocol_chat_upstream();
    let session = uuid::Uuid::new_v4().to_string();
    let mut request = json!({ "model": "claude", "stream": false, "max_tokens": 128,
        "thinking": { "type": "enabled" }, "tool_choice": { "type": "any" },
        "tools": [{ "name": "view", "input_schema": { "type": "object", "properties": {} } }],
        "messages": [{ "role": "user", "content": "look at the screen" }] });
    let payload = forward_anthropic_provider(
        request.to_string().into_bytes(),
        &provider,
        "sol",
        Some(&session),
    )
    .unwrap();
    let message: Value = serde_json::from_slice(&read_upstream_payload(payload)).unwrap();
    assert_eq!(message["stop_reason"], "tool_use");
    assert_eq!(message["usage"]["input_tokens"], 20);
    assert_eq!(message["usage"]["cache_read_input_tokens"], 80);
    request["messages"].as_array_mut().unwrap().extend([
        json!({ "role": "assistant", "content": message["content"] }),
        json!({ "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "call-image", "content": [
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AQID" } }
        ] }] }),
    ]);
    let payload = forward_anthropic_provider(
        request.to_string().into_bytes(),
        &provider,
        "sol",
        Some(&session),
    )
    .unwrap();
    let answer: Value = serde_json::from_slice(&read_upstream_payload(payload)).unwrap();
    assert_eq!(answer["content"][1]["text"], "Done");
    let sent = worker.join().unwrap();
    assert_eq!(sent[0]["tool_choice"], "required");
    assert_eq!(sent[0]["reasoning_effort"], "medium");
    assert_eq!(
        sent[1]["messages"][1]["reasoning_content"],
        "Inspect the screenshot"
    );
    assert_eq!(
        sent[1]["messages"][1]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
        "signature-for-this-call"
    );
    assert_eq!(
        sent[1]["messages"][3]["content"][1]["image_url"]["url"],
        "data:image/png;base64,AQID"
    );
}

#[test]
fn anthropic_protocol_rejects_search_downgrade_instead_of_silently_losing_search() {
    let request = anthropic_to_responses(
        &json!({ "tools": [
        { "type": "web_search_20250305", "name": "web_search" }
    ] }),
        "sol",
    );
    let headers = vec![(ANTHROPIC_BRIDGE_HEADER.to_string(), "true".to_string())];
    assert!(validate_anthropic_chat_tools(&request, &headers).is_err());
    assert!(validate_anthropic_chat_tools(&request, &[]).is_ok());
    let request =
        json!({ "tools": [{ "type": "web_search_20250305", "blocked_domains": ["example.com"] }] });
    assert!(validate_anthropic_search_options(&request).is_err());
    assert!(should_skip_header(ANTHROPIC_BRIDGE_HEADER, false));
}
