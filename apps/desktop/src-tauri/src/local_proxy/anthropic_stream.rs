//! Incremental Responses-to-Messages conversion, shared by both downstream response modes.

use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Read};

#[path = "anthropic_stream_blocks.rs"]
mod blocks;
#[path = "anthropic_stream_state.rs"]
mod state;
use state::MessageState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ConversionError {
    UnexpectedEnd,
    UpstreamFailed,
    Incomplete,
    InvalidEvent,
    InvalidTool,
    ReadFailed,
}

impl std::fmt::Display for ConversionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnexpectedEnd => "The response ended before it was complete. Please try again.",
            Self::UpstreamFailed => {
                "The service could not complete the response. Please try again."
            }
            Self::Incomplete => "The service returned an incomplete response. Please try again.",
            Self::InvalidEvent => "The service returned an invalid response. Please try again.",
            Self::InvalidTool => "The service returned an incomplete tool call. Please try again.",
            Self::ReadFailed => "The connection was interrupted. Please try again.",
        })
    }
}

impl std::error::Error for ConversionError {}

/// Dispatches only complete SSE frames; EOF is never an implicit successful terminal event.
struct EventReader<R> {
    upstream: R,
}

impl<R: BufRead> EventReader<R> {
    fn next(&mut self) -> Result<Option<Value>, ConversionError> {
        let mut data = Vec::new();
        let mut event = None;
        loop {
            let mut line = String::new();
            if self
                .upstream
                .read_line(&mut line)
                .map_err(|_| ConversionError::ReadFailed)?
                == 0
            {
                return if data.is_empty() {
                    Ok(None)
                } else {
                    Err(ConversionError::UnexpectedEnd)
                };
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() && !data.is_empty() {
                return decode_event(&data.join("\n"), event.as_deref()).map(Some);
            }
            if line.is_empty() {
                event = None;
            } else if let Some(value) = line.strip_prefix("data:") {
                data.push(value.strip_prefix(' ').unwrap_or(value).to_string());
            } else if let Some(value) = line.strip_prefix("event:") {
                event = Some(value.trim().to_string());
            }
        }
    }
}

fn decode_event(data: &str, event: Option<&str>) -> Result<Value, ConversionError> {
    if data.trim() == "[DONE]" {
        return Err(ConversionError::UnexpectedEnd);
    }
    let mut value: Value = serde_json::from_str(data).map_err(|_| ConversionError::InvalidEvent)?;
    let payload_type = value.get("type").and_then(Value::as_str);
    if event
        .zip(payload_type)
        .is_some_and(|(event, kind)| event != kind)
    {
        return Err(ConversionError::InvalidEvent);
    }
    if payload_type.is_none() {
        let object = value.as_object_mut().ok_or(ConversionError::InvalidEvent)?;
        object.insert(
            "type".to_string(),
            json!(event.ok_or(ConversionError::InvalidEvent)?),
        );
    }
    Ok(value)
}

pub(super) struct AnthropicSseReader<R> {
    events: EventReader<R>,
    state: MessageState,
    pending: io::Cursor<Vec<u8>>,
}

impl<R: BufRead> AnthropicSseReader<R> {
    pub(super) fn new(upstream: R, model: &str) -> Self {
        Self {
            events: EventReader { upstream },
            state: MessageState::new(model),
            pending: io::Cursor::new(Vec::new()),
        }
    }

    fn next_output(&mut self) -> Vec<Value> {
        match self.events.next() {
            Ok(Some(value)) => match self.state.observe(&value) {
                Ok(events) => events,
                Err(error) => self.state.fail(error),
            },
            Ok(None) => self.state.fail(ConversionError::UnexpectedEnd),
            Err(error) => self.state.fail(error),
        }
    }
}

impl<R: BufRead> Read for AnthropicSseReader<R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() {
            return Ok(0);
        }
        loop {
            let count = self.pending.read(target)?;
            if count > 0 || self.state.finished() {
                return Ok(count);
            }
            self.pending = io::Cursor::new(encode_events(self.next_output()));
        }
    }
}

pub(super) fn collect_message(upstream: impl Read, model: &str) -> Result<Value, ConversionError> {
    let mut events = EventReader {
        upstream: BufReader::new(upstream),
    };
    let mut state = MessageState::new(model);
    while !state.finished() {
        let value = events.next()?.ok_or(ConversionError::UnexpectedEnd)?;
        state.observe(&value)?;
    }
    Ok(state.message())
}

pub(super) fn convert_response(response: &Value, model: &str) -> Result<Value, ConversionError> {
    let mut state = MessageState::new(model);
    state.observe(&response_event(response))?;
    Ok(state.message())
}

pub(super) fn response_sse(response: &Value, model: &str) -> Vec<u8> {
    let mut state = MessageState::new(model);
    let events = match state.observe(&response_event(response)) {
        Ok(events) => events,
        Err(error) => state.fail(error),
    };
    encode_events(events)
}

fn response_event(response: &Value) -> Value {
    let kind = match response.get("status").and_then(Value::as_str) {
        Some("completed") => "response.completed",
        Some("incomplete") => "response.incomplete",
        Some("failed" | "cancelled") => "response.failed",
        _ => "error",
    };
    json!({ "type": kind, "response": response })
}

fn encode_events(events: Vec<Value>) -> Vec<u8> {
    let mut output = String::new();
    for value in events {
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("error")
            .to_string();
        super::push_sse(&mut output, &kind, value);
    }
    output.into_bytes()
}

#[cfg(test)]
#[path = "anthropic_stream_tests.rs"]
mod tests;
