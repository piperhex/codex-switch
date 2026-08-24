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
    text: String,
    reasoning_content: String,
    reasoning_id: String,
    reasoning_output_index: Option<usize>,
    message_output_index: Option<usize>,
    next_output_index: usize,
    tools: BTreeMap<usize, StreamingToolCall>,
    tool_context: CodexToolContext,
    continuation_scope: Option<chat_bridge_continuation::ContinuationScope>,
    usage: Option<Value>,
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
            text: String::new(),
            reasoning_content: String::new(),
            reasoning_id,
            reasoning_output_index: None,
            message_output_index: None,
            next_output_index: 0,
            tools: BTreeMap::new(),
            tool_context,
            continuation_scope,
            usage: None,
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
        }
    }

    fn process_event_block(&mut self) {
        if self.data_lines.is_empty() || self.completed {
            self.data_lines.clear();
            return;
        }
        let data = self.data_lines.join("\n");
        self.data_lines.clear();
        if data.trim() == "[DONE]" {
            self.finish();
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            return;
        };
        if let Some(usage) = value
            .get("usage")
            .filter(|usage| !usage.is_null())
            .and_then(chat_usage_to_responses_usage)
        {
            self.usage = Some(usage);
        }
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
        let (tool_events, tool_items) = self.finalize_tools();
        self.ensure_message_started();
        self.capture_continuation();
        let reasoning = self
            .reasoning_output_index
            .map(|index| (self.reasoning_id.as_str(), index, self.reasoning_content.as_str()));
        let message_index = self.message_output_index.unwrap_or(0);
        self.push_pending(response_done_sse(
            &self.response_id,
            &self.model,
            reasoning,
            (&self.message_id, message_index, &self.text),
            &tool_events,
            tool_items,
            self.usage.clone(),
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

    fn fail(&mut self, message: String) {
        if self.completed {
            return;
        }
        self.push_pending(response_failed_sse(
            &self.response_id,
            &self.model,
            &message,
        ));
        self.completed = true;
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
        self.push_pending(response_text_delta_sse(&self.message_id, output_index, delta));
    }

    fn append_reasoning_delta(&mut self, delta: &str) {
        if delta.is_empty() {
            return;
        }
        if self.reasoning_output_index.is_none() {
            let output_index = self.allocate_output_index();
            self.reasoning_output_index = Some(output_index);
            self.push_pending(response_reasoning_start_sse(&self.reasoning_id, output_index));
        }
        self.reasoning_content.push_str(delta);
        let output_index = self.reasoning_output_index.unwrap_or(0);
        self.push_pending(response_reasoning_delta_sse(
            &self.reasoning_id,
            output_index,
            delta,
        ));
    }

    fn process_tool_call_delta(&mut self, tool_call: &Value) -> String {
        let index = tool_call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        let id_delta = tool_call.get("id").and_then(Value::as_str);
        let function = tool_call.get("function").unwrap_or(&Value::Null);
        let name_delta = function.get("name").and_then(Value::as_str);
        let args_delta = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("");
        let signature_delta = tool_call
            .pointer("/extra_content/google/thought_signature")
            .and_then(Value::as_str)
            .unwrap_or("");

        let mut should_add = false;
        let mut output_index = None;
        let mut item_id = String::new();
        let current_name: String;

        {
            let state = self.tools.entry(index).or_default();
            if let Some(id) = id_delta.filter(|value| !value.is_empty()) {
                if !state.added {
                    state.call_id = id.to_string();
                }
            }
            if let Some(name) = name_delta.filter(|value| !value.is_empty()) {
                state.name = name.to_string();
            }
            if !args_delta.is_empty() {
                state.arguments.push_str(args_delta);
            }
            if !signature_delta.is_empty() {
                state.thought_signature.push_str(signature_delta);
            }
            if !state.added && !state.name.is_empty() {
                should_add = true;
            } else if state.added {
                output_index = state.output_index;
                item_id = state.item_id.clone();
            }
            current_name = state.name.clone();
        }

        let is_custom_tool = self.tool_context.is_custom_tool_chat_name(&current_name);
        let mut output = String::new();

        if should_add {
            let output_index = self.allocate_output_index();
            let Some(state) = self.tools.get_mut(&index) else {
                return output;
            };
            if state.call_id.is_empty() {
                state.call_id = format!("call_{index}");
            }
            state.output_index = Some(output_index);
            state.item_id = response_tool_call_item_id_from_chat_name(
                &state.call_id,
                &state.name,
                &self.tool_context,
            );
            state.added = true;
            let item = response_tool_call_item_from_chat_name(
                &state.item_id,
                "in_progress",
                &state.call_id,
                &state.name,
                "",
                &self.tool_context,
            );
            push_sse(
                &mut output,
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": item
                }),
            );
            if !state.arguments.is_empty() && !is_custom_tool {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "delta": state.arguments
                    }),
                );
            }
        } else if !args_delta.is_empty() && !is_custom_tool {
            if let Some(output_index) = output_index {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "item_id": item_id,
                        "output_index": output_index,
                        "delta": args_delta
                    }),
                );
            }
        }

        output
    }

    fn finalize_tools(&mut self) -> (String, Vec<(usize, Value)>) {
        let mut output = String::new();
        let mut items = Vec::new();
        let keys = self.tools.keys().copied().collect::<Vec<_>>();

        for key in keys {
            if self.tools.get(&key).map(|state| state.done).unwrap_or(true) {
                continue;
            }
            if self
                .tools
                .get(&key)
                .map(|state| state.name.is_empty())
                .unwrap_or(true)
            {
                if let Some(state) = self.tools.get_mut(&key) {
                    state.done = true;
                }
                continue;
            }

            let should_add = self.tools.get(&key).is_some_and(|state| !state.added);
            if should_add {
                let output_index = self.allocate_output_index();
                let Some(state) = self.tools.get_mut(&key) else {
                    continue;
                };
                if state.call_id.is_empty() {
                    state.call_id = format!("call_{key}");
                }
                state.output_index = Some(output_index);
                state.item_id = response_tool_call_item_id_from_chat_name(
                    &state.call_id,
                    &state.name,
                    &self.tool_context,
                );
                state.added = true;
                let item = response_tool_call_item_from_chat_name(
                    &state.item_id,
                    "in_progress",
                    &state.call_id,
                    &state.name,
                    "",
                    &self.tool_context,
                );
                push_sse(
                    &mut output,
                    "response.output_item.added",
                    json!({
                        "type": "response.output_item.added",
                        "output_index": output_index,
                        "item": item
                    }),
                );
            }

            let Some(state) = self.tools.get_mut(&key) else {
                continue;
            };
            let output_index = state.output_index.unwrap_or(key + 1);
            let arguments = canonicalize_tool_arguments_str(&state.arguments);
            let is_custom_tool = self.tool_context.is_custom_tool_chat_name(&state.name);
            let item = response_tool_call_item_from_chat_name(
                &state.item_id,
                "completed",
                &state.call_id,
                &state.name,
                &arguments,
                &self.tool_context,
            );
            state.done = true;
            items.push((output_index, item.clone()));

            if is_custom_tool {
                let input = custom_tool_input_from_chat_arguments(&arguments);
                if !input.is_empty() {
                    push_sse(
                        &mut output,
                        "response.custom_tool_call_input.delta",
                        json!({
                            "type": "response.custom_tool_call_input.delta",
                            "item_id": state.item_id,
                            "output_index": output_index,
                            "delta": input
                        }),
                    );
                }
                push_sse(
                    &mut output,
                    "response.custom_tool_call_input.done",
                    json!({
                        "type": "response.custom_tool_call_input.done",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "input": input
                    }),
                );
            } else {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.done",
                    json!({
                        "type": "response.function_call_arguments.done",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "arguments": arguments
                    }),
                );
            }
            push_sse(
                &mut output,
                "response.output_item.done",
                json!({
                    "type": "response.output_item.done",
                    "output_index": output_index,
                    "item": item
                }),
            );
        }

        (output, items)
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
                Err(error) => self.fail(format!("Chat bridge upstream stream failed: {error}")),
            }
        }
        Ok(self.drain_pending(target))
    }
}
