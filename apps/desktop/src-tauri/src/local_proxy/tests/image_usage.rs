fn image_usage_test_context(body: &[u8], target: &ActiveTarget) -> TokenUsageContext {
    token_usage_context(TokenUsageRequest {
        method: &Method::Post,
        path: "/v1/images/generations",
        body,
        headers: &[],
        target,
        started_at: Instant::now(),
        session_id: None,
        session_request_id: None,
    })
    .expect("image requests must have a usage context")
}

#[test]
fn image_usage_records_the_image_model_instead_of_the_chat_model() {
    let official = ActiveTarget::Official {
        model: "chat-model".to_string(),
    };
    let context = image_usage_test_context(br#"{"model":"image-model","prompt":"sun"}"#, &official);
    assert_eq!(context.provider, "Official Codex");
    assert_eq!(context.model, "image-model");
    let provider =
        ActiveTarget::Provider(Box::new(openai_provider("http://localhost".to_string())));
    let context = image_usage_test_context(br#"{"model":"image-model","prompt":"sun"}"#, &provider);
    assert_eq!(context.provider_id.as_deref(), Some("openai"));
    assert_eq!(context.model, "image-model");
    // An omitted model must not be attributed to the configured chat model.
    assert!(image_usage_test_context(br#"{"prompt":"sun"}"#, &official)
        .model
        .is_empty());
}

#[test]
fn image_usage_reads_the_effective_multipart_model_without_matching_file_contents() {
    let body =
        b"--test\r\nContent-Disposition: form-data; name=\"image\"; filename=\"a.png\"\r\n\r\n\
        name=\"model\"\r\n\r\nwrong-model\r\n\
        --test\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nold-model\r\n--test--\r\n";
    let content_type = "multipart/form-data; boundary=test";
    let headers = vec![("content-type".to_string(), content_type.to_string())];
    assert_eq!(
        multipart_request_text_field(body, &headers, "model").as_deref(),
        Some("old-model")
    );
    let clean_body = b"--test\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nold-model\r\n--test--\r\n";
    let body = body_with_selected_image_model(
        clean_body.to_vec(),
        "selected-image-model",
        Some(content_type),
    );
    let target = ActiveTarget::Official {
        model: "chat-model".to_string(),
    };
    let context = token_usage_context(TokenUsageRequest {
        method: &Method::Post,
        path: "/v1/images/edits",
        body: &body,
        headers: &headers,
        target: &target,
        started_at: Instant::now(),
        session_id: None,
        session_request_id: None,
    })
    .unwrap();
    assert_eq!(context.model, "selected-image-model");
    assert_eq!(context.request_hash, short_hash_bytes(&body));
}

#[test]
fn image_usage_account_is_visible_during_polling_without_token_data() {
    let session_id = format!("image-usage-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".to_string(), session_id.clone())];
    let body = br#"{"model":"image-model","prompt":"sun","stream":true}"#;
    let guard = begin_proxy_session_request(&headers, None, body, None);
    let target = ActiveTarget::Official {
        model: "chat-model".to_string(),
    };
    let mut context = token_usage_context(TokenUsageRequest {
        method: &Method::Post,
        path: "/v1/images/generations",
        body,
        headers: &headers,
        target: &target,
        started_at: Instant::now(),
        session_id: Some(&session_id),
        session_request_id: Some(guard.request_id()),
    })
    .unwrap();
    update_proxy_session_target(
        context.session_id.as_deref(),
        context.session_request_id,
        &context.provider,
        &context.model,
    );
    update_proxy_session_response_account(&mut context, &official_payload(200, 0));
    let (sender, receiver) = mpsc::channel();
    let poll_session = session_id.clone();
    let poll = std::thread::spawn(move || {
        sender
            .send(tauri::async_runtime::block_on(list_proxy_session_requests(
                poll_session,
            )))
            .unwrap();
    });
    let summaries = receiver
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap();
    poll.join().unwrap();
    assert_eq!(summaries[0].model.as_deref(), Some("image-model"));
    assert!(summaries[0].response_time_ms.is_none());
    let sessions = proxy_sessions().lock().unwrap();
    let session = &sessions[&session_id];
    assert_eq!(session.provider.as_deref(), Some("Official Codex"));
    assert_eq!(
        session.account_email.as_deref(),
        Some("current@example.com")
    );
    assert!(session.context_tokens.is_none());
    drop(sessions);
    drop(guard);
    proxy_sessions().lock().unwrap().remove(&session_id);
}

#[test]
fn image_usage_extracts_reported_usage_and_ignores_non_generation_requests() {
    let target = ActiveTarget::Official {
        model: "chat-model".to_string(),
    };
    let context = image_usage_test_context(br#"{"model":"image-model","stream":true}"#, &target);
    let events = b"data: {\"type\":\"image_generation.completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":20}}\n\n";
    let usage = extract_token_usage_from_bytes(events, None, context.expects_event_stream).unwrap();
    assert_eq!(usage.total_tokens, Some(30));
    assert!(token_usage_context(TokenUsageRequest {
        method: &Method::Get,
        path: "/v1/images/generations",
        body: b"{}",
        headers: &[],
        target: &target,
        started_at: Instant::now(),
        session_id: None,
        session_request_id: None,
    })
    .is_none());
}
