fn diagnostic_header_summary(headers: &[(String, String)]) -> Value {
    json!({
        "xClientRequestId": diagnostic_header_value(headers, "x-client-request-id"),
        "xCodexWindowId": diagnostic_header_value(headers, "x-codex-window-id"),
        "threadId": diagnostic_header_value(headers, "thread-id"),
        "sessionId": diagnostic_header_value(headers, "session-id"),
        "legacySessionId": diagnostic_header_value(headers, "session_id"),
        "contentType": diagnostic_header_value(headers, "content-type"),
        "accept": diagnostic_header_value(headers, "accept"),
        "authorizationPresent": header_value(headers, "authorization").is_some(),
        "apiKeyPresent": header_value(headers, "x-api-key").is_some()
            || header_value(headers, "openai-api-key").is_some()
            || header_value(headers, "api-key").is_some(),
        "chatgptAccountIdPresent": header_value(headers, "chatgpt-account-id").is_some()
    })
}

fn token_usage_total(usage: &TokenUsageValues) -> Option<u64> {
    usage
        .total_tokens
        .or_else(|| match (usage.input_tokens, usage.output_tokens) {
            (None, None) => None,
            (input, output) => Some(input.unwrap_or(0).saturating_add(output.unwrap_or(0))),
        })
}

fn diagnostic_header_value(headers: &[(String, String)], name: &str) -> Value {
    header_value(headers, name)
        .map(diagnostic_string_value)
        .unwrap_or_else(|| json!({ "present": false }))
}

fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn request_query_diagnostic(url: &str) -> Value {
    url.split_once('?')
        .map(|(_, query)| diagnostic_string_value(query))
        .unwrap_or_else(|| json!({ "present": false }))
}

fn diagnostic_target(target: Option<&ActiveTarget>, route: ProxyDiagnosticRoute) -> Value {
    match target {
        Some(ActiveTarget::Official { model }) => json!({
            "type": "official",
            "model": model
        }),
        Some(ActiveTarget::Provider(provider)) => json!({
            "type": "provider",
            "id": provider.id,
            "name": provider.name,
            "apiFormat": provider.api_format,
            "model": provider.model,
            "modelSelectionControlledByCodex": provider.model_selection_controlled_by_codex
        }),
        Some(ActiveTarget::ProviderGroup(providers)) => json!({
            "type": "providerGroup",
            "providerCount": providers.len()
        }),
        Some(ActiveTarget::Aggregate(target)) => json!({
            "type": "aggregateApi",
            "id": target.config.id,
            "name": target.config.name,
            "model": target.config.model,
            "memberCount": target.profiles.len()
        }),
        None if route.is_local() => json!({ "type": "local" }),
        None => json!({ "type": "unresolved" }),
    }
}

fn request_body_diagnostic(body: &[u8], parsed: Option<&Value>) -> Value {
    let mut result = json!({
        "bytes": body.len(),
        "hash": short_hash_bytes(body),
    });

    let Some(value) = parsed else {
        result["json"] = Value::Bool(false);
        result["empty"] = Value::Bool(body.is_empty());
        return result;
    };

    result["json"] = Value::Bool(true);
    result["shape"] = diagnostic_value_shape(Some(value));
    result["model"] = diagnostic_scalar_value(value.get("model"));
    result["stream"] = diagnostic_scalar_value(value.get("stream"));
    result["store"] = diagnostic_scalar_value(value.get("store"));
    result["previousResponseId"] = value
        .get("previous_response_id")
        .and_then(Value::as_str)
        .map(diagnostic_string_value)
        .unwrap_or_else(|| diagnostic_scalar_value(value.get("previous_response_id")));
    result["input"] = diagnostic_value_shape(value.get("input"));
    result["messages"] = diagnostic_value_shape(value.get("messages"));
    result["tools"] = diagnostic_value_shape(value.get("tools"));
    result["toolChoice"] = diagnostic_value_shape(value.get("tool_choice"));
    result["include"] = diagnostic_value_shape(value.get("include"));
    result["instructions"] = diagnostic_value_shape(value.get("instructions"));
    result["metadata"] = diagnostic_value_shape(value.get("metadata"));
    result["maxOutputTokens"] = diagnostic_scalar_value(value.get("max_output_tokens"));
    result["maxTokens"] = diagnostic_scalar_value(value.get("max_tokens"));
    result["temperature"] = diagnostic_scalar_value(value.get("temperature"));
    result
}

