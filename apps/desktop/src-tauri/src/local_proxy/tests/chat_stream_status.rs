const CHAT_STATUS_TEST_MODEL: &str = "chat-status-test";

fn chat_status_sse(events: &[Value], done: bool) -> String {
    let mut output = events
        .iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect::<String>();
    if done {
        output.push_str("data: [DONE]\n\n");
    }
    output
}

#[test]
fn chat_stream_status_rejects_eof_without_a_completion_marker() {
    for source in [
        "",
        "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
    ] {
        let output = chat_sse_to_responses_sse(source, CHAT_STATUS_TEST_MODEL);
        assert_eq!(
            sse_event(&output, "response.failed")["response"]["status"],
            "failed"
        );
        assert!(!output.contains("response.completed"));
        assert!(!output.contains("response.output_text.done"));
    }
}

#[test]
fn chat_stream_status_preserves_partial_output_without_finishing_tools() {
    let source = chat_status_sse(
        &[json!({ "choices": [{ "delta": {
        "content": "partial",
        "tool_calls": [{ "index": 0, "id": "call_partial", "function": {
            "name": "weather", "arguments": "{\"city\":"
        }}]
    }}] })],
        false,
    );
    let output = chat_sse_to_responses_sse(&source, CHAT_STATUS_TEST_MODEL);
    let response = &sse_event(&output, "response.failed")["response"];
    assert_eq!(response["output"][0]["content"][0]["text"], "partial");
    assert_eq!(response["output"][1]["arguments"], "{\"city\":");
    assert_eq!(response["output"][1]["status"], "incomplete");
    assert!(!output.contains("response.function_call_arguments.done"));
}

