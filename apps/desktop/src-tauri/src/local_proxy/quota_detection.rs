use super::{
    UpstreamBody, UpstreamPayload, CODEX_QUOTA_EXHAUSTION_TYPES,
    CODEX_RATE_LIMIT_REACHED_TYPE_HEADER, CODEX_USAGE_LIMIT_REACHED_ERROR_TYPE,
};
use serde_json::Value;

const INSUFFICIENT_QUOTA_ERROR_CODE: &str = "insufficient_quota";

pub(super) fn is_official_quota_exhaustion(payload: &UpstreamPayload) -> bool {
    if payload.status != 429 {
        return false;
    }
    official_quota_exhaustion_body(payload) || official_quota_exhaustion_header(payload)
}

fn official_quota_exhaustion_body(payload: &UpstreamPayload) -> bool {
    let UpstreamBody::Buffered(body) = &payload.body else {
        return false;
    };
    serde_json::from_slice::<Value>(body)
        .ok()
        .is_some_and(|value| value.get("error").is_some_and(is_explicit_quota_error))
}

pub(super) fn is_explicit_quota_error(error: &Value) -> bool {
    // Keep a strict allowlist so transient token/request throttling cannot rotate accounts.
    ["type", "code"].into_iter().any(|field| {
        matches!(
            error.get(field).and_then(Value::as_str),
            Some(CODEX_USAGE_LIMIT_REACHED_ERROR_TYPE | INSUFFICIENT_QUOTA_ERROR_CODE)
        )
    })
}

fn official_quota_exhaustion_header(payload: &UpstreamPayload) -> bool {
    payload.response_headers.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case(CODEX_RATE_LIMIT_REACHED_TYPE_HEADER)
            && CODEX_QUOTA_EXHAUSTION_TYPES.contains(&value.trim().to_ascii_lowercase().as_str())
    })
}

#[cfg(test)]
#[path = "quota_detection_tests.rs"]
mod tests;
