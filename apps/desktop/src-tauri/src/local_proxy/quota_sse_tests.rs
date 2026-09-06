use super::*;
use crate::local_proxy::{
    is_official_quota_exhaustion, retry_upstream_request_with, TokenUsageAccount,
    UpstreamQuotaEvent,
};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

struct FragmentedReader {
    chunks: VecDeque<Cursor<Vec<u8>>>,
}

impl FragmentedReader {
    fn new(bytes: &[u8], chunk_size: usize) -> Self {
        Self {
            chunks: bytes
                .chunks(chunk_size)
                .map(|chunk| Cursor::new(chunk.to_vec()))
                .collect(),
        }
    }
}

impl Read for FragmentedReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        while let Some(chunk) = self.chunks.front_mut() {
            let read = chunk.read(buffer)?;
            if read > 0 {
                return Ok(read);
            }
            self.chunks.pop_front();
        }
        Ok(0)
    }
}

struct FirstEventOnlyReader {
    event: Cursor<Vec<u8>>,
    reads: Arc<AtomicUsize>,
}

impl Read for FirstEventOnlyReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        assert_eq!(
            self.reads.fetch_add(1, Ordering::SeqCst),
            0,
            "read beyond the first substantive event"
        );
        self.event.read(buffer)
    }
}

fn sse_payload(reader: impl Read + Send + 'static) -> UpstreamPayload {
    UpstreamPayload {
        status: 200,
        content_type: Some("text/event-stream; charset=utf-8".to_string()),
        response_headers: vec![("etag".to_string(), "test".to_string())],
        body: UpstreamBody::Streaming(Box::new(reader)),
        token_usage_service_tier: None,
        token_usage_account: Some(TokenUsageAccount {
            account_id: "exhausted".to_string(),
            account_email: String::new(),
            active_account_generation: 1,
            auto_switch_attempt_generation: 2,
            auto_switch_eligible: true,
            concurrent_request_started_at: None,
        }),
    }
}

fn response_bytes(payload: UpstreamPayload) -> Vec<u8> {
    match payload.body {
        UpstreamBody::Buffered(bytes) => bytes,
        UpstreamBody::Streaming(mut reader) => {
            let mut bytes = Vec::new();
            reader.read_to_end(&mut bytes).unwrap();
            bytes
        }
    }
}

fn failed_quota_event() -> String {
    format!(
        "event: response.failed\ndata: {}\n\n",
        json!({
            "type": "response.failed",
            "response": { "output": [], "error": { "code": "insufficient_quota" } }
        })
    )
}

fn created_event() -> &'static str {
    "data: {\"type\":\"response.created\",\"response\":{\"id\":\"response\",\"output\":[]}}\n\n"
}

#[test]
fn fragmented_initial_quota_failure_becomes_a_buffered_429() {
    let stream = format!("{}{}", created_event(), failed_quota_event()).replace('\n', "\r\n");
    for chunk_size in [1, 3, 17, READ_BUFFER_BYTES] {
        let payload = inspect_initial_official_sse(sse_payload(FragmentedReader::new(
            stream.as_bytes(),
            chunk_size,
        )))
        .unwrap();
        assert_eq!(payload.status, 429);
        assert_eq!(payload.content_type.as_deref(), Some("application/json"));
        assert_eq!(
            payload.token_usage_account.as_ref().unwrap().account_id,
            "exhausted"
        );
        assert!(is_official_quota_exhaustion(&payload));
        assert_eq!(
            serde_json::from_slice::<Value>(&response_bytes(payload)).unwrap(),
            json!({ "error": { "code": "insufficient_quota" } })
        );
    }
}

#[test]
fn explicit_initial_error_events_support_nested_and_flat_quota_codes() {
    for event in [
        json!({ "type": "error", "error": { "type": "usage_limit_reached" } }),
        json!({ "type": "error", "code": "insufficient_quota" }),
    ] {
        let stream = format!("event: error\ndata: {event}\n\n");
        let payload =
            inspect_initial_official_sse(sse_payload(Cursor::new(stream.into_bytes()))).unwrap();
        assert!(is_official_quota_exhaustion(&payload));
    }
}

#[test]
fn normal_stream_preserves_crlf_comments_multiline_data_and_all_remaining_bytes() {
    let stream = concat!(
        ": connected\r\n\r\n",
        "event: response.created\r\ndata: {\"type\": \"response.created\",\r\n",
        "data: \"response\": {\"output\": []}}\r\n\r\n",
        "id: 2\r\nevent: response.output_text.delta\r\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"你好\"}\r\n\r\n",
        "data: {\"type\":\"response.completed\"}\r\n\r\n",
    );
    for chunk_size in [1, 11, READ_BUFFER_BYTES] {
        let payload = inspect_initial_official_sse(sse_payload(FragmentedReader::new(
            stream.as_bytes(),
            chunk_size,
        )))
        .unwrap();
        assert_eq!(payload.status, 200);
        assert_eq!(response_bytes(payload), stream.as_bytes());
    }
}

