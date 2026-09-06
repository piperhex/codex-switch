#[derive(Debug, Default)]
struct StreamingToolCall {
    output_index: Option<usize>,
    item_id: String,
    call_id: String,
    name: String,
    arguments: String,
    thought_signature: String,
    added: bool,
    done: bool,
}

struct ChatSseReader<R> {
    upstream: R,
    model: String,
    response_id: String,
    message_id: String,
    pending: Vec<u8>,
    pending_offset: usize,
    data_lines: Vec<String>,
    event_type: String,
    text: String,
    reasoning_content: String,
    reasoning_id: String,
    reasoning_output_index: Option<usize>,
    message_output_index: Option<usize>,
    next_output_index: usize,
    tools: BTreeMap<usize, StreamingToolCall>,
    tool_context: CodexToolContext,
    continuation_scope: Option<chat_bridge_continuation::ContinuationScope>,
    metadata: ChatCompletionMetadata,
    termination: Option<ChatCompletionStatus>,
    completed: bool,
}

impl<R: BufRead> ChatSseReader<R> {
    fn new(
        upstream: R,
        model: String,
        tool_context: CodexToolContext,
        continuation_scope: Option<chat_bridge_continuation::ContinuationScope>,
    ) -> Self {
        let response_id = response_id();
        let message_id = format!("msg_{response_id}");
        let reasoning_id = format!("{LOCAL_REASONING_ITEM_ID_PREFIX}{response_id}");
        let pending = response_start_sse(&response_id, &model).into_bytes();
        Self {
            upstream,
            model,
            response_id: response_id.clone(),
            message_id: message_id.clone(),
            pending,
            pending_offset: 0,
            data_lines: Vec::new(),
            event_type: String::new(),
            text: String::new(),
            reasoning_content: String::new(),
            reasoning_id,
            reasoning_output_index: None,
            message_output_index: None,
            next_output_index: 0,
            tools: BTreeMap::new(),
            tool_context,
            continuation_scope,
            metadata: ChatCompletionMetadata::default(),
            termination: None,
            completed: false,
        }
    }

    fn has_pending(&self) -> bool {
        self.pending_offset < self.pending.len()
    }

    fn drain_pending(&mut self, target: &mut [u8]) -> usize {
        if target.is_empty() || !self.has_pending() {
            return 0;
        }
        let count = target
            .len()
            .min(self.pending.len().saturating_sub(self.pending_offset));
        target[..count]
            .copy_from_slice(&self.pending[self.pending_offset..self.pending_offset + count]);
        self.pending_offset += count;
        if !self.has_pending() {
            self.pending.clear();
            self.pending_offset = 0;
        }
        count
    }

    fn push_pending(&mut self, value: String) {
        if self.pending_offset > 0 {
            self.pending.drain(0..self.pending_offset);
            self.pending_offset = 0;
        }
        self.pending.extend_from_slice(value.as_bytes());
    }

    fn process_line(&mut self, line: &str) {
        let line = line.trim_end_matches(&['\r', '\n'][..]);
        if line.is_empty() {
            self.process_event_block();
            return;
        }
        if let Some(data) = line.trim_start().strip_prefix("data:") {
            self.data_lines.push(data.trim_start().to_string());
        } else if let Some(event) = line.strip_prefix("event:") {
            self.event_type = event.trim().to_string();
        }
    }

    fn process_event_block(&mut self) {
        let event_type = std::mem::take(&mut self.event_type);
        if self.data_lines.is_empty() || self.completed {
            self.data_lines.clear();
            return;
        }
        let data = self.data_lines.join("\n");
        self.data_lines.clear();
        if data.trim() == "[DONE]" {
            // Some compatible providers only send [DONE], without a finish_reason.
            self.termination
                .get_or_insert(ChatCompletionStatus::Completed);
            self.finish();
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            self.fail("The upstream response contained an unreadable event.");
            return;
        };
        self.metadata.observe(&value);
        if event_type == "error" || chat_completion_failed(&value) {
            self.fail("The upstream service could not complete the response.");
            return;
        }
        self.observe_termination(&value);
        if let Some(reasoning) = chat_stream_reasoning_delta(&value) {
            self.append_reasoning_delta(reasoning);
        }
        if let Some(delta) = chat_stream_delta_text(&value) {
            self.append_text_delta(delta);
        }
        if let Some(tool_calls) = value
            .pointer("/choices/0/delta/tool_calls")
            .and_then(Value::as_array)
        {
            for tool_call in tool_calls {
                let events = self.process_tool_call_delta(tool_call);
                if !events.is_empty() {
                    self.push_pending(events);
                }
            }
        }
    }

