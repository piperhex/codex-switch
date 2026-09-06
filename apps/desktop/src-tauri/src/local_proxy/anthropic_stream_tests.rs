use super::super::{convert_responses_payload, UpstreamBody, UpstreamPayload};
use super::*;

fn frame(value: Value) -> String {
    format!("data: {value}\n\n")
}

fn complete() -> Value {
    json!({
        "type": "response.completed",
        "response": { "id": "resp_test", "status": "completed", "usage": { "input_tokens": 4, "output_tokens": 2 } }
    })
}

fn text_delta(text: &str) -> Value {
    json!({
        "type": "response.output_text.delta", "item_id": "message-1", "output_index": 0,
        "content_index": 0, "delta": text
    })
}

fn stream_values(source: &str) -> Vec<Value> {
    let mut reader = AnthropicSseReader::new(io::Cursor::new(source.as_bytes()), "claude-test");
    let mut output = String::new();
    reader
        .read_to_string(&mut output)
        .expect("read converted stream");
    output
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .map(|data| serde_json::from_str(data).expect("valid downstream SSE JSON"))
        .collect()
}

fn payload(body: UpstreamBody, content_type: &str) -> UpstreamPayload {
    UpstreamPayload {
        status: 200,
        content_type: Some(content_type.to_string()),
        response_headers: vec![("x-request-id".to_string(), "request-test".to_string())],
        body,
        token_usage_account: None,
        token_usage_service_tier: Some("priority".to_string()),
    }
}

fn interleaved_tools() -> String {
    [
        json!({ "type": "response.output_item.added", "output_index": 0,
            "item": { "id": "item-a", "type": "function_call", "call_id": "call-a", "name": "first" } }),
        json!({ "type": "response.output_item.added", "output_index": 1,
            "item": { "id": "item-b", "type": "function_call", "call_id": "call-b", "name": "second" } }),
        json!({ "type": "response.function_call_arguments.delta", "item_id": "item-a", "delta": "{\"a\":" }),
        json!({ "type": "response.function_call_arguments.delta", "output_index": 1, "delta": "{\"b\":2}" }),
        json!({ "type": "response.function_call_arguments.delta", "item_id": "item-a", "delta": "1}" }),
        json!({ "type": "response.function_call_arguments.done", "item_id": "item-b", "arguments": "{\"b\":2}" }),
        json!({ "type": "response.function_call_arguments.done", "output_index": 0, "arguments": "{\"a\":1}" }),
        complete(),
    ].into_iter().map(frame).collect()
}

#[test]
fn interleaved_tools_keep_their_own_argument_blocks_in_both_modes() {
    let source = interleaved_tools();
    let message = collect_message(source.as_bytes(), "claude-test").expect("tool message");
    assert_eq!(message["content"][0]["id"], "call-a");
    assert_eq!(message["content"][0]["input"], json!({ "a": 1 }));
    assert_eq!(message["content"][1]["input"], json!({ "b": 2 }));
    assert_eq!(message["stop_reason"], "tool_use");
    let values = stream_values(&source);
    let mut arguments = [String::new(), String::new()];
    for event in values
        .iter()
        .filter(|event| event["type"] == "content_block_delta")
    {
        let index = event["index"].as_u64().expect("index") as usize;
        arguments[index].push_str(event["delta"]["partial_json"].as_str().expect("arguments"));
    }
    assert_eq!(arguments, ["{\"a\":1}", "{\"b\":2}"]);
    assert_eq!(
        values
            .iter()
            .filter(|event| event["type"] == "content_block_stop")
            .count(),
        2
    );
}

#[test]
fn crlf_multiline_data_and_event_name_without_payload_type_are_supported() {
    let source = concat!(
        ": keep alive\r\n\r\n",
        "event: response.output_text.delta\r\n",
        "data: {\"delta\": \"你好\",\r\n",
        "data: \"item_id\": \"message-1\", \"output_index\": 0}\r\n\r\n",
        "event: response.completed\r\n",
        "data: {\"response\": {\"status\": \"completed\"}}\r\n\r\n"
    );
    let message = collect_message(source.as_bytes(), "claude-test").expect("CRLF message");
    assert_eq!(message["content"][0]["text"], "你好");
    let values = stream_values(source);
    assert!(values.iter().any(|event| event["delta"]["text"] == "你好"));
    assert_eq!(values.last().expect("terminal")["type"], "message_stop");
}

#[test]
fn failures_unknown_incomplete_and_unterminated_streams_never_emit_success() {
    let endings = [
        frame(
            json!({ "type": "response.failed", "response": { "error": { "message": "private detail" } } }),
        ),
        frame(json!({ "type": "error", "error": { "message": "private detail" } })),
        frame(
            json!({ "type": "response.incomplete", "response": { "incomplete_details": { "reason": "content_filter" } } }),
        ),
        String::new(),
        "data: [DONE]\n\n".to_string(),
        "data: {invalid}\n\n".to_string(),
        frame(complete()).trim_end().to_string(),
    ];
    for ending in endings {
        let source = frame(text_delta("partial")) + &ending;
        assert!(
            collect_message(source.as_bytes(), "claude-test").is_err(),
            "{source}"
        );
        let values = stream_values(&source);
        assert!(
            values.iter().any(|event| event["type"] == "error"),
            "{source}"
        );
        assert!(
            !values.iter().any(|event| event["type"] == "message_stop"),
            "{source}"
        );
        assert!(
            !values.iter().any(|event| event["type"] == "message_delta"),
            "{source}"
        );
        assert!(!serde_json::to_string(&values)
            .expect("events")
            .contains("private detail"));
    }
}

