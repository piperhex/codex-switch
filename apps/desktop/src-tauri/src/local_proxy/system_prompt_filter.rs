const MAX_SYSTEM_PROMPT_FILTER_RULES: usize = 100;
const MAX_SYSTEM_PROMPT_FILTER_RULE_CHARS: usize = 500;

static SYSTEM_PROMPT_FILTER_ENABLED: AtomicBool = AtomicBool::new(false);
static SYSTEM_PROMPT_FILTER_RULES: OnceLock<RwLock<Vec<String>>> = OnceLock::new();

fn system_prompt_filter_rules() -> &'static RwLock<Vec<String>> {
    SYSTEM_PROMPT_FILTER_RULES.get_or_init(|| RwLock::new(Vec::new()))
}

fn set_system_prompt_filter_runtime_config(enabled: bool, rules: Vec<String>) {
    let mut stored_rules = match system_prompt_filter_rules().write() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *stored_rules = rules.into_iter().map(|rule| rule.to_lowercase()).collect();
    SYSTEM_PROMPT_FILTER_ENABLED.store(enabled, Ordering::Relaxed);
}

fn runtime_system_prompt_filter_rules() -> Vec<String> {
    match system_prompt_filter_rules().read() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn filter_system_prompts(body: Vec<u8>) -> Vec<u8> {
    if !SYSTEM_PROMPT_FILTER_ENABLED.load(Ordering::Relaxed) {
        return body;
    }
    let rules = runtime_system_prompt_filter_rules();
    filter_system_prompts_when_enabled(body, &rules)
}

fn filter_system_prompts_when_enabled(body: Vec<u8>, rules: &[String]) -> Vec<u8> {
    if rules.is_empty() {
        return body;
    }
    let Ok(value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    let value = remove_matching_system_prompts(value, rules);
    serde_json::to_vec(&value).unwrap_or(body)
}

fn filter_system_prompt_value(value: Value) -> Value {
    if !SYSTEM_PROMPT_FILTER_ENABLED.load(Ordering::Relaxed) {
        return value;
    }
    remove_matching_system_prompts(value, &runtime_system_prompt_filter_rules())
}

fn remove_matching_system_prompts(mut value: Value, rules: &[String]) -> Value {
    if rules.is_empty() {
        return value;
    }
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    remove_matching_field(object, "instructions", rules);
    remove_matching_field(object, "system", rules);
    remove_matching_system_messages(object.get_mut("messages"), rules);
    remove_matching_system_messages(object.get_mut("input"), rules);
    value
}

fn remove_matching_field(
    object: &mut serde_json::Map<String, Value>,
    field: &str,
    rules: &[String],
) {
    if object
        .get(field)
        .is_some_and(|value| content_matches_rules(value, rules))
    {
        object.remove(field);
    }
}

fn remove_matching_system_messages(value: Option<&mut Value>, rules: &[String]) {
    let Some(Value::Array(messages)) = value else {
        return;
    };
    messages.retain(|message| {
        let is_system_message = message
            .get("role")
            .and_then(Value::as_str)
            .is_some_and(is_system_role);
        let matches = message
            .get("content")
            .is_some_and(|content| content_matches_rules(content, rules));
        !is_system_message || !matches
    });
}

fn content_matches_rules(content: &Value, rules: &[String]) -> bool {
    match content {
        Value::String(text) => text_matches_rules(text, rules),
        Value::Array(items) => items
            .iter()
            .any(|item| content_matches_rules(item, rules)),
        Value::Object(object) => ["text", "content"]
            .iter()
            .filter_map(|key| object.get(*key))
            .any(|value| content_matches_rules(value, rules)),
        _ => false,
    }
}

fn text_matches_rules(text: &str, rules: &[String]) -> bool {
    let normalized_text = text.to_lowercase();
    rules.iter().any(|rule| normalized_text.contains(rule))
}

fn is_system_role(role: &str) -> bool {
    role.eq_ignore_ascii_case("system") || role.eq_ignore_ascii_case("developer")
}

fn normalize_system_prompt_filter_rules(rules: Vec<String>) -> Result<Vec<String>, String> {
    if rules.len() > MAX_SYSTEM_PROMPT_FILTER_RULES {
        return Err(format!(
            "You can add up to {MAX_SYSTEM_PROMPT_FILTER_RULES} filter rules"
        ));
    }
    let mut normalized_rules = Vec::with_capacity(rules.len());
    let mut seen = HashSet::with_capacity(rules.len());
    for rule in rules {
        let trimmed = rule.trim();
        if trimmed.is_empty() {
            return Err("Filter rules cannot be empty".to_string());
        }
        if trimmed.chars().count() > MAX_SYSTEM_PROMPT_FILTER_RULE_CHARS {
            return Err(format!(
                "Each filter rule can contain up to {MAX_SYSTEM_PROMPT_FILTER_RULE_CHARS} characters"
            ));
        }
        let normalized = trimmed.to_lowercase();
        if seen.insert(normalized) {
            normalized_rules.push(trimmed.to_string());
        }
    }
    Ok(normalized_rules)
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
        set_system_prompt_filter_runtime_config(enabled, state.system_prompt_filter_rules);
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        Ok(status(&app))
    })
    .await
    .map_err(|error| format!("System prompt filter update task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_system_prompt_filter_rules<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    rules: Vec<String>,
) -> Result<LocalProxyStatus, String> {
    let normalized_rules = normalize_system_prompt_filter_rules(rules)?;
    tauri::async_runtime::spawn_blocking(move || {
        let paths = resolve_paths(&app)?;
        let mut state = read_state(&paths);
        state.system_prompt_filter_rules = normalized_rules.clone();
        write_state(&paths, &state)?;
        set_system_prompt_filter_runtime_config(
            state.system_prompt_filter_enabled,
            normalized_rules,
        );
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        Ok(status(&app))
    })
    .await
    .map_err(|error| format!("System prompt filter rule update task failed: {error}"))?
}

#[cfg(test)]
mod system_prompt_filter_tests {
    use super::{
        filter_system_prompts_when_enabled, normalize_system_prompt_filter_rules,
        MAX_SYSTEM_PROMPT_FILTER_RULES, MAX_SYSTEM_PROMPT_FILTER_RULE_CHARS,
    };
    use serde_json::{json, Value};

    fn filtered(value: Value, rules: &[&str]) -> Value {
        let body = serde_json::to_vec(&value).expect("request should serialize");
        let rules = rules.iter().map(|rule| rule.to_string()).collect::<Vec<_>>();
        serde_json::from_slice(&filter_system_prompts_when_enabled(body, &rules))
            .expect("filtered request should be valid JSON")
    }

    #[test]
    fn removes_only_matching_responses_instructions() {
        let matching = filtered(json!({ "instructions": "Run INTERNAL workflow" }), &["internal"]);
        let unmatched = filtered(json!({ "instructions": "Keep this prompt" }), &["internal"]);

        assert!(matching.get("instructions").is_none());
        assert_eq!(unmatched["instructions"], "Keep this prompt");
    }

    #[test]
    fn removes_only_matching_system_and_developer_messages() {
        let value = filtered(
            json!({
                "messages": [
                    { "role": "system", "content": "Remove secret policy" },
                    { "role": "developer", "content": "Keep this instruction" },
                    { "role": "user", "content": "secret policy" },
                    { "role": "assistant", "content": "secret policy" },
                    { "role": "tool", "content": "secret policy" }
                ]
            }),
            &["secret policy"],
        );

        assert_eq!(value["messages"].as_array().map(Vec::len), Some(4));
        assert_eq!(value["messages"][0]["role"], "developer");
        assert_eq!(value["messages"][1]["role"], "user");
        assert_eq!(value["messages"][2]["role"], "assistant");
        assert_eq!(value["messages"][3]["role"], "tool");
    }

    #[test]
    fn matches_structured_anthropic_system_content() {
        let value = filtered(
            json!({
                "system": [{ "type": "text", "text": "Private bootstrap prompt" }],
                "messages": [{ "role": "user", "content": "Keep this" }]
            }),
            &["bootstrap"],
        );

        assert!(value.get("system").is_none());
        assert_eq!(value["messages"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn leaves_request_unchanged_when_rules_are_empty_or_json_is_invalid() {
        let value = json!({ "instructions": "Keep everything" });
        assert_eq!(filtered(value.clone(), &[]), value);
        let body = b"not-json".to_vec();
        assert_eq!(
            filter_system_prompts_when_enabled(body.clone(), &["rule".to_string()]),
            body
        );
    }

    #[test]
    fn normalizes_and_deduplicates_rules() {
        let rules = normalize_system_prompt_filter_rules(vec![
            "  Internal Policy  ".to_string(),
            "internal policy".to_string(),
            "Another Rule".to_string(),
        ])
        .expect("rules should be valid");

        assert_eq!(rules, vec!["Internal Policy", "Another Rule"]);
        assert!(normalize_system_prompt_filter_rules(vec!["   ".to_string()]).is_err());
        let long_rule = "x".repeat(MAX_SYSTEM_PROMPT_FILTER_RULE_CHARS + 1);
        let too_many_rules = vec!["rule".to_string(); MAX_SYSTEM_PROMPT_FILTER_RULES + 1];
        assert!(normalize_system_prompt_filter_rules(vec![long_rule]).is_err());
        assert!(normalize_system_prompt_filter_rules(too_many_rules).is_err());
    }
}
