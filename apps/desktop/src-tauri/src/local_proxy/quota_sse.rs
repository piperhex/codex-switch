//! Recover explicit quota failures before any response output can reach the client.
//! Inspect only a bounded opening prefix; replaying an active stream can duplicate tool calls.

use super::{is_event_stream, quota_detection::is_explicit_quota_error, status_ok};
use super::{UpstreamBody, UpstreamPayload};
use serde_json::{json, Value};
use std::io::{self, Cursor, Read};

const MAX_OPENING_BYTES: usize = 64 * 1024;
const MAX_OPENING_EVENTS: usize = 8;
const READ_BUFFER_BYTES: usize = 4096;

#[derive(Default)]
struct OpeningProbe {
    prefix: Vec<u8>,
    event_start: usize,
    inspected_events: usize,
}

enum EventOutcome {
    Opening,
    Forward,
    Quota(Value),
}

pub(super) fn inspect_initial_official_sse(
    mut payload: UpstreamPayload,
) -> Result<UpstreamPayload, String> {
    if !status_ok(payload.status) || !is_event_stream(payload.content_type.as_deref()) {
        return Ok(payload);
    }
    let UpstreamBody::Streaming(reader) = &mut payload.body else {
        return Ok(payload);
    };
    let mut probe = OpeningProbe::default();
    let quota_error = probe
        .inspect(reader.as_mut())
        .map_err(|error| format!("Failed to read initial official response: {error}"))?;
    if let Some(error) = quota_error {
        payload.status = 429;
        payload.content_type = Some("application/json".to_string());
        payload.body = UpstreamBody::Buffered(json!({ "error": error }).to_string().into_bytes());
        return Ok(payload);
    }
    if let UpstreamBody::Streaming(reader) = payload.body {
        payload.body = UpstreamBody::Streaming(Box::new(Cursor::new(probe.prefix).chain(reader)));
    }
    Ok(payload)
}

impl OpeningProbe {
    fn inspect(&mut self, reader: &mut dyn Read) -> io::Result<Option<Value>> {
        let mut buffer = [0_u8; READ_BUFFER_BYTES];
        while self.prefix.len() < MAX_OPENING_BYTES {
            let read_limit = buffer.len().min(MAX_OPENING_BYTES - self.prefix.len());
            let read = reader.read(&mut buffer[..read_limit])?;
            if read == 0 {
                return Ok(None);
            }
            self.prefix.extend_from_slice(&buffer[..read]);
            match self.inspect_complete_events() {
                EventOutcome::Quota(error) => return Ok(Some(error)),
                EventOutcome::Forward => return Ok(None),
                EventOutcome::Opening => {}
            }
        }
        Ok(None)
    }

    fn inspect_complete_events(&mut self) -> EventOutcome {
        while let Some(event_end) = next_event_end(&self.prefix, self.event_start) {
            self.inspected_events += 1;
            let event = inspect_event(&self.prefix[self.event_start..event_end]);
            self.event_start = event_end;
            if !matches!(event, EventOutcome::Opening) {
                return event;
            }
            if self.inspected_events >= MAX_OPENING_EVENTS {
                return EventOutcome::Forward;
            }
        }
        EventOutcome::Opening
    }
}

fn next_event_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut line_start = start;
    for (index, byte) in bytes.iter().enumerate().skip(start) {
        if *byte != b'\n' {
            continue;
        }
        let line = &bytes[line_start..index];
        if line.is_empty() || line == b"\r" {
            return Some(index + 1);
        }
        line_start = index + 1;
    }
    None
}

fn inspect_event(bytes: &[u8]) -> EventOutcome {
    let Ok(event) = std::str::from_utf8(bytes) else {
        return EventOutcome::Forward;
    };
    let mut data = String::new();
    let mut event_type = None;
    for line in event.lines() {
        if let Some(value) = line.strip_prefix("data:") {
            data.push_str(value.strip_prefix(' ').unwrap_or(value));
            data.push('\n');
        } else if let Some(value) = line.strip_prefix("event:") {
            event_type = Some(value.trim());
        }
    }
    if data.is_empty() {
        return EventOutcome::Opening;
    }
    let Ok(value) = serde_json::from_str::<Value>(&data) else {
        return EventOutcome::Forward;
    };
    classify_event(&value, event_type)
}

fn classify_event(value: &Value, event_type: Option<&str>) -> EventOutcome {
    let payload_type = value.get("type").and_then(Value::as_str);
    let conflicting_type = event_type
        .zip(payload_type)
        .is_some_and(|(event, payload)| event != payload);
    if conflicting_type || response_contains_output(value) {
        return EventOutcome::Forward;
    }
    let kind = payload_type.or(event_type);
    let error = match kind {
        Some("response.failed") => value.pointer("/response/error"),
        Some("error") => Some(value.get("error").unwrap_or(value)),
        Some(
            "response.created"
            | "response.in_progress"
            | "response.metadata"
            | "codex.response.metadata",
        ) => {
            return EventOutcome::Opening;
        }
        _ => return EventOutcome::Forward,
    };
    match error.filter(|error| is_explicit_quota_error(error)) {
        Some(error) => EventOutcome::Quota(error.clone()),
        None => EventOutcome::Forward,
    }
}

fn response_contains_output(value: &Value) -> bool {
    [value.get("output"), value.pointer("/response/output")]
        .into_iter()
        .flatten()
        .any(|output| !output.is_null() && output.as_array().is_none_or(|items| !items.is_empty()))
}

#[cfg(test)]
#[path = "quota_sse_tests.rs"]
mod tests;