#[test]
fn token_limit_reports_max_tokens_and_preserves_usage() {
    let terminal = json!({ "type": "response.incomplete", "response": {
        "status": "incomplete", "incomplete_details": { "reason": "max_output_tokens" },
        "usage": { "input_tokens": 4, "output_tokens": 2 }, "service_tier": "priority"
    } });
    let source = frame(text_delta("partial")) + &frame(terminal);
    let message = collect_message(source.as_bytes(), "claude-test").expect("limited text");
    assert_eq!(message["stop_reason"], "max_tokens");
    assert_eq!(message["usage"]["output_tokens"], 2);
    assert_eq!(message["service_tier"], "priority");
    let values = stream_values(&source);
    assert!(values
        .iter()
        .any(|event| event["delta"]["stop_reason"] == "max_tokens"));
    assert!(!values
        .iter()
        .any(|event| event["delta"]["stop_reason"] == "end_turn"));
}

#[test]
fn incomplete_tool_arguments_and_conflicting_identifiers_are_errors() {
    for arguments in [
        json!({ "type": "response.function_call_arguments.delta", "item_id": "item-a", "delta": "{\"q\":" }),
        json!({ "type": "response.function_call_arguments.delta", "item_id": "item-a", "output_index": 1, "delta": "{}" }),
    ] {
        let source = frame(
            json!({ "type": "response.output_item.added", "output_index": 0,
                "item": { "id": "item-a", "type": "function_call", "call_id": "call-a", "name": "search" }
            }),
        ) + &frame(arguments)
            + &frame(complete());
        assert!(collect_message(source.as_bytes(), "claude-test").is_err());
        assert!(stream_values(&source)
            .iter()
            .any(|event| event["type"] == "error"));
    }
}

#[test]
fn final_snapshots_supply_missing_deltas_without_duplicating_existing_content() {
    let response = json!({ "type": "response.completed", "response": {
        "status": "completed", "output": [
            { "id": "message-1", "type": "message", "content": [{ "type": "output_text", "text": "hello" }] },
            { "id": "tool-1", "type": "function_call", "call_id": "call-1", "name": "search", "arguments": "{}" }
        ]
    } });
    let source = frame(text_delta("hel")) + &frame(response);
    let values = stream_values(&source);
    let text = values
        .iter()
        .filter_map(|value| value["delta"]["text"].as_str())
        .collect::<String>();
    assert_eq!(text, "hello");
    let message = collect_message(source.as_bytes(), "claude-test").expect("snapshot message");
    assert_eq!(message["content"][0]["text"], "hello");
    assert_eq!(message["content"][1]["input"], json!({}));
}

fn standard_text_and_tool_terminal_sequence() -> String {
    let message = json!({
        "id": "message-1", "type": "message", "status": "completed", "role": "assistant",
        "content": [{ "type": "output_text", "text": "hello", "annotations": [] }]
    });
    let tool = json!({
        "id": "tool-1", "type": "function_call", "status": "completed", "call_id": "call-1",
        "name": "search", "arguments": "{\"a\":1,\"b\":2}"
    });
    let events = [
        json!({ "type": "response.created", "response": { "id": "response-1", "status": "in_progress" } }),
        json!({ "type": "response.output_item.added", "output_index": 0,
            "item": { "id": "message-1", "type": "message", "content": [] } }),
        text_delta("hel"),
        json!({ "type": "response.output_item.added", "output_index": 1,
            "item": { "id": "tool-1", "type": "function_call", "call_id": "call-1",
                "name": "search", "arguments": "" } }),
        json!({ "type": "response.function_call_arguments.delta", "item_id": "tool-1",
            "output_index": 1, "delta": "{\"b\":2," }),
        text_delta("lo"),
        json!({ "type": "response.function_call_arguments.delta", "item_id": "tool-1",
            "output_index": 1, "delta": "\"a\":1}" }),
        json!({ "type": "response.output_text.done", "item_id": "message-1",
            "output_index": 0, "content_index": 0, "text": "hello" }),
        json!({ "type": "response.content_part.done", "item_id": "message-1",
            "output_index": 0, "content_index": 0, "part": { "type": "output_text", "text": "hello" } }),
        json!({ "type": "response.output_item.done", "output_index": 0, "item": message }),
        json!({ "type": "response.function_call_arguments.done", "item_id": "tool-1",
            "output_index": 1, "arguments": "{ \"a\": 1, \"b\": 2 }" }),
        json!({ "type": "response.output_item.done", "output_index": 1, "item": tool }),
        json!({ "type": "response.completed", "response": {
            "id": "response-1", "status": "completed", "output": [message, tool]
        } }),
    ];
    events.into_iter().map(frame).collect()
}

