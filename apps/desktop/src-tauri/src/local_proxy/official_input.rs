use serde_json::Value;

const OFFICIAL_MESSAGE_ID_PREFIX: &str = "msg_";

/// Replay complete messages from other providers without their incompatible IDs.
pub(super) fn remove_incompatible_message_ids(request: &mut Value) -> bool {
    request.get_mut("input").is_some_and(clean_input)
}

fn clean_input(input: &mut Value) -> bool {
    if let Value::Array(items) = input {
        let mut changed = false;
        for item in items {
            changed |= clean_input(item);
        }
        return changed;
    }
    let Some(message) = input.as_object_mut() else {
        return false;
    };
    let is_message = match message.get("type").and_then(Value::as_str) {
        Some("message") => true,
        None => matches!(
            message.get("role").and_then(Value::as_str),
            Some("assistant" | "user" | "system" | "developer")
        ),
        _ => false,
    };
    let has_content = matches!(
        message.get("content"),
        Some(Value::String(_) | Value::Array(_))
    );
    let incompatible_id = message
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|id| !id.starts_with(OFFICIAL_MESSAGE_ID_PREFIX));
    if !is_message || !has_content || !incompatible_id {
        return false;
    }
    // Complete history messages can be replayed without an ID. Do not invent a
    // stored-message reference, rewrite tool call IDs, or traverse message content.
    message.remove("id");
    true
}
