use serde_json::Value;

const MAX_CAPTURE_BYTES: usize = 64 * 1024;
const MAX_ERROR_MESSAGE_CHARS: usize = 1000;
const GENERIC_UPSTREAM_ERROR: &str = "The upstream service returned an error.";
const INTERRUPTED_STREAM_ERROR: &str = "The upstream response ended before it was complete.";

/// A structured failure found in bytes already read from the upstream response.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct ProxyCapturedError {
    pub(super) message: String,
    pub(super) status_code: Option<u16>,
}

/// Observes response bytes without consuming the transport or retaining normal conversation text.
pub(super) struct ErrorCapture {
    event_stream: bool,
    http_status: u16,
    buffer: Vec<u8>,
    line_length: usize,
    last_byte: Option<u8>,
    reported: bool,
    terminal: bool,
    finished: bool,
}

impl ErrorCapture {
    pub(super) fn new(event_stream: bool, http_status: u16) -> Self {
        Self {
            event_stream,
            http_status,
            buffer: Vec::new(),
            line_length: 0,
            last_byte: None,
            reported: false,
            terminal: false,
            finished: false,
        }
    }

    pub(super) fn terminal_seen(&self) -> bool {
        self.terminal
    }

    pub(super) fn error_seen(&self) -> bool {
        self.reported
    }

    /// Returns at most one failure for this response, including across subsequent calls.
    pub(super) fn observe(&mut self, bytes: &[u8]) -> Vec<ProxyCapturedError> {
        let mut errors = Vec::new();
        if self.finished || self.reported {
            return errors;
        }
        if !self.event_stream {
            let remaining = MAX_CAPTURE_BYTES.saturating_sub(self.buffer.len());
            self.buffer
                .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
            return errors;
        }
        for &byte in bytes {
            if byte == b'\n' {
                self.finish_line(&mut errors);
            } else {
                self.line_length = self.line_length.saturating_add(1);
                self.last_byte = Some(byte);
                self.push_byte(byte);
            }
            if self.reported {
                break;
            }
        }
        errors
    }

    /// Call at upstream EOF or a read failure, rather than after an intentional client cancellation.
    pub(super) fn finish(&mut self) -> Vec<ProxyCapturedError> {
        let mut errors = Vec::new();
        if self.finished || self.reported {
            return errors;
        }
        self.finished = true;
        if self.event_stream {
            self.finish_event(&mut errors);
            if !self.reported && (self.http_status >= 400 || !self.terminal) {
                let message = if self.http_status >= 400 {
                    http_error_message(self.http_status)
                } else {
                    INTERRUPTED_STREAM_ERROR.to_string()
                };
                self.report(message, None, &mut errors);
            }
        } else {
            self.finish_json(&mut errors);
        }
        self.buffer.clear();
        errors
    }

    fn finish_json(&mut self, errors: &mut Vec<ProxyCapturedError>) {
        let value = serde_json::from_slice::<Value>(&self.buffer).ok();
        let message = if self.http_status >= 400 {
            Some(
                value
                    .as_ref()
                    .and_then(structured_error_message)
                    .unwrap_or_else(|| http_error_message(self.http_status)),
            )
        } else {
            value
                .as_ref()
                .and_then(|value| sse_error_message(json_event_type(value), Some(value)))
        };
        if let Some(message) = message {
            self.report(
                message,
                value.as_ref().and_then(structured_error_status),
                errors,
            );
        }
    }

    fn push_byte(&mut self, byte: u8) {
        if self.buffer.len() < MAX_CAPTURE_BYTES {
            self.buffer.push(byte);
        }
    }

    fn finish_line(&mut self, errors: &mut Vec<ProxyCapturedError>) {
        let blank =
            self.line_length == 0 || (self.line_length == 1 && self.last_byte == Some(b'\r'));
        if blank {
            self.finish_event(errors);
        } else {
            self.push_byte(b'\n');
        }
        self.line_length = 0;
        self.last_byte = None;
    }

