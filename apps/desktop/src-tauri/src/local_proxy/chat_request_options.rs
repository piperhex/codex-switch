fn apply_chat_request_options(body: &Value, result: &mut Value) {
    for key in [
        "temperature",
        "top_p",
        "stream",
        "presence_penalty",
        "frequency_penalty",
        "parallel_tool_calls",
        "service_tier",
    ] {
        if let Some(value) = body.get(key) {
            result[key] = value.clone();
        }
    }
    if let Some(value) = body
        .get("max_output_tokens")
        .or_else(|| body.get("max_tokens"))
        .or_else(|| body.get("max_completion_tokens"))
    {
        result["max_tokens"] = value.clone();
    }
    if let Some(effort) = body.pointer("/reasoning/effort").and_then(Value::as_str) {
        result["reasoning_effort"] = json!(effort);
    }
    if let Some(format) = body.pointer("/text/format").and_then(chat_response_format) {
        result["response_format"] = format;
    }
}

fn chat_response_format(format: &Value) -> Option<Value> {
    match format.get("type").and_then(Value::as_str)? {
        "text" | "json_object" => Some(json!({ "type": format["type"] })),
        "json_schema" => {
            let mut schema = format.as_object()?.clone();
            schema.remove("type");
            Some(json!({ "type": "json_schema", "json_schema": schema }))
        }
        _ => None,
    }
}
