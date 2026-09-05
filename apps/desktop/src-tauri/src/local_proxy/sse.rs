#[cfg(test)]
fn chat_sse_to_responses_sse(sse: &str, model: &str) -> String {
    let mut reader = ChatSseReader::new(
        BufReader::new(std::io::Cursor::new(sse.as_bytes().to_vec())),
        model.to_string(),
        CodexToolContext::default(),
        None,
    );
    let mut output = String::new();
    reader
        .read_to_string(&mut output)
        .expect("in-memory chat stream should be readable");
    output
}

fn streaming_continuation_tool_call(tool: &StreamingToolCall) -> Value {
    let mut tool_call = json!({ "id": tool.call_id });
    if !tool.thought_signature.is_empty() {
        tool_call["extra_content"] = json!({
            "google": { "thought_signature": tool.thought_signature }
        });
    }
    tool_call
}

fn chat_stream_reasoning_delta(value: &Value) -> Option<&str> {
    value
        .pointer("/choices/0/delta/reasoning_content")
        .and_then(Value::as_str)
}

fn chat_stream_delta_text(value: &Value) -> Option<&str> {
    value
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
}

fn response_start_sse(response_id: &str, model: &str) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.created",
        json!({
            "type": "response.created",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": unix_now(),
                "status": "in_progress",
                "model": model,
                "output": []
            }
        }),
    );
    output
}

fn response_message_start_sse(message_id: &str, output_index: usize) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.output_item.added",
        json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": {
                "id": message_id,
                "type": "message",
                "status": "in_progress",
                "role": "assistant",
                "content": []
            }
        }),
    );
    push_sse(
        &mut output,
        "response.content_part.added",
        json!({
            "type": "response.content_part.added",
            "item_id": message_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": "" }
        }),
    );
    output
}

fn response_reasoning_start_sse(reasoning_id: &str, output_index: usize) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.output_item.added",
        json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": {
                "id": reasoning_id,
                "type": "reasoning",
                "status": "in_progress",
                "summary": []
            }
        }),
    );
    push_sse(
        &mut output,
        "response.reasoning_summary_part.added",
        json!({
            "type": "response.reasoning_summary_part.added",
            "item_id": reasoning_id,
            "output_index": output_index,
            "summary_index": 0,
            "part": { "type": "summary_text", "text": "" }
        }),
    );
    output
}

fn response_text_delta_sse(message_id: &str, output_index: usize, delta: &str) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.output_text.delta",
        json!({
            "type": "response.output_text.delta",
            "item_id": message_id,
            "output_index": output_index,
            "content_index": 0,
            "delta": delta
        }),
    );
    output
}

fn response_reasoning_delta_sse(reasoning_id: &str, output_index: usize, delta: &str) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.reasoning_summary_text.delta",
        json!({
            "type": "response.reasoning_summary_text.delta",
            "item_id": reasoning_id,
            "output_index": output_index,
            "summary_index": 0,
            "delta": delta
        }),
    );
    output
}

fn response_done_sse(
    response_id: &str,
    model: &str,
    reasoning_id: Option<(&str, usize, &str)>,
    message: (&str, usize, &str),
    tool_events: &str,
    mut tool_items: Vec<(usize, Value)>,
    metadata: ChatCompletionMetadata,
) -> String {
    let mut output = String::new();
    let (message_id, message_index, text) = message;
    let mut response_output = Vec::new();
    if let Some((reasoning_id, reasoning_index, reasoning)) = reasoning_id {
        let reasoning_item = json!({
            "id": reasoning_id,
            "type": "reasoning",
            "status": "completed",
            "summary": [{ "type": "summary_text", "text": reasoning }]
        });
        response_output.push((reasoning_index, reasoning_item));
        push_sse(
            &mut output,
            "response.reasoning_summary_text.done",
            json!({
                "type": "response.reasoning_summary_text.done",
                "item_id": reasoning_id,
                "output_index": reasoning_index,
                "summary_index": 0,
                "text": reasoning
            }),
        );
        push_sse(
            &mut output,
            "response.reasoning_summary_part.done",
            json!({
                "type": "response.reasoning_summary_part.done",
                "item_id": reasoning_id,
                "output_index": reasoning_index,
                "summary_index": 0,
                "part": { "type": "summary_text", "text": reasoning }
            }),
        );
        push_sse(
            &mut output,
            "response.output_item.done",
            json!({
                "type": "response.output_item.done",
                "output_index": reasoning_index,
                "item": {
                    "id": reasoning_id,
                    "type": "reasoning",
                    "status": "completed",
                    "summary": [{ "type": "summary_text", "text": reasoning }]
                }
            }),
        );
    }
    let message_item = json!({
        "id": message_id,
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{ "type": "output_text", "text": text, "annotations": [] }]
    });
    push_sse(
        &mut output,
        "response.output_text.done",
        json!({
            "type": "response.output_text.done",
            "item_id": message_id,
            "output_index": message_index,
            "content_index": 0,
            "text": text
        }),
    );
    push_sse(
        &mut output,
        "response.content_part.done",
        json!({
            "type": "response.content_part.done",
            "item_id": message_id,
            "output_index": message_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": text }
        }),
    );
    push_sse(
        &mut output,
        "response.output_item.done",
        json!({
            "type": "response.output_item.done",
            "output_index": message_index,
            "item": message_item
        }),
    );
    output.push_str(tool_events);
    response_output.push((message_index, message_item));
    response_output.append(&mut tool_items);
    response_output.sort_by_key(|(index, _)| *index);
    let mut response = json!({
        "id": response_id,
        "object": "response",
        "created_at": unix_now(),
        "status": "completed",
        "model": model,
        "output": response_output.into_iter().map(|(_, item)| item).collect::<Vec<_>>()
    });
    if let Some(usage) = metadata.usage {
        response["usage"] = usage;
    }
    if let Some(tier) = metadata.service_tier {
        response["service_tier"] = Value::String(tier);
    }
    push_sse(
        &mut output,
        "response.completed",
        json!({
            "type": "response.completed",
            "response": response
        }),
    );
    output.push_str("data: [DONE]\n\n");
    output
}

fn response_failed_sse(response_id: &str, model: &str, message: &str) -> String {
    let mut output = String::new();
    push_sse(
        &mut output,
        "response.failed",
        json!({
            "type": "response.failed",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": unix_now(),
                "status": "failed",
                "model": model,
                "error": { "message": message }
            }
        }),
    );
    output.push_str("data: [DONE]\n\n");
    output
}

fn push_sse(output: &mut String, event: &str, value: Value) {
    output.push_str("event: ");
    output.push_str(event);
    output.push('\n');
    output.push_str("data: ");
    output.push_str(&value.to_string());
    output.push_str("\n\n");
}

fn response_id() -> String {
    format!("resp_{}", unix_now())
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
