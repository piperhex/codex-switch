use crate::models::ProxyConversationAttachment;

const MAX_CONVERSATION_ATTACHMENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_CONVERSATION_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_CONVERSATION_ATTACHMENTS: usize = 32;
const MAX_CONVERSATION_CACHE_ENTRIES: usize = 512;

#[derive(Default)]
struct ConversationAttachmentCache {
    entries: VecDeque<(String, Arc<str>)>,
    bytes: usize,
}

impl ConversationAttachmentCache {
    fn insert(&mut self, source: String) -> String {
        let id = format!("{:x}", Sha256::digest(source.as_bytes()));
        if source.len() > MAX_CONVERSATION_ATTACHMENT_BYTES {
            return id;
        }
        if let Some(index) = self.entries.iter().position(|(key, _)| key == &id) {
            if let Some(entry) = self.entries.remove(index) {
                self.entries.push_back(entry);
            }
            return id;
        }
        while self.bytes + source.len() > MAX_CONVERSATION_CACHE_BYTES
            || self.entries.len() >= MAX_CONVERSATION_CACHE_ENTRIES
        {
            if let Some((_, removed)) = self.entries.pop_front() {
                self.bytes -= removed.len();
            }
        }
        self.bytes += source.len();
        self.entries.push_back((id.clone(), Arc::from(source)));
        id
    }
}

fn conversation_attachment_cache() -> &'static Mutex<ConversationAttachmentCache> {
    static CACHE: OnceLock<Mutex<ConversationAttachmentCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(ConversationAttachmentCache::default()))
}

#[tauri::command]
pub(crate) async fn get_proxy_conversation_attachment(
    id: String,
) -> Result<Option<String>, String> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid attachment".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let source = conversation_attachment_cache()
            .lock()
            .map_err(|_| "Attachment unavailable".to_string())?
            .entries
            .iter()
            .find(|(key, _)| key == &id)
            .map(|(_, source)| Arc::clone(source));
        Ok(source.map(|source| source.to_string()))
    })
    .await
    .map_err(|_| "Attachment unavailable".to_string())?
}

fn safe_conversation_image_source(source: &str) -> bool {
    if let Some(data) = source.strip_prefix("data:image/") {
        return [
            "png;base64,",
            "jpeg;base64,",
            "jpg;base64,",
            "webp;base64,",
            "gif;base64,",
        ]
        .iter()
        .any(|prefix| data.starts_with(prefix));
    }
    url::Url::parse(source).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
    })
}

fn conversation_image_source(value: &Value) -> Option<String> {
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let url = value
        .get("image_url")
        .and_then(|url| url.as_str().or_else(|| url.get("url")?.as_str()));
    if let Some(url) = url {
        return Some(url.to_string());
    }
    if kind == "image" {
        let source = value.get("source")?;
        if let Some(url) = source.get("url").and_then(Value::as_str) {
            return Some(url.to_string());
        }
        return Some(format!(
            "data:{};base64,{}",
            source.get("media_type")?.as_str()?,
            source.get("data")?.as_str()?
        ));
    }
    let encoded = value.get("b64_json").and_then(Value::as_str).or_else(|| {
        (kind == "image_generation_call")
            .then(|| value.get("result")?.as_str())
            .flatten()
    });
    if let Some(encoded) = encoded {
        let format = value
            .get("output_format")
            .and_then(Value::as_str)
            .unwrap_or("png");
        let format = if format == "jpg" { "jpeg" } else { format };
        return Some(format!("data:image/{format};base64,{encoded}"));
    }
    None
}

fn extract_conversation_attachments(
    value: &mut Value,
    attachments: &mut Vec<ProxyConversationAttachment>,
) {
    if let Some(source) = conversation_image_source(value) {
        replace_conversation_image(value, source, attachments);
        return;
    }
    if matches!(
        value.get("type").and_then(Value::as_str),
        Some("input_image" | "output_image" | "image")
    ) {
        replace_conversation_image(value, String::new(), attachments);
        return;
    }
    match value {
        Value::Array(values) => {
            for value in values {
                extract_conversation_attachments(value, attachments);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                extract_conversation_attachments(value, attachments);
            }
        }
        _ => {}
    }
}

fn replace_conversation_image(
    value: &mut Value,
    source: String,
    attachments: &mut Vec<ProxyConversationAttachment>,
) {
    if attachments.len() >= MAX_CONVERSATION_ATTACHMENTS {
        *value = json!({ "type": "image_attachment", "omitted": true });
        return;
    }
    let id = if safe_conversation_image_source(&source) {
        conversation_attachment_cache()
            .lock()
            .ok()
            .map(|mut cache| cache.insert(source))
    } else {
        None
    }
    .unwrap_or_else(|| format!("{:x}", Sha256::digest(uuid::Uuid::new_v4().as_bytes())));
    *value = json!({ "type": "image_attachment", "attachment": attachments.len() + 1 });
    attachments.push(ProxyConversationAttachment { id });
}

#[derive(Default)]
struct CapturedConversation {
    text: Option<String>,
    attachments: Vec<ProxyConversationAttachment>,
}

fn capture_conversation_value(mut value: Value) -> CapturedConversation {
    let mut attachments = Vec::new();
    extract_conversation_attachments(&mut value, &mut attachments);
    CapturedConversation {
        text: serde_json::to_string_pretty(&value)
            .ok()
            .map(limit_conversation_text),
        attachments,
    }
}

fn capture_request_conversation(body: &[u8]) -> CapturedConversation {
    let Ok(mut value) = serde_json::from_slice::<Value>(body) else {
        return CapturedConversation::default();
    };
    if value.get("images").is_some() || value.get("image").is_some() {
        let fields = ["prompt", "images", "image", "mask"]
            .into_iter()
            .filter_map(|key| {
                value
                    .get_mut(key)
                    .map(|value| (key.to_string(), value.take()))
            })
            .collect::<serde_json::Map<_, _>>();
        return capture_conversation_value(Value::Object(fields));
    }
    let conversation = ["messages", "input", "prompt"]
        .iter()
        .find_map(|key| value.get_mut(key).map(Value::take));
    conversation
        .map(capture_conversation_value)
        .unwrap_or_default()
}

fn limit_conversation_text(text: String) -> String {
    if proxy_session_unlimited_conversation().load(Ordering::Relaxed) {
        return text;
    }
    let mut chars = text.chars();
    let mut truncated: String = chars
        .by_ref()
        .take(MAX_PROXY_SESSION_CONVERSATION_CHARS)
        .collect();
    if chars.next().is_some() {
        truncated.push_str("\n…");
    }
    truncated
}