#[test]
fn chat_stream_status_maps_truncation_and_retains_final_usage() {
    for (finish, reason) in [
        ("length", "max_output_tokens"),
        ("content_filter", "content_filter"),
    ] {
        let source = chat_status_sse(
            &[
                json!({ "choices": [{ "delta": { "content": "partial" }, "finish_reason": finish }] }),
                json!({ "choices": [], "usage": { "prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7 } }),
            ],
            true,
        );
        let output = chat_sse_to_responses_sse(&source, CHAT_STATUS_TEST_MODEL);
        let response = &sse_event(&output, "response.incomplete")["response"];
        assert_eq!(response["incomplete_details"]["reason"], reason);
        assert_eq!(response["output"][0]["status"], "incomplete");
        assert_eq!(response["usage"]["total_tokens"], 7);
        assert!(!output.contains("response.completed"));
    }
}

#[test]
fn chat_stream_status_rejects_explicit_errors_even_after_finish_reason() {
    for failure in [
        json!({ "error": { "message": "private upstream details" } }),
        json!({ "type": "error", "message": "private upstream details" }),
        json!({ "type": "response.failed", "response": { "status": "failed" } }),
        json!({ "choices": [{ "delta": {}, "finish_reason": "error" }] }),
    ] {
        let source = chat_status_sse(
            &[
                json!({ "choices": [{ "delta": { "content": "partial" }, "finish_reason": "stop" }] }),
                failure,
            ],
            true,
        );
        let output = chat_sse_to_responses_sse(&source, CHAT_STATUS_TEST_MODEL);
        assert!(output.contains("response.failed"));
        assert!(!output.contains("response.completed"));
        assert!(!output.contains("private upstream details"));
    }
}

#[test]
fn chat_stream_status_rejects_named_error_events_and_malformed_data() {
    for source in [
        "event: error\r\ndata: {\"message\":\"upstream failed\"}\r\n\r\ndata: [DONE]\r\n\r\n",
        "data: {broken json}\n\ndata: [DONE]\n\n",
    ] {
        let output = chat_sse_to_responses_sse(source, CHAT_STATUS_TEST_MODEL);
        assert!(output.contains("response.failed"));
        assert!(!output.contains("response.completed"));
    }
}

#[test]
fn chat_stream_status_cannot_downgrade_a_failure_to_incomplete() {
    let source = chat_status_sse(
        &[
            json!({ "choices": [{ "delta": {}, "finish_reason": "error" }] }),
            json!({ "choices": [{ "delta": {}, "finish_reason": "length" }] }),
        ],
        true,
    );
    let output = chat_sse_to_responses_sse(&source, CHAT_STATUS_TEST_MODEL);
    assert!(output.contains("response.failed"));
    assert!(!output.contains("response.incomplete"));
}

#[test]
fn chat_stream_status_accepts_finish_reason_or_explicit_done() {
    for finish in [
        Some("stop"),
        Some("tool_calls"),
        Some("function_call"),
        None,
    ] {
        let source = chat_status_sse(
            &[json!({ "choices": [{
            "delta": { "content": "complete" }, "finish_reason": finish
        }] })],
            finish.is_none(),
        );
        let output = chat_sse_to_responses_sse(&source, CHAT_STATUS_TEST_MODEL);
        assert_eq!(
            sse_event(&output, "response.completed")["response"]["status"],
            "completed"
        );
        assert!(!output.contains("response.failed"));
    }
}

#[test]
fn chat_stream_status_does_not_complete_invalid_tool_arguments_on_done() {
    let source = chat_status_sse(
        &[json!({ "choices": [{ "delta": {
        "tool_calls": [{ "index": 0, "id": "call_partial", "function": {
            "name": "weather", "arguments": "{\"city\":"
        }}]
    }, "finish_reason": "tool_calls" }] })],
        true,
    );
    let output = chat_sse_to_responses_sse(&source, CHAT_STATUS_TEST_MODEL);
    assert!(output.contains("response.failed"));
    assert!(!output.contains("response.completed"));
    assert!(!output.contains("response.function_call_arguments.done"));
}

#[test]
fn chat_stream_status_json_fallback_preserves_failures_and_truncation() {
    for (finish, status) in [
        ("length", "incomplete"),
        ("content_filter", "incomplete"),
        ("error", "failed"),
    ] {
        let response = chat_to_responses_json(
            &json!({ "choices": [{
            "message": { "content": "partial" }, "finish_reason": finish
        }] }),
            &CodexToolContext::default(),
            None,
        );
        assert_eq!(response["status"], status);
        assert_eq!(response["output"][0]["status"], "incomplete");
    }
    let response = chat_to_responses_json(
        &json!({ "error": { "message": "failed" } }),
        &CodexToolContext::default(),
        None,
    );
    assert_eq!(response["status"], "failed");
}

struct ChatStatusBrokenReader;

impl Read for ChatStatusBrokenReader {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::new(
            io::ErrorKind::ConnectionReset,
            "private connection details",
        ))
    }
}

#[test]
fn chat_stream_status_read_error_overrides_success_marker() {
    let source = chat_status_sse(
        &[json!({ "choices": [{
        "delta": { "content": "partial" }, "finish_reason": "stop"
    }] })],
        false,
    );
    let upstream = Cursor::new(source.into_bytes()).chain(ChatStatusBrokenReader);
    let mut reader = ChatSseReader::new(
        BufReader::new(upstream),
        CHAT_STATUS_TEST_MODEL.to_string(),
        CodexToolContext::default(),
        None,
    );
    let mut output = String::new();
    reader.read_to_string(&mut output).unwrap();
    assert!(output.contains("response.failed"));
    assert!(!output.contains("response.completed"));
    assert!(!output.contains("private connection details"));
}

#[test]
fn chat_stream_status_http_200_error_is_forwarded_as_failure() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut provider = openai_provider(format!("http://{}/v1", server.server_addr()));
    provider.api_format = ProviderApiFormat::OpenaiChat;
    let server_thread = thread::spawn(move || {
        let request = server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        let body = "event: error\ndata: {\"message\":\"upstream failed\"}\n\n";
        request
            .respond(
                Response::from_string(body)
                    .with_header(Header::from_bytes("Content-Type", "text/event-stream").unwrap()),
            )
            .unwrap();
    });
    let request = json!({ "input": "ping", "stream": true })
        .to_string()
        .into_bytes();
    let payload =
        forward_provider_request(&Method::Post, "/v1/responses", &[], request, &provider).unwrap();
    assert_eq!(payload.status, 200);
    let output = String::from_utf8(read_upstream_payload(payload)).unwrap();
    server_thread.join().unwrap();
    assert!(output.contains("response.failed"));
    assert!(!output.contains("response.completed"));
}

#[test]
fn chat_stream_status_returns_a_delta_before_slow_upstream_finishes() {
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (release, wait) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\r\n\r\n")
            .unwrap();
        // The final bytes cannot exist until the client has observed a delta.
        wait.recv_timeout(Duration::from_secs(5)).unwrap();
        stream
            .write_all(b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\r\n\r\n")
            .unwrap();
    });
    let (delta, observed) = mpsc::channel();
    let client_thread = thread::spawn(move || {
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        chat_status_receive_slow_stream(stream, delta)
    });
    let partial = observed.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(partial.contains("first"));
    assert!(!partial.contains("response.completed"));
    release.send(()).unwrap();
    let complete = client_thread.join().unwrap();
    upstream_thread.join().unwrap();
    assert!(complete.contains("response.completed"));
}

fn chat_status_receive_slow_stream(
    stream: std::net::TcpStream,
    delta: mpsc::Sender<String>,
) -> String {
    let mut reader = ChatSseReader::new(
        BufReader::new(stream),
        CHAT_STATUS_TEST_MODEL.to_string(),
        CodexToolContext::default(),
        None,
    );
    let mut bytes = [0; 4096];
    let mut output = String::new();
    while !output.contains("response.output_text.delta") {
        let read = reader.read(&mut bytes).unwrap();
        assert_ne!(read, 0);
        output.push_str(std::str::from_utf8(&bytes[..read]).unwrap());
    }
    delta.send(output.clone()).unwrap();
    reader.read_to_string(&mut output).unwrap();
    output
}
