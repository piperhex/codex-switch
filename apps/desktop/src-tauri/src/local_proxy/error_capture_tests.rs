use super::*;

fn collect_chunks(
    capture: &mut ErrorCapture,
    bytes: &[u8],
    chunk_size: usize,
) -> Vec<ProxyCapturedError> {
    let mut errors = Vec::new();
    for chunk in bytes.chunks(chunk_size) {
        errors.extend(capture.observe(chunk));
    }
    errors.extend(capture.finish());
    errors
}

#[test]
fn http_errors_capture_only_structured_messages() {
    for body in [
        br#"{"error":{"message":"quota exhausted"}}"#.as_slice(),
        br#"{"error":"quota exhausted"}"#.as_slice(),
        br#"{"detail":"quota exhausted"}"#.as_slice(),
        br#"{"message":"quota exhausted"}"#.as_slice(),
    ] {
        let errors = collect_chunks(&mut ErrorCapture::new(false, 429), body, 3);
        assert_eq!(
            errors,
            vec![ProxyCapturedError {
                message: "quota exhausted".to_string(),
                status_code: Some(429),
            }]
        );
    }
}

#[test]
fn plain_or_unrelated_error_bodies_use_status_without_retaining_body() {
    for body in [
        "sensitive plain response",
        r#"{"input":"private conversation"}"#,
    ] {
        let errors = collect_chunks(&mut ErrorCapture::new(false, 500), body.as_bytes(), 7);
        assert_eq!(errors[0].message, "The upstream service returned HTTP 500.");
    }
    let mut success = ErrorCapture::new(false, 200);
    assert!(success
        .observe(br#"{"message":"private conversation","output":"quoted error text"}"#)
        .is_empty());
    assert!(success.finish().is_empty());
    assert!(success.buffer.is_empty());
}

#[test]
fn successful_http_status_still_recognizes_explicit_json_failures() {
    for body in [
        r#"{"error":{"message":"soft failure","status":429}}"#,
        r#"{"type":"response.failed","response":{"error":{"message":"soft failure","status":429}}}"#,
        r#"{"status":"failed","error":{"message":"soft failure","status":429}}"#,
    ] {
        let errors = collect_chunks(&mut ErrorCapture::new(false, 200), body.as_bytes(), 4);
        assert_eq!(
            errors,
            vec![ProxyCapturedError {
                message: "soft failure".to_string(),
                status_code: Some(429),
            }]
        );
    }
}

#[test]
fn fragmented_utf8_crlf_and_repeated_errors_are_captured_once() {
    let bytes = concat!(
        "event: error\r\n",
        "data: {\"error\":{\"message\":\"服务暂不可用\",\"status\":503}}\r\n\r\n",
        "data: {\"type\":\"response.failed\",\"error\":{\"message\":\"duplicate\"}}\n\n",
    )
    .as_bytes();
    let mut capture = ErrorCapture::new(true, 200);
    let errors = collect_chunks(&mut capture, bytes, 1);
    assert_eq!(
        errors,
        vec![ProxyCapturedError {
            message: "服务暂不可用".to_string(),
            status_code: Some(503),
        }]
    );
    assert!(capture.finish().is_empty());
}

#[test]
fn responses_failure_and_incomplete_reason_are_recognized() {
    let failed = b"data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"denied\"}}}\n\n";
    let errors = collect_chunks(&mut ErrorCapture::new(true, 200), failed, 11);
    assert_eq!(errors[0].message, "denied");
    let incomplete = concat!(
        "data: {\"type\":\"response.incomplete\",\"response\":",
        "{\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n",
    );
    let errors = collect_chunks(&mut ErrorCapture::new(true, 200), incomplete.as_bytes(), 9);
    assert_eq!(
        errors[0].message,
        "The upstream response was incomplete: max_output_tokens"
    );
}

#[test]
fn explicit_error_without_an_event_type_is_recognized() {
    let bytes = b"data: {\"error\":\"upstream unavailable\",\"status_code\":502}\n\n";
    let errors = collect_chunks(&mut ErrorCapture::new(true, 200), bytes, 2);
    assert_eq!(errors[0].message, "upstream unavailable");
    assert_eq!(errors[0].status_code, Some(502));
}

#[test]
fn sse_headers_and_multiline_data_preserve_explicit_failure_events() {
    let bytes = concat!(
        "event: error\r\n",
        "data: {\"type\":\"overloaded_error\",\r\n",
        "data: \"message\":\"service overloaded\"}\r\n\r\n",
    );
    let errors = collect_chunks(&mut ErrorCapture::new(true, 200), bytes.as_bytes(), 2);
    assert_eq!(errors[0].message, "service overloaded");
}

#[test]
fn all_normal_terminal_events_avoid_eof_errors_and_private_output() {
    for terminal in [
        "data: [DONE]\n\n",
        "event: message_stop\n\ndata: {}\n\n",
        "event: response.completed\ndata: {\"type\":\"response\"}\n\n",
        "data: {\"type\":\"message_stop\"}\n\n",
        "data: {\"type\":\"response.completed\"}\n\n",
        "data: {\"choices\":[{\"finish_reason\":\"stop\"}]}\n\n",
    ] {
        let output = concat!(
            "data: {\"type\":\"response.output_text.delta\",",
            "\"delta\":\"private conversation\",\"message\":\"do not log\",\"error\":null}\n\n",
        );
        let bytes = format!("{output}{terminal}");
        let errors = collect_chunks(&mut ErrorCapture::new(true, 200), bytes.as_bytes(), 5);
        assert!(
            errors.is_empty(),
            "Unexpected error for {terminal}: {errors:?}"
        );
    }
}

#[test]
fn completed_image_generation_and_edit_streams_do_not_report_eof_errors() {
    for event_type in ["image_generation.completed", "image_edit.completed"] {
        let events = [
            format!("data: {{\"type\":\"{event_type}\",\"b64_json\":\"private-image\"}}\r\n\r\n"),
            format!("event: {event_type}\r\ndata: {{\"b64_json\":\"private-image\"}}\r\n\r\n"),
        ];
        for event in events {
            let errors = collect_chunks(&mut ErrorCapture::new(true, 200), event.as_bytes(), 3);
            assert!(
                errors.is_empty(),
                "Unexpected image stream error: {errors:?}"
            );
        }
    }
}

#[test]
fn an_unterminated_failure_event_is_processed_at_eof() {
    let bytes = b"event: error\ndata: {\"message\":\"failed before delimiter\"}";
    let errors = collect_chunks(&mut ErrorCapture::new(true, 200), bytes, 4);
    assert_eq!(errors[0].message, "failed before delimiter");
}

#[test]
fn eof_before_a_terminal_event_reports_only_an_interruption() {
    for bytes in [
        b"".as_slice(),
        b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"secret\"}\n\n",
    ] {
        let errors = collect_chunks(&mut ErrorCapture::new(true, 200), bytes, 3);
        assert_eq!(
            errors,
            vec![ProxyCapturedError {
                message: INTERRUPTED_STREAM_ERROR.to_string(),
                status_code: None,
            }]
        );
    }
}

#[test]
fn oversized_output_events_are_bounded_and_do_not_hide_a_later_terminal() {
    let mut capture = ErrorCapture::new(true, 200);
    assert!(capture
        .observe(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"")
        .is_empty());
    assert!(capture
        .observe(&vec![b'x'; MAX_CAPTURE_BYTES * 3])
        .is_empty());
    assert_eq!(capture.buffer.len(), MAX_CAPTURE_BYTES);
    assert!(capture
        .observe(b"\"}\r\n\r\ndata: [DONE]\r\n\r\n")
        .is_empty());
    assert!(capture.finish().is_empty());
}

#[test]
fn oversized_error_events_fall_back_to_a_message_without_raw_body() {
    let mut capture = ErrorCapture::new(true, 200);
    assert!(capture
        .observe(b"event: error\ndata: {\"message\":\"")
        .is_empty());
    assert!(capture
        .observe(&vec![b'x'; MAX_CAPTURE_BYTES * 2])
        .is_empty());
    let errors = capture.observe(b"\"}\n\n");
    assert_eq!(errors[0].message, GENERIC_UPSTREAM_ERROR);
    assert!(capture.finish().is_empty());
}

#[test]
fn oversized_http_error_and_error_messages_stay_bounded() {
    let mut capture = ErrorCapture::new(false, 502);
    assert!(capture
        .observe(&vec![b'x'; MAX_CAPTURE_BYTES * 2])
        .is_empty());
    assert_eq!(capture.buffer.len(), MAX_CAPTURE_BYTES);
    assert_eq!(
        capture.finish()[0].message,
        "The upstream service returned HTTP 502."
    );
    let body = format!(
        "{{\"error\":\"{}\"}}",
        "错".repeat(MAX_ERROR_MESSAGE_CHARS + 5)
    );
    let errors = collect_chunks(&mut ErrorCapture::new(false, 400), body.as_bytes(), 8);
    assert_eq!(errors[0].message.chars().count(), MAX_ERROR_MESSAGE_CHARS);
}