fn responses_body_diagnostic(body: &Value) -> Value {
    json!({
        "json": true,
        "model": diagnostic_scalar_value(body.get("model")),
        "previousResponseId": body
            .get("previous_response_id")
            .and_then(Value::as_str)
            .map(diagnostic_string_value)
            .unwrap_or_else(|| json!({ "present": false })),
        "store": diagnostic_scalar_value(body.get("store")),
        "stream": diagnostic_scalar_value(body.get("stream")),
        "input": diagnostic_value_shape(body.get("input")),
        "tools": diagnostic_value_shape(body.get("tools")),
        "include": diagnostic_value_shape(body.get("include")),
        "instructions": diagnostic_value_shape(body.get("instructions")),
        "bodyHash": diagnostic_value_hash(body)
    })
}

fn diagnostic_string_value(value: &str) -> Value {
    json!({
        "present": true,
        "len": value.len(),
        "hash": short_hash_str(value)
    })
}

fn diagnostic_scalar_value(value: Option<&Value>) -> Value {
    match value {
        None => json!({ "present": false }),
        Some(Value::Bool(value)) => json!({ "present": true, "type": "bool", "value": value }),
        Some(Value::Number(value)) => json!({ "present": true, "type": "number", "value": value }),
        Some(Value::String(value)) => json!({
            "present": true,
            "type": "string",
            "len": value.len(),
            "hash": short_hash_str(value)
        }),
        Some(other) => diagnostic_value_shape(Some(other)),
    }
}

fn diagnostic_response_body(bytes: &[u8], content_type: Option<&str>) -> Value {
    let (text, utf8) = match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), true),
        Err(_) => (String::from_utf8_lossy(bytes).to_string(), false),
    };
    json!({
        "captured": true,
        "bytes": bytes.len(),
        "hash": short_hash_bytes(bytes),
        "contentType": content_type,
        "utf8": utf8,
        "truncated": text.chars().count() > DIAGNOSTIC_RESPONSE_BODY_MAX_CHARS,
        "text": truncate_for_log(&text, DIAGNOSTIC_RESPONSE_BODY_MAX_CHARS)
    })
}

fn diagnostic_value_shape(value: Option<&Value>) -> Value {
    let Some(value) = value else {
        return json!({ "present": false });
    };

    let mut result = match value {
        Value::Null => json!({ "present": true, "type": "null" }),
        Value::Bool(_) => json!({ "present": true, "type": "bool" }),
        Value::Number(_) => json!({ "present": true, "type": "number" }),
        Value::String(text) => json!({ "present": true, "type": "string", "len": text.len() }),
        Value::Array(items) => json!({ "present": true, "type": "array", "len": items.len() }),
        Value::Object(map) => json!({ "present": true, "type": "object", "len": map.len() }),
    };
    result["hash"] = Value::String(diagnostic_value_hash(value));
    result
}

fn diagnostic_value_hash(value: &Value) -> String {
    short_hash_str(&canonical_json_string(value))
}

fn short_hash_str(value: &str) -> String {
    short_hash_bytes(value.as_bytes())
}

fn short_hash_bytes(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    let digest = hasher.finalize();
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn truncate_for_log(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for ch in value.chars().take(max_chars) {
        output.push(ch);
    }
    if value.chars().count() > max_chars {
        output.push_str("...");
    }
    output
}

fn append_diagnostic_log<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entry: &Value,
) -> Result<(), String> {
    let path = diagnostic_log_path(app)?;
    rotate_diagnostic_log_if_needed(&path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Diagnostic log path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    serde_json::to_writer(&mut file, entry)
        .map_err(|error| format!("Failed to serialize diagnostic log: {error}"))?;
    file.write_all(b"\n")
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn rotate_diagnostic_log_if_needed(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() <= DIAGNOSTIC_LOG_MAX_BYTES {
        return Ok(());
    }

    let rotated = path.with_extension("jsonl.old");
    if rotated.exists() {
        fs::remove_file(&rotated)
            .map_err(|error| format!("Failed to remove {}: {error}", rotated.display()))?;
    }
    fs::rename(path, &rotated).map_err(|error| {
        format!(
            "Failed to rotate diagnostic log {} to {}: {error}",
            path.display(),
            rotated.display()
        )
    })
}

fn diagnostic_log_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?;
    Ok(app_data.join("logs").join(DIAGNOSTIC_LOG_FILE_NAME))
}
