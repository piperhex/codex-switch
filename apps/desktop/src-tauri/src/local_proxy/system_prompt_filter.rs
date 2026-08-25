static SYSTEM_PROMPT_FILTER_ENABLED: AtomicBool = AtomicBool::new(false);

fn set_system_prompt_filter_runtime_enabled(enabled: bool) {
    SYSTEM_PROMPT_FILTER_ENABLED.store(enabled, Ordering::Relaxed);
}

fn filter_system_prompts(body: Vec<u8>) -> Vec<u8> {
    if !SYSTEM_PROMPT_FILTER_ENABLED.load(Ordering::Relaxed) {
        return body;
    }
    filter_system_prompts_when_enabled(body)
}

fn filter_system_prompts_when_enabled(body: Vec<u8>) -> Vec<u8> {
    let Ok(value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    let value = remove_system_prompts(value);
    serde_json::to_vec(&value).unwrap_or(body)
}

fn filter_system_prompt_value(value: Value) -> Value {
    if SYSTEM_PROMPT_FILTER_ENABLED.load(Ordering::Relaxed) {
        remove_system_prompts(value)
    } else {
        value
    }
}

fn remove_system_prompts(mut value: Value) -> Value {
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    object.remove("instructions");
    object.remove("system");
    remove_system_messages(object.get_mut("messages"));
    remove_system_messages(object.get_mut("input"));
    value
}

fn remove_system_messages(value: Option<&mut Value>) {
    let Some(Value::Array(messages)) = value else {
        return;
    };
    messages.retain(|message| {
        !message
            .get("role")
            .and_then(Value::as_str)
            .is_some_and(is_system_role)
    });
}

fn is_system_role(role: &str) -> bool {
    role.eq_ignore_ascii_case("system") || role.eq_ignore_ascii_case("developer")
}

#[tauri::command]
pub(crate) async fn set_system_prompt_filter_enabled<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = resolve_paths(&app)?;
        let mut state = read_state(&paths);
        state.system_prompt_filter_enabled = enabled;
        write_state(&paths, &state)?;
        set_system_prompt_filter_runtime_enabled(enabled);
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        Ok(status(&app))
    })
    .await
    .map_err(|error| format!("System prompt filter update task failed: {error}"))?
}

#[cfg(test)]
mod system_prompt_filter_tests {
    use super::filter_system_prompts_when_enabled;
    use serde_json::{json, Value};

    fn filtered(value: Value) -> Value {
        let body = serde_json::to_vec(&value).expect("request should serialize");
        serde_json::from_slice(&filter_system_prompts_when_enabled(body))
            .expect("filtered request should be valid JSON")
    }

    #[test]
    fn removes_responses_system_instructions_and_messages() {
        let value = filtered(json!({
            "instructions": "Obey the system",
            "input": [
                { "role": "developer", "content": "Developer prompt" },
                { "role": "user", "content": "Keep this" }
            ]
        }));

        assert!(value.get("instructions").is_none());
        assert_eq!(value["input"].as_array().map(Vec::len), Some(1));
        assert_eq!(value["input"][0]["role"], "user");
    }

    #[test]
    fn removes_chat_and_anthropic_system_prompts() {
        let value = filtered(json!({
            "system": [{ "type": "text", "text": "Anthropic prompt" }],
            "messages": [
                { "role": "SYSTEM", "content": "System prompt" },
                { "role": "assistant", "content": "Keep this" }
            ]
        }));

        assert!(value.get("system").is_none());
        assert_eq!(value["messages"].as_array().map(Vec::len), Some(1));
        assert_eq!(value["messages"][0]["role"], "assistant");
    }

    #[test]
    fn leaves_invalid_json_unchanged() {
        let body = b"not-json".to_vec();
        assert_eq!(filter_system_prompts_when_enabled(body.clone()), body);
    }
}
