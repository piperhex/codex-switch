//! The signature envelope identifies reasoning produced by this bridge. Native Claude
//! signatures must never be mistaken for Responses ciphertext.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SIGNATURE_PREFIX: &str = "csw-reasoning-v1:";
const MAX_SIGNATURE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct ReasoningSignature {
    id: Option<String>,
    encrypted_content: Option<String>,
    summary: Option<Vec<Value>>,
}

pub(super) fn signature(item: &Value) -> String {
    let envelope = ReasoningSignature {
        id: item.get("id").and_then(Value::as_str).map(str::to_owned),
        encrypted_content: item
            .get("encrypted_content")
            .and_then(Value::as_str)
            .map(str::to_owned),
        summary: item.get("summary").and_then(Value::as_array).cloned(),
    };
    // Strings and JSON values cannot fail serialization; keep the boundary non-panicking.
    match serde_json::to_vec(&envelope) {
        Ok(bytes) => format!("{SIGNATURE_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes)),
        Err(_) => String::new(),
    }
}

pub(super) fn restore(block: &Value) -> Value {
    let text = block
        .get("thinking")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut item =
        json!({ "type": "reasoning", "summary": [{ "type": "summary_text", "text": text }] });
    if let Some(signature) = decode_signature(block) {
        if let Some(id) = signature.id {
            item["id"] = json!(id);
        }
        if let Some(ciphertext) = signature.encrypted_content {
            item["encrypted_content"] = json!(ciphertext);
        }
        if let Some(summary) = signature.summary {
            item["summary"] = json!(summary);
        }
    }
    if item.get("id").is_none() {
        item["id"] = json!(format!(
            "{}{}",
            super::LOCAL_REASONING_ITEM_ID_PREFIX,
            uuid::Uuid::new_v4()
        ));
    }
    item
}

fn decode_signature(block: &Value) -> Option<ReasoningSignature> {
    let encoded = block
        .get("signature")?
        .as_str()?
        .strip_prefix(SIGNATURE_PREFIX)?;
    if encoded.len() > MAX_SIGNATURE_BYTES {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    serde_json::from_slice(&bytes).ok()
}
