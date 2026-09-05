const MAX_CONVERSATION_EVENT_BYTES: usize = 32 * 1024 * 1024;
const MAX_CONVERSATION_OUTPUT_ITEMS: usize = 128;

#[derive(Default)]
struct ConversationResponseCapture {
    event_stream: bool,
    buffer: Vec<u8>,
    event: Vec<u8>,
    dropping_event: bool,
    truncated: bool,
    output: BTreeMap<u64, CapturedConversation>,
    completed: Option<CapturedConversation>,
    completed_has_output: bool,
    delta: String,
}

impl ConversationResponseCapture {
    fn observe(&mut self, bytes: &[u8]) {
        if !self.event_stream {
            let remaining = MAX_CONVERSATION_EVENT_BYTES.saturating_sub(self.buffer.len());
            self.buffer
                .extend_from_slice(&bytes[..remaining.min(bytes.len())]);
            self.truncated |= bytes.len() > remaining;
            return;
        }
        for part in bytes.split_inclusive(|byte| *byte == b'\n') {
            if self.buffer.len() + self.event.len() + part.len() > MAX_CONVERSATION_EVENT_BYTES {
                self.dropping_event = true;
                self.truncated = true;
                self.buffer.clear();
                self.event.clear();
            }
            if !self.dropping_event {
                self.buffer.extend_from_slice(part);
            }
            if part.ends_with(b"\n") {
                self.finish_line(part);
            }
        }
    }

    fn finish_line(&mut self, part: &[u8]) {
        if self.dropping_event {
            if part == b"\n" || part == b"\r\n" {
                self.dropping_event = false;
            }
            return;
        }
        let line = std::mem::take(&mut self.buffer);
        let line = line.strip_suffix(b"\n").unwrap_or(&line);
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.is_empty() {
            self.finish_event();
        } else if let Some(data) = line.strip_prefix(b"data:") {
            if !self.event.is_empty() {
                self.event.push(b'\n');
            }
            self.event
                .extend_from_slice(data.strip_prefix(b" ").unwrap_or(data));
        }
    }

    fn finish_event(&mut self) {
        let data = std::mem::take(&mut self.event);
        if let Ok(value) = serde_json::from_slice::<Value>(&data) {
            self.process_event(value);
        }
    }

    fn process_event(&mut self, mut value: Value) {
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match kind {
            "response.completed" | "response.incomplete" | "response.failed" => {
                if let Some(response) = value.get_mut("response") {
                    self.completed_has_output = response
                        .get("output")
                        .and_then(Value::as_array)
                        .is_some_and(|output| !output.is_empty());
                    self.completed = Some(capture_response_value(response.take()));
                }
            }
            "response.output_item.done" => self.capture_output_item(&mut value),
            "response.output_text.delta" => {
                self.append_delta(value.get("delta").and_then(Value::as_str));
            }
            "content_block_delta" => {
                self.append_delta(value.pointer("/delta/text").and_then(Value::as_str));
            }
            "image_generation.completed" | "image_edit.completed" => {
                self.completed_has_output = true;
                self.completed = Some(capture_response_value(value));
            }
            "error" => {
                self.completed = Some(capture_conversation_value(value));
            }
            _ => {
                self.append_delta(
                    value
                        .pointer("/choices/0/delta/content")
                        .and_then(Value::as_str),
                );
            }
        }
    }

    fn capture_output_item(&mut self, value: &mut Value) {
        let index = value
            .get("output_index")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if self.output.len() >= MAX_CONVERSATION_OUTPUT_ITEMS {
            self.truncated = true;
            return;
        }
        if let Some(item) = value.get_mut("item") {
            self.output
                .insert(index, capture_conversation_value(item.take()));
        }
    }

    fn append_delta(&mut self, delta: Option<&str>) {
        let Some(delta) = delta else {
            return;
        };
        let remaining = MAX_CONVERSATION_EVENT_BYTES.saturating_sub(self.delta.len());
        let mut end = remaining.min(delta.len());
        while !delta.is_char_boundary(end) {
            end -= 1;
        }
        self.delta.push_str(&delta[..end]);
        self.truncated |= end < delta.len();
    }

