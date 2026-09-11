/// An upstream termination reason is separate from closing the SSE transport.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChatCompletionStatus {
    Completed,
    Incomplete(&'static str),
    Failed(&'static str),
}

impl ChatCompletionStatus {
    fn from_chat(value: &Value) -> Option<Self> {
        if chat_completion_failed(value) {
            return Some(Self::Failed(
                "The upstream service could not complete the response.",
            ));
        }
        match value.pointer("/choices/0/finish_reason")?.as_str()? {
            "stop" | "tool_calls" | "function_call" => Some(Self::Completed),
            "length" => Some(Self::Incomplete("max_output_tokens")),
            "content_filter" => Some(Self::Incomplete("content_filter")),
            _ => Some(Self::Failed(
                "The upstream response could not be completed.",
            )),
        }
    }

    fn event_type(self) -> &'static str {
        match self {
            Self::Completed => "response.completed",
            Self::Incomplete(_) => "response.incomplete",
            Self::Failed(_) => "response.failed",
        }
    }

    fn apply(self, response: &mut Value) {
        let status = match self {
            Self::Completed => "completed",
            Self::Incomplete(reason) => {
                response["incomplete_details"] = json!({ "reason": reason });
                "incomplete"
            }
            Self::Failed(message) => {
                response["error"] = json!({ "code": "server_error", "message": message });
                "failed"
            }
        };
        response["status"] = json!(status);
        if self == Self::Completed {
            return;
        }
        if let Some(items) = response.get_mut("output").and_then(Value::as_array_mut) {
            for item in items {
                item["status"] = json!("incomplete");
            }
        }
    }
}

fn chat_completion_failed(value: &Value) -> bool {
    value.get("error").is_some_and(|error| !error.is_null())
        || matches!(
            value.get("type").and_then(Value::as_str),
            Some("error" | "response.failed")
        )
        || value.get("status").and_then(Value::as_str) == Some("failed")
        || value.pointer("/response/status").and_then(Value::as_str) == Some("failed")
}

fn streaming_tool_arguments_complete(tool: &StreamingToolCall) -> bool {
    !tool.name.is_empty()
        && (tool.arguments.trim().is_empty()
            || serde_json::from_str::<Value>(&tool.arguments).is_ok())
}

impl<R: BufRead> ChatSseReader<R> {
    fn observe_termination(&mut self, value: &Value) {
        let Some(status) = ChatCompletionStatus::from_chat(value) else {
            return;
        };
        // Usage-only chunks can follow finish_reason. Keep reading them, but never
        // let a later success marker turn truncation or failure into success.
        let should_update = match self.termination {
            None | Some(ChatCompletionStatus::Completed) => true,
            Some(ChatCompletionStatus::Incomplete(_)) => {
                matches!(status, ChatCompletionStatus::Failed(_))
            }
            Some(ChatCompletionStatus::Failed(_)) => false,
        };
        if should_update {
            self.termination = Some(status);
        }
    }

    fn finish_unsuccessfully(&mut self, status: ChatCompletionStatus) {
        if self.completed {
            return;
        }
        let mut response = json!({
            "id": self.response_id,
            "object": "response",
            "created_at": unix_now(),
            "model": self.model,
            "output": self.partial_output()
        });
        if let Some(usage) = &self.metadata.usage {
            response["usage"] = usage.clone();
            if matches!(status, ChatCompletionStatus::Failed(_)) {
                // A synthesized failure may only contain usage from an earlier partial event.
                response["usage"][INCOMPLETE_USAGE_FLAG] = json!(true);
            }
        }
        if let Some(tier) = &self.metadata.service_tier {
            response["service_tier"] = json!(tier);
        }
        status.apply(&mut response);
        let mut output = String::new();
        push_sse(
            &mut output,
            status.event_type(),
            json!({
                "type": status.event_type(), "response": response
            }),
        );
        output.push_str("data: [DONE]\n\n");
        self.push_pending(output);
        self.completed = true;
    }

    fn partial_output(&self) -> Vec<Value> {
        let mut items = Vec::new();
        if let Some(index) = self.reasoning_output_index {
            items.push((
                index,
                json!({
                    "id": self.reasoning_id, "type": "reasoning", "status": "incomplete",
                    "summary": [{ "type": "summary_text", "text": self.reasoning_content }]
                }),
            ));
        }
        if let Some(index) = self.message_output_index {
            items.push((index, json!({
                "id": self.message_id, "type": "message", "status": "incomplete", "role": "assistant",
                "content": [{ "type": "output_text", "text": self.text, "annotations": [] }]
            })));
        }
        for tool in self.tools.values() {
            let Some(index) = tool.output_index else {
                continue;
            };
            items.push((
                index,
                response_tool_call_item_from_chat_name(
                    &tool.item_id,
                    "incomplete",
                    &tool.call_id,
                    &tool.name,
                    &tool.arguments,
                    &self.tool_context,
                ),
            ));
        }
        items.sort_by_key(|(index, _)| *index);
        items.into_iter().map(|(_, item)| item).collect()
    }
}
