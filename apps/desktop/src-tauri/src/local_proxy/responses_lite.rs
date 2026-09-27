//! Keep the Lite header and reasoning context consistent at the final transport boundary.
use std::io::Read;

use serde_json::{json, Value};
use tiny_http::Method;

const LITE_HEADER: &str = "x-openai-internal-codex-responses-lite";
const ALL_TURNS: &str = "all_turns";
const MAX_DECODED_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub(super) enum RequestError {
    #[error("请求格式不兼容，请重新连接 Codex 后重试。")]
    InvalidBody,
    #[error("请求压缩格式不兼容，请重新连接 Codex 后重试。")]
    InvalidEncoding,
}

pub(super) fn enabled(headers: &[(String, String)]) -> bool {
    headers.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case(LITE_HEADER) && value.trim().eq_ignore_ascii_case("true")
    })
}

/// Also runs for resumed turns and compaction; no thread state or model-cache lookup is needed.
pub(super) fn prepare(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
) -> Result<Vec<u8>, RequestError> {
    if *method != Method::Post || !is_responses_url(url) || !enabled(headers) {
        return Ok(body);
    }
    let encoding = super::header_value(headers, "content-encoding").unwrap_or("identity");
    let decoded = decode(&body, encoding)?;
    let mut request: Value =
        serde_json::from_slice(&decoded).map_err(|_| RequestError::InvalidBody)?;
    let object = request.as_object_mut().ok_or(RequestError::InvalidBody)?;
    let reasoning = object.entry("reasoning").or_insert_with(|| json!({}));
    if reasoning.is_null() {
        *reasoning = json!({});
    }
    let reasoning = reasoning.as_object_mut().ok_or(RequestError::InvalidBody)?;
    if reasoning.get("context").and_then(Value::as_str) == Some(ALL_TURNS) {
        return Ok(body);
    }
    reasoning.insert("context".into(), json!(ALL_TURNS));
    let encoded = serde_json::to_vec(&request).map_err(|_| RequestError::InvalidBody)?;
    let encoded = encode(&encoded, encoding)?;
    super::diagnostic_event(json!({ "event": "responses_lite_context_repaired" }));
    Ok(encoded)
}

fn is_responses_url(value: &str) -> bool {
    let url = url::Url::parse(value).ok();
    let path = url.as_ref().map_or(value, url::Url::path);
    let path = path.strip_prefix("/backend-api/codex").unwrap_or(path);
    super::is_responses_endpoint(super::request_path(path))
}

fn decode(body: &[u8], encoding: &str) -> Result<Vec<u8>, RequestError> {
    let reader: Box<dyn Read + '_> = match encoding.trim().to_ascii_lowercase().as_str() {
        "" | "identity" => Box::new(body),
        "zstd" => Box::new(
            zstd::stream::read::Decoder::new(body).map_err(|_| RequestError::InvalidEncoding)?,
        ),
        "gzip" => Box::new(flate2::read::GzDecoder::new(body)),
        _ => return Err(RequestError::InvalidEncoding),
    };
    let mut decoded = Vec::new();
    reader
        .take(MAX_DECODED_BYTES + 1)
        .read_to_end(&mut decoded)
        .map_err(|_| RequestError::InvalidEncoding)?;
    if decoded.len() as u64 > MAX_DECODED_BYTES {
        return Err(RequestError::InvalidBody);
    }
    Ok(decoded)
}

fn encode(body: &[u8], encoding: &str) -> Result<Vec<u8>, RequestError> {
    match encoding.trim().to_ascii_lowercase().as_str() {
        "" | "identity" => Ok(body.to_vec()),
        "zstd" => zstd::stream::encode_all(body, 0).map_err(|_| RequestError::InvalidEncoding),
        "gzip" => {
            let mut encoder = flate2::read::GzEncoder::new(body, flate2::Compression::default());
            let mut encoded = Vec::new();
            encoder
                .read_to_end(&mut encoded)
                .map_err(|_| RequestError::InvalidEncoding)?;
            Ok(encoded)
        }
        _ => Err(RequestError::InvalidEncoding),
    }
}

/// A third-party catalog is not evidence that its gateway implements the internal Lite protocol.
/// Apply the compatibility default on every refresh; explicit local catalogs remain a CLI override.
pub(super) fn provider_catalog(
    mut payload: super::UpstreamPayload,
) -> Result<super::UpstreamPayload, String> {
    if payload.status != 200 {
        return Ok(payload);
    }
    let bytes = super::read_official_model_catalog_body(&mut payload.body)?;
    let mut catalog: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "暂时无法读取 Provider 模型列表，请重试。".to_string())?;
    if let Some(models) = catalog.get_mut("models").and_then(Value::as_array_mut) {
        for model in models.iter_mut().filter(|model| model.is_object()) {
            model["use_responses_lite"] = json!(false);
        }
    }
    let bytes = serde_json::to_vec(&catalog)
        .map_err(|_| "暂时无法读取 Provider 模型列表，请重试。".to_string())?;
    super::replace_model_catalog_etags(&mut payload.response_headers, &bytes);
    payload.body = super::UpstreamBody::Buffered(bytes);
    Ok(payload)
}

#[cfg(test)]
#[path = "responses_lite_tests.rs"]
mod tests;
