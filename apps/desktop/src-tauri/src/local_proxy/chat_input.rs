struct ChatInputBuilder<'a> {
    messages: &'a mut Vec<Value>,
    tools: &'a CodexToolContext,
    pending_calls: Vec<Value>,
    reasoning: Option<String>,
    scope: Option<&'a chat_bridge_continuation::ContinuationScope>,
}

fn append_input_messages(
    input: &Value,
    messages: &mut Vec<Value>,
    tools: &CodexToolContext,
    scope: Option<&chat_bridge_continuation::ContinuationScope>,
) {
    let mut builder = ChatInputBuilder {
        messages,
        tools,
        pending_calls: Vec::new(),
        reasoning: None,
        scope,
    };
    builder.append(input);
    builder.flush_calls();
}

impl ChatInputBuilder<'_> {
    fn append(&mut self, item: &Value) {
        if let Some(items) = item.as_array() {
            for item in items {
                self.append(item);
            }
            return;
        }
        match item.get("type").and_then(Value::as_str) {
            Some("additional_tools") => {}
            Some("reasoning") => {
                self.flush_calls();
                self.reasoning = response_reasoning_text(item).or_else(|| {
                    let id = item.get("id")?.as_str()?;
                    chat_bridge_continuation::reasoning_for_item(self.scope?, id)
                });
            }
            Some("function_call") => self
                .pending_calls
                .push(responses_function_call_to_chat_tool_call(item, self.tools)),
            Some("custom_tool_call") => self
                .pending_calls
                .push(responses_custom_tool_call_to_chat_tool_call(item)),
            Some("tool_search_call") => self
                .pending_calls
                .push(responses_tool_search_call_to_chat_tool_call(item)),
            Some("function_call_output" | "custom_tool_call_output" | "tool_search_output") => {
                self.flush_calls();
                append_tool_output_message(item, self.messages);
            }
            _ => self.append_message(item),
        }
    }

    fn append_message(&mut self, item: &Value) {
        self.flush_calls();
        let previous_len = self.messages.len();
        if let Some(text) = item.as_str() {
            self.messages
                .push(json!({ "role": "user", "content": text }));
        } else {
            append_regular_input_message(item, self.messages);
        }
        if self.messages.len() == previous_len {
            return;
        }
        let message = &mut self.messages[previous_len];
        if message["role"] == "assistant" {
            if let Some(reasoning) = &self.reasoning {
                message["reasoning_content"] = json!(reasoning);
            }
        } else if message["role"] == "user" {
            self.reasoning = None;
        }
    }

    fn flush_calls(&mut self) {
        if self.pending_calls.is_empty() {
            return;
        }
        let calls = Value::Array(std::mem::take(&mut self.pending_calls));
        if let Some(message) = self
            .messages
            .last_mut()
            .filter(|message| message["role"] == "assistant" && message.get("tool_calls").is_none())
        {
            message["tool_calls"] = calls;
        } else {
            self.messages
                .push(json!({ "role": "assistant", "content": null, "tool_calls": calls }));
        }
        if let (Some(message), Some(reasoning)) = (self.messages.last_mut(), &self.reasoning) {
            message["reasoning_content"] = json!(reasoning);
        }
    }
}

fn append_tool_output_message(item: &Value, messages: &mut Vec<Value>) {
    let call_id = item.get("call_id").and_then(Value::as_str).unwrap_or("");
    if call_id.is_empty() {
        return;
    }
    let content = item
        .get("output")
        .map(output_to_chat_tool_content)
        .unwrap_or_else(|| canonical_json_string(item));
    messages.push(json!({ "role": "tool", "tool_call_id": call_id, "content": content }));
}

fn response_reasoning_text(item: &Value) -> Option<String> {
    let parts = item
        .get("summary")
        .or_else(|| item.get("content"))?
        .as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    (!text.is_empty()).then_some(text)
}

fn chat_message_reasoning(message: &Value) -> Option<&str> {
    ["reasoning_content", "reasoning"]
        .into_iter()
        .find_map(|key| {
            message
                .get(key)
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
        })
}

fn agent_message_text(item: &Value) -> Option<String> {
    let parts = item.get("content")?.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| match part.get("type").and_then(Value::as_str) {
            Some("input_text" | "text") => part.get("text").and_then(Value::as_str),
            // Codex custom-provider agent envelopes carry plaintext in this named field.
            // This is deliberately scoped to agent_message, never to reasoning ciphertext.
            Some("encrypted_content") => part.get("encrypted_content").and_then(Value::as_str),
            _ => None,
        })
        .collect::<String>();
    (!text.is_empty()).then_some(text)
}
