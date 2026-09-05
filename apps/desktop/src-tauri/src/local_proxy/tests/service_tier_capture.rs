const SERVICE_TIER_TEST_MODEL: &str = "gpt-5.6-sol";

fn service_tier_sse(events: &[Value]) -> Vec<u8> {
    let mut output = events
        .iter()
        .map(|event| format!("data: {event}\r\n\r\n"))
        .collect::<String>();
    output.push_str("data: [DONE]\r\n\r\n");
    output.into_bytes()
}

fn service_tier_http_response(
    api_format: ProviderApiFormat,
    stream: bool,
) -> (&'static str, Vec<u8>) {
    let response = if api_format == ProviderApiFormat::OpenaiChat {
        json!({
            "id": "chatcmpl-service-tier", "model": SERVICE_TIER_TEST_MODEL,
            "service_tier": "default",
            "choices": [{"message": {"role": "assistant", "content": "pong"}}],
            "usage": {"prompt_tokens": 8, "completion_tokens": 2, "total_tokens": 10}
        })
    } else {
        json!({
            "id": "resp-service-tier", "model": SERVICE_TIER_TEST_MODEL,
            "service_tier": "default",
            "usage": {"input_tokens": 8, "output_tokens": 2, "total_tokens": 10}
        })
    };
    if !stream {
        return ("application/json", serde_json::to_vec(&response).unwrap());
    }
    let events = if api_format == ProviderApiFormat::OpenaiChat {
        vec![
            json!({"service_tier": "priority", "choices": [{"delta": {"content": "pong"}}]}),
            json!({"service_tier": "default", "choices": [], "usage": response["usage"]}),
        ]
    } else {
        vec![json!({"type": "response.completed", "response": response})]
    };
    ("text/event-stream", service_tier_sse(&events))
}

fn service_tier_local_upstream(
    api_format: ProviderApiFormat,
    stream: bool,
) -> (String, thread::JoinHandle<(String, Value)>) {
    let server = Server::http("127.0.0.1:0").unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let (content_type, response) = service_tier_http_response(api_format, stream);
    let handle = thread::spawn(move || {
        let mut request = server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .expect("service tier request should reach the local upstream");
        let path = request.url().to_string();
        let mut body = String::new();
        request.as_reader().read_to_string(&mut body).unwrap();
        request
            .respond(
                Response::from_data(response)
                    .with_header(Header::from_bytes("Content-Type", content_type).unwrap()),
            )
            .unwrap();
        (path, serde_json::from_str::<Value>(&body).unwrap())
    });
    (format!("http://{address}/v1"), handle)
}

fn service_tier_http_exchange(
    fast_mode_enabled: bool,
    api_format: ProviderApiFormat,
    stream: bool,
) -> (UpstreamPayload, Value) {
    let (base_url, handle) = service_tier_local_upstream(api_format, stream);
    let mut provider = openai_provider(base_url);
    provider.fast_mode_enabled = fast_mode_enabled;
    provider.api_format = api_format;
    let request = serde_json::to_vec(&json!({
        "model": SERVICE_TIER_TEST_MODEL, "input": "ping", "stream": stream,
        "service_tier": "priority"
    }))
    .unwrap();
    let payload =
        forward_provider_request(&Method::Post, "/v1/responses", &[], request, &provider).unwrap();
    let (path, body) = handle.join().unwrap();
    let expected_path = if api_format == ProviderApiFormat::OpenaiChat {
        "/v1/chat/completions"
    } else {
        "/v1/responses"
    };
    assert_eq!(path, expected_path);
    (payload, body)
}

fn service_tier_multipart(field: Option<&str>) -> Vec<u8> {
    let mut body = concat!(
        "--tier-test\r\nContent-Disposition: form-data; name=\"image\"; filename=\"image.png\"\r\n\r\n",
        "name=\"service_tier\"\r\n\r\npriority\r\n",
        "--tier-test\r\nContent-Disposition: form-data; name=\"service_tier\"; filename=\"tier.txt\"\r\n\r\n",
        "fast\r\n"
    )
    .to_string();
    if let Some(tier) = field {
        body.push_str(&format!(
            "--tier-test\r\nContent-Disposition: form-data; name=\"service_tier\"\r\n\r\n{tier}\r\n"
        ));
    }
    body.push_str("--tier-test--\r\n");
    body.into_bytes()
}