#[test]
fn standard_terminal_sequence_deduplicates_done_events_and_completed_snapshots() {
    let source = standard_text_and_tool_terminal_sequence();
    let message =
        collect_message(source.as_bytes(), "claude-test").expect("complete text and tool message");
    assert_eq!(
        message["content"].as_array().expect("content blocks").len(),
        2
    );
    assert_eq!(message["content"][0]["text"], "hello");
    assert_eq!(message["content"][1]["input"], json!({ "a": 1, "b": 2 }));
    assert_eq!(message["stop_reason"], "tool_use");
    let values = stream_values(&source);
    assert!(!values.iter().any(|event| event["type"] == "error"));
    assert_eq!(
        values.last().expect("terminal event")["type"],
        "message_stop"
    );
    for kind in ["content_block_start", "content_block_stop"] {
        assert_eq!(
            values.iter().filter(|event| event["type"] == kind).count(),
            2
        );
    }
    let text = values
        .iter()
        .filter_map(|event| event["delta"]["text"].as_str())
        .collect::<String>();
    let arguments = values
        .iter()
        .filter_map(|event| event["delta"]["partial_json"].as_str())
        .collect::<String>();
    assert_eq!(text, "hello");
    assert_eq!(arguments, "{\"b\":2,\"a\":1}");
}

struct ChannelReader {
    chunks: std::sync::mpsc::Receiver<Vec<u8>>,
    current: io::Cursor<Vec<u8>>,
}

impl Read for ChannelReader {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        let count = self.current.read(target)?;
        if count > 0 {
            return Ok(count);
        }
        self.current = io::Cursor::new(
            self.chunks
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|_| {
                    io::Error::new(io::ErrorKind::TimedOut, "test upstream has not completed")
                })?,
        );
        self.current.read(target)
    }
}

#[test]
fn forwarding_returns_first_text_before_upstream_can_send_completion() {
    let (sender, receiver) = std::sync::mpsc::channel();
    let body = UpstreamBody::Streaming(Box::new(ChannelReader {
        chunks: receiver,
        current: io::Cursor::new(Vec::new()),
    }));
    // No upstream bytes exist yet: constructing the forwarding payload must perform no reads.
    let converted =
        convert_responses_payload(payload(body, "text/event-stream"), true, "claude-test")
            .expect("streaming payload");
    assert_eq!(converted.response_headers[0].1, "request-test");
    assert_eq!(
        converted.token_usage_service_tier.as_deref(),
        Some("priority")
    );
    let UpstreamBody::Streaming(mut reader) = converted.body else {
        panic!("buffered response");
    };
    sender
        .send(frame(text_delta("first chunk")).into_bytes())
        .expect("initial bytes");
    let mut buffer = [0_u8; 4096];
    let count = reader
        .read(&mut buffer)
        .expect("first text without completion");
    let first = std::str::from_utf8(&buffer[..count]).expect("SSE text");
    assert!(first.contains("first chunk"));
    assert!(!first.contains("message_stop"));
    sender
        .send(frame(complete()).into_bytes())
        .expect("completion bytes");
    let mut remaining = String::new();
    reader
        .read_to_string(&mut remaining)
        .expect("remaining stream");
    assert!(remaining.contains("message_stop"));
}

#[test]
fn json_upstream_readers_convert_in_both_response_modes() {
    let response = json!({ "id": "resp_json", "status": "completed", "output": [
        { "type": "message", "content": [{ "type": "output_text", "text": "JSON answer" }] }
    ] });
    for streaming in [false, true] {
        let body =
            UpstreamBody::Streaming(Box::new(io::Cursor::new(response.to_string().into_bytes())));
        let converted =
            convert_responses_payload(payload(body, "application/json"), streaming, "claude-test")
                .expect("converted JSON response");
        let UpstreamBody::Buffered(body) = converted.body else {
            panic!("JSON response was not buffered");
        };
        let text = String::from_utf8(body).expect("JSON/SSE");
        assert!(text.contains("JSON answer"));
        assert_eq!(text.contains("message_stop"), streaming);
        assert!(!text.contains("api_error"));
    }
}

#[test]
fn upstream_read_failure_emits_an_error_without_completion() {
    let (sender, receiver) = std::sync::mpsc::channel();
    sender
        .send(frame(text_delta("partial")).into_bytes())
        .expect("initial data");
    drop(sender);
    let input = ChannelReader {
        chunks: receiver,
        current: io::Cursor::new(Vec::new()),
    };
    let mut reader = AnthropicSseReader::new(BufReader::new(input), "claude-test");
    let mut text = String::new();
    reader.read_to_string(&mut text).expect("in-band error");
    assert!(text.contains("event: error"));
    assert!(!text.contains("message_stop"));
}