    fn finish(&mut self) {
        if self.completed {
            return;
        }
        let termination = self.termination.unwrap_or(ChatCompletionStatus::Failed(
            "The upstream response ended before it was complete.",
        ));
        if termination != ChatCompletionStatus::Completed {
            self.finish_unsuccessfully(termination);
            return;
        }
        if !self.tools.values().all(streaming_tool_arguments_complete) {
            self.fail("The upstream response ended with an incomplete tool call.");
            return;
        }
        let (tool_events, tool_items) = self.finalize_tools();
        self.ensure_message_started();
        self.capture_continuation();
        let reasoning = self.reasoning_output_index.map(|index| {
            (
                self.reasoning_id.as_str(),
                index,
                self.reasoning_content.as_str(),
            )
        });
        let message_index = self.message_output_index.unwrap_or(0);
        self.push_pending(response_done_sse(
            &self.response_id,
            &self.model,
            reasoning,
            (&self.message_id, message_index, &self.text),
            &tool_events,
            tool_items,
            self.metadata.clone(),
        ));
        self.completed = true;
    }

    fn capture_continuation(&self) {
        let Some(scope) = self.continuation_scope.as_ref() else {
            return;
        };
        let tool_calls = self
            .tools
            .values()
            .filter(|tool| !tool.call_id.is_empty())
            .map(streaming_continuation_tool_call)
            .collect::<Vec<_>>();
        if tool_calls.is_empty() {
            return;
        }
        let message = json!({
            "reasoning_content": self.reasoning_content,
            "tool_calls": tool_calls
        });
        chat_bridge_continuation::capture_message(scope, &message);
    }

    fn fail(&mut self, message: &'static str) {
        self.finish_unsuccessfully(ChatCompletionStatus::Failed(message));
    }

    fn allocate_output_index(&mut self) -> usize {
        let index = self.next_output_index;
        self.next_output_index += 1;
        index
    }

    fn ensure_message_started(&mut self) {
        if self.message_output_index.is_some() {
            return;
        }
        let output_index = self.allocate_output_index();
        self.message_output_index = Some(output_index);
        self.push_pending(response_message_start_sse(&self.message_id, output_index));
    }

    fn append_text_delta(&mut self, delta: &str) {
        if delta.is_empty() {
            return;
        }
        self.ensure_message_started();
        self.text.push_str(delta);
        let output_index = self.message_output_index.unwrap_or(0);
        self.push_pending(response_text_delta_sse(
            &self.message_id,
            output_index,
            delta,
        ));
    }

    fn append_reasoning_delta(&mut self, delta: &str) {
        if delta.is_empty() {
            return;
        }
        if self.reasoning_output_index.is_none() {
            let output_index = self.allocate_output_index();
            self.reasoning_output_index = Some(output_index);
            self.push_pending(response_reasoning_start_sse(
                &self.reasoning_id,
                output_index,
            ));
        }
        self.reasoning_content.push_str(delta);
        let output_index = self.reasoning_output_index.unwrap_or(0);
        self.push_pending(response_reasoning_delta_sse(
            &self.reasoning_id,
            output_index,
            delta,
        ));
    }
}

impl<R: BufRead> Read for ChatSseReader<R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() {
            return Ok(0);
        }
        let copied = self.drain_pending(target);
        if copied > 0 {
            return Ok(copied);
        }

        while !self.completed && !self.has_pending() {
            let mut line = String::new();
            match self.upstream.read_line(&mut line) {
                Ok(0) => {
                    self.process_event_block();
                    self.finish();
                }
                Ok(_) => self.process_line(&line),
                Err(_) => self.fail("The connection closed before the response was complete."),
            }
        }
        Ok(self.drain_pending(target))
    }
}