#[test]
fn quota_after_text_or_tool_output_is_forwarded_without_retry() {
    for kind in [
        "response.output_text.delta",
        "response.output_item.added",
        "response.function_call_arguments.delta",
    ] {
        let stream = format!(
            "{}data: {}\n\n{}",
            created_event(),
            json!({ "type": kind }),
            failed_quota_event(),
        );
        let mut requests = 0;
        let payload = retry_upstream_request_with(
            Duration::ZERO,
            || {
                requests += 1;
                inspect_initial_official_sse(sse_payload(Cursor::new(stream.as_bytes().to_vec())))
            },
            |_, _| panic!("An active stream must not trigger automatic replay"),
            |_| panic!("An active stream must not retry"),
        )
        .unwrap();
        assert_eq!(requests, 1);
        assert_eq!(payload.status, 200);
        assert_eq!(response_bytes(payload), stream.as_bytes());
    }
}

#[test]
fn first_substantive_event_stops_reading_before_the_rest_of_the_response() {
    for event in [
        json!({ "type": "response.output_text.delta", "delta": "hello" }),
        json!({ "type": "response.output_item.added", "item": { "type": "function_call" } }),
        json!({ "type": "unknown.event" }),
    ] {
        let reads = Arc::new(AtomicUsize::new(0));
        let reader = FirstEventOnlyReader {
            event: Cursor::new(format!("data: {event}\n\n").into_bytes()),
            reads: Arc::clone(&reads),
        };
        let payload = inspect_initial_official_sse(sse_payload(reader)).unwrap();
        assert_eq!(payload.status, 200);
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn failed_event_containing_output_is_not_replayed() {
    let stream = format!(
        "data: {}\n\n",
        json!({
            "type": "response.failed",
            "response": {
                "output": [{ "type": "function_call", "name": "run" }],
                "error": { "code": "insufficient_quota" }
            }
        })
    );
    let payload =
        inspect_initial_official_sse(sse_payload(Cursor::new(stream.as_bytes().to_vec()))).unwrap();
    assert_eq!(payload.status, 200);
    assert_eq!(response_bytes(payload), stream.as_bytes());
}

#[test]
fn transient_limits_and_malformed_events_are_preserved() {
    for event in [
        "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"rate_limit_exceeded\"}}}\n\n",
        "data: {\"type\":\"error\",\"message\":\"insufficient_quota\"}\n\n",
        "data: invalid json\n\n",
        "data: [DONE]\n\n",
    ] {
        let payload = inspect_initial_official_sse(sse_payload(Cursor::new(event.as_bytes().to_vec()))).unwrap();
        assert_eq!(payload.status, 200);
        assert_eq!(response_bytes(payload), event.as_bytes());
    }
}

#[test]
fn opening_event_limit_preserves_later_quota_events() {
    let stream = format!(
        "{}{}",
        created_event().repeat(MAX_OPENING_EVENTS),
        failed_quota_event()
    );
    let payload =
        inspect_initial_official_sse(sse_payload(Cursor::new(stream.as_bytes().to_vec()))).unwrap();
    assert_eq!(payload.status, 200);
    assert_eq!(response_bytes(payload), stream.as_bytes());
}

#[test]
fn opening_byte_limit_bounds_reads_and_preserves_the_entire_stream() {
    let stream = format!(
        ": {}\n\n{}",
        "x".repeat(MAX_OPENING_BYTES),
        failed_quota_event()
    );
    let mut reader = Cursor::new(stream.as_bytes());
    let mut probe = OpeningProbe::default();
    assert!(probe.inspect(&mut reader).unwrap().is_none());
    assert_eq!(reader.position(), MAX_OPENING_BYTES as u64);
    let payload =
        inspect_initial_official_sse(sse_payload(Cursor::new(stream.as_bytes().to_vec()))).unwrap();
    assert_eq!(payload.status, 200);
    assert_eq!(response_bytes(payload), stream.as_bytes());
}

#[test]
fn initial_sse_quota_failure_switches_and_retries_through_the_existing_loop() {
    let mut requests = 0;
    let mut switches = 0;
    let payload = retry_upstream_request_with(
        Duration::ZERO,
        || {
            requests += 1;
            let stream = if requests == 1 {
                failed_quota_event()
            } else {
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n".to_string()
            };
            inspect_initial_official_sse(sse_payload(Cursor::new(stream.into_bytes())))
        },
        |_, event| {
            assert!(matches!(event, UpstreamQuotaEvent::Retry { .. }));
            switches += 1;
            true
        },
        |_| panic!("Confirmed opening quota failure must switch before backoff"),
    )
    .unwrap();
    assert_eq!(payload.status, 200);
    assert_eq!(requests, 2);
    assert_eq!(switches, 1);
    assert!(String::from_utf8(response_bytes(payload))
        .unwrap()
        .contains("ok"));
}
