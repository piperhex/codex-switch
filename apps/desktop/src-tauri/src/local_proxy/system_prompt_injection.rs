const MAX_SYSTEM_PROMPT_INJECTION_PROMPTS: usize = 100;
const MAX_SYSTEM_PROMPT_INJECTION_PROMPT_CHARS: usize = 500;

static SYSTEM_PROMPT_INJECTION_ENABLED: AtomicBool = AtomicBool::new(false);
static SYSTEM_PROMPT_INJECTION_PROMPTS: OnceLock<RwLock<Vec<String>>> = OnceLock::new();

fn system_prompt_injection_prompts() -> &'static RwLock<Vec<String>> {
    SYSTEM_PROMPT_INJECTION_PROMPTS.get_or_init(|| RwLock::new(Vec::new()))
}

fn set_system_prompt_injection_runtime_config(enabled: bool, prompts: Vec<String>) {
    let mut stored_prompts = match system_prompt_injection_prompts().write() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *stored_prompts = prompts;
    SYSTEM_PROMPT_INJECTION_ENABLED.store(enabled, Ordering::Relaxed);
}

fn runtime_system_prompt_injection_prompts() -> Vec<String> {
    match system_prompt_injection_prompts().read() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn inject_system_prompts(body: Vec<u8>) -> Vec<u8> {
    if !SYSTEM_PROMPT_INJECTION_ENABLED.load(Ordering::Relaxed) {
        return body;
    }
    let prompts = runtime_system_prompt_injection_prompts();
    if prompts.is_empty() {
        return body;
    }
    let Ok(value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    let value = inject_system_prompt_value_with_prompts(value, &prompts);
    serde_json::to_vec(&value).unwrap_or(body)
}

fn inject_system_prompt_value(value: Value) -> Value {
    if !SYSTEM_PROMPT_INJECTION_ENABLED.load(Ordering::Relaxed) {
        return value;
    }
    inject_system_prompt_value_with_prompts(value, &runtime_system_prompt_injection_prompts())
}

fn inject_system_prompt_value_with_prompts(mut value: Value, prompts: &[String]) -> Value {
    if prompts.is_empty() {
        return value;
    }
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    let injection = prompts.join("\n\n");
    if let Some(Value::Array(messages)) = object.get_mut("messages") {
        messages.insert(0, json!({ "role": "system", "content": injection }));
        return value;
    }
    if !object.contains_key("instructions") && !object.contains_key("input") {
        return value;
    }
    if let Some(instructions) = object.get_mut("instructions") {
        *instructions = merge_instructions(std::mem::take(instructions), &injection);
    } else {
        object.insert("instructions".to_string(), Value::String(injection));
    }
    value
}

fn merge_instructions(existing: Value, injection: &str) -> Value {
    match existing {
        Value::String(current) if current.trim().is_empty() => Value::String(injection.to_string()),
        Value::String(current) => Value::String(format!("{injection}\n\n{current}")),
        Value::Array(items) => {
            let mut merged = vec![json!({ "type": "input_text", "text": injection })];
            merged.extend(items);
            Value::Array(merged)
        }
        _ => Value::String(injection.to_string()),
    }
}

fn normalize_system_prompt_injection_prompts(prompts: Vec<String>) -> Result<Vec<String>, String> {
    if prompts.len() > MAX_SYSTEM_PROMPT_INJECTION_PROMPTS {
        return Err(format!(
            "You can add up to {MAX_SYSTEM_PROMPT_INJECTION_PROMPTS} injection prompts"
        ));
    }
    let mut normalized_prompts = Vec::with_capacity(prompts.len());
    let mut seen = HashSet::with_capacity(prompts.len());
    for prompt in prompts {
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            return Err("Injection prompts cannot be empty".to_string());
        }
        if trimmed.chars().count() > MAX_SYSTEM_PROMPT_INJECTION_PROMPT_CHARS {
            return Err(format!(
                "Each injection prompt can contain up to {MAX_SYSTEM_PROMPT_INJECTION_PROMPT_CHARS} characters"
            ));
        }
        if seen.insert(trimmed.to_lowercase()) {
            normalized_prompts.push(trimmed.to_string());
        }
    }
    Ok(normalized_prompts)
}

#[tauri::command]
pub(crate) async fn set_system_prompt_injection_enabled<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = resolve_paths(&app)?;
        let mut state = read_state(&paths);
        state.system_prompt_injection_enabled = enabled;
        write_state(&paths, &state)?;
        set_system_prompt_injection_runtime_config(
            enabled,
            state.system_prompt_injection_prompts,
        );
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        Ok(status(&app))
    })
    .await
    .map_err(|error| format!("System prompt injection update task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_system_prompt_injection_prompts<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    prompts: Vec<String>,
) -> Result<LocalProxyStatus, String> {
    let normalized_prompts = normalize_system_prompt_injection_prompts(prompts)?;
    tauri::async_runtime::spawn_blocking(move || {
        let paths = resolve_paths(&app)?;
        let mut state = read_state(&paths);
        state.system_prompt_injection_prompts = normalized_prompts.clone();
        write_state(&paths, &state)?;
        set_system_prompt_injection_runtime_config(
            state.system_prompt_injection_enabled,
            normalized_prompts,
        );
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        Ok(status(&app))
    })
    .await
    .map_err(|error| format!("System prompt injection prompt update task failed: {error}"))?
}

#[cfg(test)]
mod system_prompt_injection_tests {
    use super::{
        inject_system_prompt_value_with_prompts, normalize_system_prompt_injection_prompts,
        MAX_SYSTEM_PROMPT_INJECTION_PROMPTS, MAX_SYSTEM_PROMPT_INJECTION_PROMPT_CHARS,
    };
    use serde_json::json;

    #[test]
    fn prepends_injection_to_responses_instructions() {
        let value = inject_system_prompt_value_with_prompts(
            json!({ "instructions": "Be concise" }),
            &["Follow the team policy".to_string()],
        );
        assert_eq!(value["instructions"], "Follow the team policy\n\nBe concise");
    }

    #[test]
    fn prepends_system_message_to_chat_requests() {
        let value = inject_system_prompt_value_with_prompts(
            json!({ "messages": [{ "role": "user", "content": "Hello" }] }),
            &["Use plain language".to_string()],
        );
        assert_eq!(value["messages"].as_array().map(Vec::len), Some(2));
        assert_eq!(value["messages"][0]["role"], "system");
        assert_eq!(value["messages"][0]["content"], "Use plain language");
    }

    #[test]
    fn leaves_unrelated_payloads_unchanged() {
        let value = inject_system_prompt_value_with_prompts(
            json!({ "model": "gpt-image-1", "size": "1024x1024" }),
            &["Do not alter image settings".to_string()],
        );
        assert_eq!(value, json!({ "model": "gpt-image-1", "size": "1024x1024" }));
    }

    #[test]
    fn normalizes_and_deduplicates_prompts() {
        let prompts = normalize_system_prompt_injection_prompts(vec![
            "  Be helpful  ".to_string(),
            "be helpful".to_string(),
            "Stay focused".to_string(),
        ])
        .expect("prompts should be valid");
        assert_eq!(prompts, vec!["Be helpful", "Stay focused"]);
        assert!(normalize_system_prompt_injection_prompts(vec![" ".to_string()]).is_err());
        let long_prompt = "x".repeat(MAX_SYSTEM_PROMPT_INJECTION_PROMPT_CHARS + 1);
        let too_many_prompts = vec!["prompt".to_string(); MAX_SYSTEM_PROMPT_INJECTION_PROMPTS + 1];
        assert!(normalize_system_prompt_injection_prompts(vec![long_prompt]).is_err());
        assert!(normalize_system_prompt_injection_prompts(too_many_prompts).is_err());
    }
}
