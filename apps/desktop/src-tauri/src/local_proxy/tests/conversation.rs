#[test]
fn conversation_images_do_not_truncate_following_text() {
    let source = format!("data:image/png;base64,{}", "A".repeat(20_000));
    let body = serde_json::to_vec(&json!({ "input": [{ "role": "user", "content": [
        { "type": "input_image", "image_url": source },
        { "type": "input_text", "text": "Describe the image after this attachment" }
    ] }]}))
    .unwrap();
    let captured = capture_request_conversation(&body);
    let text = captured.text.unwrap();
    assert!(text.contains("Describe the image"));
    assert!(!text.contains("base64"));
    assert_eq!(captured.attachments.len(), 1);
    let stored = tauri::async_runtime::block_on(get_proxy_conversation_attachment(
        captured.attachments[0].id.clone(),
    ))
    .unwrap()
    .unwrap();
    assert_eq!(stored, source);
}

#[test]
fn conversation_supports_chat_anthropic_and_unavailable_image_references() {
    let captured = capture_conversation_value(json!([
        { "type": "image_url", "image_url": { "url": "https://example.com/a.png" } },
        { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AA==" } },
        { "type": "input_image", "file_id": "file-123" },
        { "type": "input_image", "image_url": "file:///private.png" }
    ]));
    assert_eq!(captured.attachments.len(), 4);
    assert!(!captured.text.unwrap().contains("private.png"));
    assert!(!safe_conversation_image_source("javascript:alert(1)"));
    assert!(!safe_conversation_image_source(
        "data:image/svg+xml;base64,AA=="
    ));
    assert!(!safe_conversation_image_source(
        "https://user:secret@example.com/image.png"
    ));
}

fn conversation_test_stream(events: &[Value]) -> Vec<u8> {
    events
        .iter()
        .map(|event| format!("data: {event}\r\n\r\n"))
        .collect::<String>()
        .into_bytes()
}

#[test]
fn conversation_stream_preserves_utf8_and_deduplicates_completed_images() {
    let item =
        json!({ "type": "image_generation_call", "result": "AA==", "output_format": "webp" });
    let events = conversation_test_stream(&[
        json!({ "type": "response.output_text.delta", "delta": "画好了🌄" }),
        json!({ "type": "response.output_item.done", "output_index": 0, "item": item }),
        json!({ "type": "response.completed", "response": { "output": [item,
            { "type": "message", "content": [{ "type": "output_text", "text": "画好了🌄" }] }
        ] } }),
    ]);
    for chunk_size in [1, 3, 17, events.len()] {
        let mut capture = ConversationResponseCapture {
            event_stream: true,
            ..Default::default()
        };
        for chunk in events.chunks(chunk_size) {
            capture.observe(chunk);
        }
        let result = capture.finish();
        assert_eq!(result.attachments.len(), 1);
        assert!(result.text.unwrap().contains("画好了🌄"));
        let source = tauri::async_runtime::block_on(get_proxy_conversation_attachment(
            result.attachments[0].id.clone(),
        ))
        .unwrap()
        .unwrap();
        assert_eq!(source, "data:image/webp;base64,AA==");
    }
}

#[test]
fn conversation_stream_keeps_output_when_connection_ends_early() {
    let mut capture = ConversationResponseCapture {
        event_stream: true,
        ..Default::default()
    };
    capture.observe(
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"部分回复\"}".as_bytes(),
    );
    assert_eq!(capture.finish().text.as_deref(), Some("部分回复"));
    let mut capture = ConversationResponseCapture {
        event_stream: true,
        ..Default::default()
    };
    capture.observe(&conversation_test_stream(&[
        json!({ "type": "response.output_item.done",
            "item": { "type": "image_generation_call", "result": "AA==" }
        }),
    ]));
    assert_eq!(capture.finish().attachments.len(), 1);
}

#[test]
fn conversation_completion_without_output_preserves_finished_images() {
    let mut capture = ConversationResponseCapture {
        event_stream: true,
        ..Default::default()
    };
    capture.observe(&conversation_test_stream(&[
        json!({ "type": "response.output_item.done", "output_index": 1,
            "item": { "type": "image_generation_call", "result": "AA==" } }),
        json!({ "type": "response.completed", "response": { "status": "completed" } }),
    ]));
    assert_eq!(capture.finish().attachments.len(), 1);
}

#[test]
fn conversation_images_api_captures_base64_and_url_results() {
    let result = capture_response_value(json!({ "data": [
        { "b64_json": "AA==" }, { "url": "https://example.com/image.png" }
    ] }));
    assert_eq!(result.attachments.len(), 2);
    assert!(!result.text.unwrap().contains("AA=="));
}

#[test]
fn conversation_cache_bounds_memory_and_refreshes_recent_images() {
    let mut cache = ConversationAttachmentCache::default();
    let first = cache.insert("first".to_string());
    for index in 1..MAX_CONVERSATION_CACHE_ENTRIES {
        cache.insert(index.to_string());
    }
    assert_eq!(cache.insert("first".to_string()), first);
    cache.insert("new".to_string());
    assert_eq!(cache.entries.len(), MAX_CONVERSATION_CACHE_ENTRIES);
    assert!(cache.entries.iter().any(|(id, _)| id == &first));
    assert_eq!(
        cache.bytes,
        cache
            .entries
            .iter()
            .map(|(_, value)| value.len())
            .sum::<usize>()
    );
    let huge = cache.insert("x".repeat(MAX_CONVERSATION_ATTACHMENT_BYTES + 1));
    assert!(!cache.entries.iter().any(|(id, _)| id == &huge));
}

#[test]
fn conversation_capture_bounds_oversized_events_and_recovers() {
    let mut capture = ConversationResponseCapture {
        event_stream: true,
        ..Default::default()
    };
    capture.observe(b"data: ");
    let bytes = vec![b'x'; MAX_CONVERSATION_EVENT_BYTES + 1];
    capture.observe(&bytes);
    capture.observe(b"\r\n\r\n");
    capture.observe(&conversation_test_stream(&[
        json!({ "type": "response.output_text.delta", "delta": "ok" }),
    ]));
    assert!(capture.truncated);
    assert_eq!(capture.finish().text.as_deref(), Some("ok"));
}

#[test]
fn conversation_captures_multipart_edit_input() {
    let body = b"--test\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nEdit this\r\n\
        --test\r\nContent-Disposition: form-data; name=\"image\"; filename=\"a.png\"\r\n\
        Content-Type: image/png\r\n\r\n\x89PNG\r\n\x1a\nimage\r\n--test--\r\n";
    let headers = vec![(
        "content-type".to_string(),
        "multipart/form-data; boundary=test".to_string(),
    )];
    let result = capture_session_request_conversation(body, &headers);
    assert_eq!(result.attachments.len(), 1);
    assert!(result.text.unwrap().contains("Edit this"));
}

#[test]
fn conversation_reader_forwards_exact_bytes_and_keeps_polling_responsive() {
    let session_id = format!("conversation-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".to_string(), session_id.clone())];
    let guard =
        begin_proxy_session_request(&headers, None, br#"{"input":"draw","stream":true}"#, None);
    let bytes = conversation_test_stream(&[json!({ "type": "response.completed",
        "response": { "output": [{ "type": "image_generation_call", "result": "AA==" }] }
    })]);
    let payload = attach_conversation_response_capture(
        UpstreamPayload {
            status: 200,
            content_type: None,
            response_headers: Vec::new(),
            body: UpstreamBody::Streaming(Box::new(Cursor::new(bytes.clone()))),
            token_usage_account: None,
        },
        Some(&guard),
    );
    // A live request can be polled before its body is consumed; summaries carry no image payload.
    for _ in 0..3 {
        let summaries =
            tauri::async_runtime::block_on(list_proxy_session_requests(session_id.clone()))
                .unwrap();
        assert!(summaries[0].response.is_none());
        assert!(summaries[0].response_time_ms.is_none());
    }
    let UpstreamBody::Streaming(mut reader) = payload.body else {
        panic!("stream expected");
    };
    assert_eq!(reader.read(&mut []).unwrap(), 0);
    let mut forwarded = Vec::new();
    reader.read_to_end(&mut forwarded).unwrap();
    assert_eq!(forwarded, bytes);
    let summaries = list_proxy_session_requests_blocking(&session_id).unwrap();
    assert_eq!(summaries[0].output_attachments.len(), 1);
    assert!(!serde_json::to_string(&summaries).unwrap().contains("AA=="));
    drop(guard);
    proxy_sessions().lock().unwrap().remove(&session_id);
}