    fn finish(&mut self) -> CapturedConversation {
        if !self.event_stream {
            return serde_json::from_slice(&self.buffer)
                .ok()
                .map(capture_response_value)
                .unwrap_or_default();
        }
        if !self.buffer.is_empty() {
            self.finish_line(b"");
        }
        self.finish_event();
        let completed = self.completed.take();
        if self.completed_has_output {
            return completed.unwrap_or_default();
        }
        let mut result = CapturedConversation::default();
        let mut text = Vec::new();
        for item in std::mem::take(&mut self.output).into_values() {
            if let Some(value) = item.text {
                text.push(value);
            }
            result.attachments.extend(item.attachments);
        }
        if text.is_empty() && !self.delta.is_empty() {
            text.push(std::mem::take(&mut self.delta));
        }
        if let Some(completed) = completed {
            if let Some(value) = completed.text {
                text.push(value);
            }
            result.attachments.extend(completed.attachments);
        }
        if !text.is_empty() {
            result.text = Some(limit_conversation_text(text.join("\n")));
        }
        result.attachments.truncate(MAX_CONVERSATION_ATTACHMENTS);
        result
    }
}

fn capture_response_value(mut value: Value) -> CapturedConversation {
    // Images API URL results have no content-block type. Normalize only its result array.
    if let Some(data) = value.get_mut("data").and_then(Value::as_array_mut) {
        for item in data {
            if let Some(url) = item.get("url").and_then(Value::as_str) {
                *item = json!({ "type": "image_url", "image_url": url });
            }
        }
    }
    capture_conversation_value(value)
}

fn attach_conversation_response_capture(
    mut payload: UpstreamPayload,
    session: Option<&ProxySessionRequestGuard>,
) -> UpstreamPayload {
    let Some(session) = session else {
        return payload;
    };
    let mut capture = ConversationResponseCapture {
        event_stream: is_event_stream(payload.content_type.as_deref())
            || session.expects_event_stream,
        ..Default::default()
    };
    payload.body = match payload.body {
        UpstreamBody::Buffered(body) => {
            if serde_json::from_slice::<Value>(&body).is_ok() {
                capture.event_stream = false;
            }
            capture.observe(&body);
            record_conversation_response(session.session_id(), session.request_id(), &mut capture);
            UpstreamBody::Buffered(body)
        }
        UpstreamBody::Streaming(inner) => {
            UpstreamBody::Streaming(Box::new(ConversationResponseReader {
                inner,
                session_id: session.session_id().to_string(),
                request_id: session.request_id(),
                capture: Some(capture),
            }))
        }
    };
    payload
}

fn record_conversation_response(
    session_id: &str,
    request_id: u64,
    capture: &mut ConversationResponseCapture,
) {
    let response = capture.finish();
    if let Ok(mut sessions) = proxy_sessions().lock() {
        if let Some(request) = sessions.get_mut(session_id).and_then(|session| {
            session
                .requests
                .iter_mut()
                .find(|request| request.id == request_id)
        }) {
            request.response = response.text;
            request.output_attachments = response.attachments;
            request.response_truncated = capture.truncated;
        }
    }
    persist_proxy_session(session_id, Some(request_id));
}

struct ConversationResponseReader {
    inner: Box<dyn Read + Send>,
    session_id: String,
    request_id: u64,
    capture: Option<ConversationResponseCapture>,
}

impl ConversationResponseReader {
    fn finish(&mut self) {
        if let Some(mut capture) = self.capture.take() {
            record_conversation_response(&self.session_id, self.request_id, &mut capture);
        }
    }
}

impl Read for ConversationResponseReader {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() {
            return Ok(0);
        }
        match self.inner.read(target) {
            Ok(0) => {
                self.finish();
                Ok(0)
            }
            Ok(count) => {
                if let Some(capture) = self.capture.as_mut() {
                    capture.observe(&target[..count]);
                }
                Ok(count)
            }
            Err(error) => {
                self.finish();
                Err(error)
            }
        }
    }
}

impl Drop for ConversationResponseReader {
    fn drop(&mut self) {
        self.finish();
    }
}