fn service_tier_multipart_headers() -> Vec<(String, String)> {
    vec![(
        "Content-Type".to_string(),
        "multipart/form-data; boundary=tier-test".to_string(),
    )]
}

#[test]
fn service_tier_snapshots_preserve_each_request_choice_during_forwarding() {
    let provider = openai_provider("http://localhost/v1".to_string());
    let original =
        serde_json::to_vec(&json!({"model": SERVICE_TIER_TEST_MODEL, "input": "ping"})).unwrap();
    for path in [
        "/v1/responses",
        "/v1/chat/completions",
        "/v1/responses?stream=true",
    ] {
        let priority = snapshot_request_service_tier(
            &Method::Post,
            path,
            original.clone(),
            Some(ProxyServiceTier::Priority),
        );
        let standard = snapshot_request_service_tier(
            &Method::Post,
            path,
            original.clone(),
            Some(ProxyServiceTier::Default),
        );
        for (body, expected) in [(priority, "priority"), (standard, "default")] {
            let forwarded = provider_body_for_upstream(&Method::Post, path, body, &provider);
            assert_eq!(
                forwarded_request_service_tier(&forwarded, &[]).as_deref(),
                Some(expected)
            );
        }
    }
}

#[test]
fn service_tier_snapshot_does_not_inject_into_image_or_non_post_requests() {
    let original = br#"{"model":"image-model","prompt":"sun"}"#.to_vec();
    for (method, path) in [
        (Method::Post, "/v1/images/generations"),
        (Method::Post, "/v1/images/edits"),
        (Method::Get, "/v1/responses"),
        (Method::Post, "/v1/models"),
    ] {
        let result = snapshot_request_service_tier(
            &method,
            path,
            original.clone(),
            Some(ProxyServiceTier::Priority),
        );
        assert_eq!(result, original);
    }
    let multipart = service_tier_multipart(None);
    assert_eq!(
        snapshot_request_service_tier(
            &Method::Post,
            "/v1/images/edits",
            multipart.clone(),
            Some(ProxyServiceTier::Priority),
        ),
        multipart
    );
}