    fn finish_event(&mut self, errors: &mut Vec<ProxyCapturedError>) {
        if self.buffer.is_empty() || self.reported {
            return;
        }
        let block = String::from_utf8_lossy(&self.buffer);
        let event = sse_event_name(&block);
        let data = sse_event_data(&block);
        let value = serde_json::from_str::<Value>(&data).ok();
        let payload_type = value
            .as_ref()
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
            .unwrap_or(event);
        let event_type = if matches!(event, "error" | "response.failed" | "response.incomplete") {
            event
        } else {
            payload_type
        };
        let terminal = data.trim() == "[DONE]"
            || is_terminal_event(event)
            || is_terminal_event(event_type)
            || value.as_ref().is_some_and(chat_completion_finished);
        let failure = sse_error_message(event_type, value.as_ref());
        let status = value.as_ref().and_then(structured_error_status);
        self.terminal |= terminal;
        self.buffer.clear();
        if let Some(message) = failure {
            self.report(message, status, errors);
        }
    }

    fn report(
        &mut self,
        message: String,
        status: Option<u16>,
        errors: &mut Vec<ProxyCapturedError>,
    ) {
        self.reported = true;
        self.buffer.clear();
        errors.push(ProxyCapturedError {
            message: message.chars().take(MAX_ERROR_MESSAGE_CHARS).collect(),
            status_code: (self.http_status >= 400)
                .then_some(self.http_status)
                .or(status),
        });
    }
}

fn sse_event_name(block: &str) -> &str {
    block
        .lines()
        .filter_map(|line| line.strip_prefix("event:"))
        .map(str::trim)
        .next()
        .unwrap_or_default()
}

fn sse_event_data(block: &str) -> String {
    block
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_terminal_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "response.completed"
            | "message_stop"
            | "image_generation.completed"
            | "image_edit.completed"
    )
}

fn chat_completion_finished(value: &Value) -> bool {
    value
        .get("choices")
        .and_then(Value::as_array)
        .is_some_and(|choices| {
            choices.iter().any(|choice| {
                choice
                    .get("finish_reason")
                    .is_some_and(|reason| !reason.is_null())
            })
        })
}

fn json_event_type(value: &Value) -> &str {
    value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_else(|| match value.get("status").and_then(Value::as_str) {
            Some("failed") => "response.failed",
            Some("incomplete") => "response.incomplete",
            _ => "",
        })
}

fn sse_error_message(event_type: &str, value: Option<&Value>) -> Option<String> {
    if event_type == "response.incomplete" {
        let reason = value.and_then(|value| {
            [
                "/response/incomplete_details/reason",
                "/incomplete_details/reason",
            ]
            .iter()
            .find_map(|path| value.pointer(path).and_then(nonempty_string))
        });
        return Some(match reason {
            Some(reason) => format!("The upstream response was incomplete: {reason}"),
            None => "The upstream response was incomplete.".to_string(),
        });
    }
    let explicit_error = value.is_some_and(|value| {
        ["/error", "/response/error"].iter().any(|path| {
            value
                .pointer(path)
                .is_some_and(|error| error.is_object() || nonempty_string(error).is_some())
        })
    });
    if !matches!(event_type, "error" | "response.failed") && !explicit_error {
        return None;
    }
    Some(
        value
            .and_then(structured_error_message)
            .unwrap_or_else(|| GENERIC_UPSTREAM_ERROR.to_string()),
    )
}

fn structured_error_message(value: &Value) -> Option<String> {
    [
        "/error/message",
        "/error/detail",
        "/error",
        "/response/error/message",
        "/response/error/detail",
        "/response/error",
        "/detail",
        "/message",
    ]
    .iter()
    .find_map(|path| {
        value
            .pointer(path)
            .and_then(nonempty_string)
            .map(str::to_string)
    })
}

fn structured_error_status(value: &Value) -> Option<u16> {
    [
        "/error/status_code",
        "/error/status",
        "/response/error/status_code",
        "/response/error/status",
        "/status_code",
        "/status",
    ]
    .iter()
    .find_map(|path| {
        value
            .pointer(path)
            .and_then(Value::as_u64)
            .and_then(|status| u16::try_from(status).ok())
            .filter(|status| (400..600).contains(status))
    })
}

fn nonempty_string(value: &Value) -> Option<&str> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn http_error_message(status: u16) -> String {
    format!("The upstream service returned HTTP {status}.")
}

#[cfg(test)]
#[path = "error_capture_tests.rs"]
mod tests;