#[test]
fn forwarded_service_tier_defaults_missing_json_fields_and_preserves_explicit_fast() {
    assert_eq!(
        forwarded_request_service_tier(br#"{"model":"test"}"#, &[]).as_deref(),
        Some("default")
    );
    for tier in ["priority", "default", "fast"] {
        let body =
            serde_json::to_vec(&json!({"model": SERVICE_TIER_TEST_MODEL, "service_tier": tier}))
                .unwrap();
        let snapshot = snapshot_request_service_tier(&Method::Post, "/v1/responses", body, None);
        assert_eq!(
            forwarded_request_service_tier(&snapshot, &[]).as_deref(),
            Some(tier)
        );
    }
    assert_eq!(forwarded_request_service_tier(b"[]", &[]), None);
    assert_eq!(forwarded_request_service_tier(b"not JSON", &[]), None);
}

#[test]
fn forwarded_multipart_service_tier_ignores_file_names_and_file_contents() {
    let headers = service_tier_multipart_headers();
    for (field, expected) in [
        (None, "default"),
        (Some("priority"), "priority"),
        (Some("fast"), "fast"),
    ] {
        let body = service_tier_multipart(field);
        assert_eq!(
            forwarded_request_service_tier(&body, &headers).as_deref(),
            Some(expected)
        );
    }
}

#[test]
fn disabled_fast_mode_rewrites_only_the_multipart_service_tier_text_field() {
    let mut provider = openai_provider("http://localhost/v1".to_string());
    provider.fast_mode_enabled = false;
    let headers = service_tier_multipart_headers();
    let body = service_tier_multipart(Some("priority"));
    let rewritten = enforce_provider_service_tier(body, &headers, &provider);
    assert_eq!(rewritten, service_tier_multipart(Some("default")));
    let missing = service_tier_multipart(None);
    assert_eq!(
        enforce_provider_service_tier(missing.clone(), &headers, &provider),
        missing
    );
}

#[test]
fn response_service_tier_reads_only_valid_metadata_fields() {
    for value in [
        json!({"service_tier": "default"}),
        json!({"response": {"service_tier": "default"}}),
        json!({"message": {"service_tier": "default"}}),
    ] {
        assert_eq!(
            extract_service_tier_from_value(&value).as_deref(),
            Some("default")
        );
    }
    for value in [
        json!({"service_tier": null}),
        json!({"service_tier": "  "}),
        json!({"service_tier": 42}),
        json!({"output": [{"content": "service_tier: priority"}]}),
    ] {
        assert_eq!(extract_service_tier_from_value(&value), None);
    }
}

#[test]
fn json_response_service_tier_overrides_the_forwarded_request_when_reported() {
    let sent = forwarded_request_service_tier(br#"{"service_tier":"priority"}"#, &[]);
    for expects_event_stream in [false, true] {
        let actual = extract_service_tier_from_bytes(
            br#"{"service_tier":"default","usage":{"total_tokens":10}}"#,
            Some("application/json"),
            expects_event_stream,
        );
        assert_eq!(actual.as_deref(), Some("default"));
        assert_eq!(actual.or(sent.clone()).as_deref(), Some("default"));
    }
    let missing = extract_service_tier_from_bytes(br#"{"usage":{"total_tokens":10}}"#, None, false);
    assert_eq!(missing.or(sent).as_deref(), Some("priority"));
}

#[test]
fn sse_response_service_tier_uses_the_last_valid_value_without_requiring_content_type() {
    let bytes = service_tier_sse(&[
        json!({"type": "response.created", "response": {"service_tier": "priority"}}),
        json!({"type": "response.completed", "response": {"service_tier": "default"}}),
        json!({"service_tier": ""}),
        json!({"usage": {"total_tokens": 10}}),
    ]);
    for (content_type, expects_event_stream) in [
        (Some("text/event-stream; charset=utf-8"), false),
        (None, true),
        (Some("application/json"), true),
    ] {
        let actual = extract_service_tier_from_bytes(&bytes, content_type, expects_event_stream);
        assert_eq!(
            actual.or(Some("priority".to_string())).as_deref(),
            Some("default")
        );
    }
}

#[test]
fn provider_forwarding_reports_the_service_tier_actually_sent_to_the_upstream() {
    for (fast_mode_enabled, expected) in [(false, "default"), (true, "priority")] {
        let (payload, request) = service_tier_http_exchange(
            fast_mode_enabled,
            ProviderApiFormat::OpenaiResponses,
            false,
        );
        assert_eq!(request["service_tier"], expected);
        assert_eq!(payload.token_usage_service_tier.as_deref(), Some(expected));
        let sent = payload.token_usage_service_tier.clone();
        let response = read_upstream_payload(payload);
        let actual = extract_service_tier_from_bytes(&response, Some("application/json"), false);
        assert_eq!(actual.or(sent).as_deref(), Some("default"));
    }
}

#[test]
fn chat_bridge_forwarding_keeps_sent_and_actual_tiers_for_json_and_sse() {
    for stream in [false, true] {
        for (fast_mode_enabled, expected) in [(false, "default"), (true, "priority")] {
            let (payload, request) = service_tier_http_exchange(
                fast_mode_enabled,
                ProviderApiFormat::OpenaiChat,
                stream,
            );
            assert_eq!(request["service_tier"], expected);
            assert_eq!(payload.token_usage_service_tier.as_deref(), Some(expected));
            let sent = payload.token_usage_service_tier.clone();
            let content_type = payload.content_type.clone();
            let response = read_upstream_payload(payload);
            let actual =
                extract_service_tier_from_bytes(&response, content_type.as_deref(), stream);
            assert_eq!(actual.as_deref(), Some("default"));
            assert_eq!(actual.or(sent).as_deref(), Some("default"));
        }
    }
}

#[test]
fn chat_json_conversion_preserves_the_upstream_service_tier() {
    for tier in ["priority", "default", "fast"] {
        let response = chat_to_responses_json(
            &json!({
                "id": "chatcmpl-tier", "model": SERVICE_TIER_TEST_MODEL, "service_tier": tier,
                "choices": [{"message": {"role": "assistant", "content": "pong"}}]
            }),
            &CodexToolContext::default(),
            None,
        );
        assert_eq!(response["service_tier"], tier);
    }
}

#[test]
fn chat_sse_conversion_preserves_the_final_upstream_service_tier() {
    let bytes = service_tier_sse(&[
        json!({"service_tier": "priority", "choices": [{"delta": {"content": "pong"}}]}),
        json!({"service_tier": "default", "choices": []}),
        json!({"service_tier": null, "choices": []}),
    ]);
    let output = chat_sse_to_responses_sse(
        std::str::from_utf8(&bytes).unwrap(),
        SERVICE_TIER_TEST_MODEL,
    );
    let completed = sse_event(&output, "response.completed");
    assert_eq!(completed["response"]["service_tier"], "default");
    assert_eq!(
        sse_event(&output, "response.output_text.delta")["delta"],
        "pong"
    );
}

#[test]
fn anthropic_message_endpoints_snapshot_the_service_tier_before_routing() {
    let body = serde_json::to_vec(&json!({
        "model": "claude-test", "max_tokens": 32,
        "messages": [{"role": "user", "content": "ping"}]
    }))
    .unwrap();
    for path in [
        "/messages",
        "/v1/messages",
        "/v1/v1/messages",
        "/claude-desktop/messages",
        "/claude-desktop/v1/messages",
        "/claude-desktop/v1/v1/messages",
        "/v1/messages?beta=true",
    ] {
        let snapshot = snapshot_request_service_tier(
            &Method::Post,
            path,
            body.clone(),
            Some(ProxyServiceTier::Priority),
        );
        assert_eq!(
            forwarded_request_service_tier(&snapshot, &[]).as_deref(),
            Some("priority")
        );
    }
}

#[test]
fn anthropic_provider_forwarding_preserves_frozen_tier_and_respects_disabled_fast_mode() {
    for (fast_mode_enabled, expected) in [(true, "priority"), (false, "default")] {
        let (base_url, handle) =
            service_tier_local_upstream(ProviderApiFormat::OpenaiResponses, true);
        let mut provider = openai_provider(base_url);
        provider.fast_mode_enabled = fast_mode_enabled;
        let body = serde_json::to_vec(&json!({
            "model": "claude-test", "max_tokens": 32, "stream": false,
            "messages": [{"role": "user", "content": "ping"}]
        }))
        .unwrap();
        let snapshot = snapshot_request_service_tier(
            &Method::Post,
            "/v1/messages",
            body,
            Some(ProxyServiceTier::Priority),
        );
        let payload =
            forward_anthropic_provider(snapshot, &provider, SERVICE_TIER_TEST_MODEL).unwrap();
        let (path, request) = handle.join().unwrap();
        assert_eq!(path, "/v1/responses");
        assert_eq!(request["service_tier"], expected);
        assert_eq!(request["model"], SERVICE_TIER_TEST_MODEL);
        assert_eq!(payload.status, 200);
        assert_eq!(payload.token_usage_service_tier.as_deref(), Some(expected));
        let response: Value = serde_json::from_slice(&read_upstream_payload(payload)).unwrap();
        assert_eq!(response["type"], "message");
        assert_eq!(response["usage"]["input_tokens"], 8);
        assert_eq!(response["usage"]["output_tokens"], 2);
    }
}
