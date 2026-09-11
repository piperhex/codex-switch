use super::*;
use crate::local_proxy::{json_payload, request_has_valid_api_key, UpstreamPayload};
use std::cell::RefCell;

thread_local! {
    static REQUEST_KEY: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Each tiny_http request runs on its own worker. Snapshot the authenticated identity
/// into the usage context so streaming accounting keeps it after request dispatch.
pub(in crate::local_proxy) struct RequestKeyScope(Option<String>);

impl RequestKeyScope {
    pub(in crate::local_proxy) fn enter(key_id: Option<String>) -> Self {
        Self(REQUEST_KEY.replace(key_id))
    }

    pub(in crate::local_proxy) fn current() -> Option<String> {
        REQUEST_KEY.with_borrow(Clone::clone)
    }
}

impl Drop for RequestKeyScope {
    fn drop(&mut self) {
        REQUEST_KEY.set(self.0.take());
    }
}

pub(in crate::local_proxy) fn is_quota_endpoint(path: &str) -> bool {
    matches!(path, "/v1/codex-switch/quota" | "/codex-switch/quota")
}

fn authenticated_key<'a>(
    keys: &'a [LocalProxyLanApiKey],
    headers: &[(String, String)],
    require_key: bool,
) -> Result<Option<&'a LocalProxyLanApiKey>, LanKeyError> {
    if conflicting_credentials(headers) {
        return Err(LanKeyError::Unauthorized);
    }
    let key = keys
        .iter()
        .find(|key| request_has_valid_api_key(headers, &key.api_key));
    match key {
        Some(key) if key.enabled => Ok(Some(key)),
        Some(_) => Err(LanKeyError::Unauthorized),
        None if require_key => Err(LanKeyError::Unauthorized),
        None => Ok(None),
    }
}

pub(in crate::local_proxy) fn authorize_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    headers: &[(String, String)],
    is_loopback: bool,
    quota_query: bool,
) -> Result<Option<LocalProxyLanApiKeySummary>, LanKeyError> {
    let paths = storage::resolve_paths(app).map_err(|_| LanKeyError::Unavailable)?;
    let state = storage::try_read_state(&paths).map_err(|_| LanKeyError::Unavailable)?;
    let keys = configured_keys(&state);
    let Some(key) = authenticated_key(&keys, headers, !is_loopback || quota_query)? else {
        return Ok(None);
    };
    let usage = ledger::load_all(&paths)?
        .get(&key.id)
        .copied()
        .unwrap_or_default();
    Ok(Some(summary(key, usage)))
}

pub(in crate::local_proxy) fn quota_payload(key: &LocalProxyLanApiKeySummary) -> UpstreamPayload {
    let mut payload = json_payload(
        200,
        serde_json::json!({
            "object": "codex_switch_quota",
            "quotaUsd": key.quota_usd,
            "usedCostUsd": key.used_cost_usd,
            "remainingUsd": key.remaining_usd,
            "usedTokens": key.used_tokens,
            "unlimited": key.quota_usd.is_none(),
            "usageIncomplete": key.usage_incomplete,
            "unit": "USD",
        }),
    );
    payload
        .response_headers
        .push(("Cache-Control".into(), "no-store".into()));
    payload
}

fn conflicting_credentials(headers: &[(String, String)]) -> bool {
    let mut first = None;
    for (name, value) in headers {
        let name = name.to_ascii_lowercase();
        let secret = match name.as_str() {
            "x-api-key" | "openai-api-key" | "api-key" => Some(value.trim()),
            "authorization"
                if value
                    .trim()
                    .get(..7)
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case("bearer ")) =>
            {
                Some(value.trim()[7..].trim())
            }
            _ => None,
        };
        let Some(secret) = secret.filter(|secret| !secret.is_empty()) else {
            continue;
        };
        if first.is_some_and(|first| !crate::local_proxy::api_keys_equal(first, secret)) {
            return true;
        }
        first = Some(secret);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authentication_handles_each_key_and_keeps_internal_loopback_compatible() {
        let mut disabled = legacy_key("disabled-secret");
        disabled.enabled = false;
        let keys = vec![
            legacy_key("first-secret"),
            legacy_key("second-secret"),
            disabled,
        ];
        for secret in ["first-secret", "second-secret"] {
            let headers = vec![("Authorization".into(), format!("Bearer {secret}"))];
            assert_eq!(
                authenticated_key(&keys, &headers, true)
                    .unwrap()
                    .unwrap()
                    .api_key,
                secret
            );
        }
        assert!(authenticated_key(&keys, &[], true).is_err());
        assert!(authenticated_key(&keys, &[], false).unwrap().is_none());
        let disabled = vec![("x-api-key".into(), "disabled-secret".into())];
        assert!(authenticated_key(&keys, &disabled, false).is_err());
    }

    #[test]
    fn quota_payload_only_exposes_current_key_balance_even_when_exhausted() {
        let mut key = legacy_key("secret");
        key.quota_usd = Some(1.0);
        let summary = summary(
            &key,
            ledger::KeyUsage {
                tokens: 123,
                cost_usd: 1.5,
                incomplete: false,
            },
        );
        let payload = quota_payload(&summary);
        assert_eq!(payload.status, 200);
        let crate::local_proxy::UpstreamBody::Buffered(body) = payload.body else {
            panic!("expected JSON")
        };
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["remainingUsd"], 0.0);
        assert_eq!(body["usedTokens"], 123);
        assert_eq!(body["unlimited"], false);
        assert!(body.get("apiKey").is_none());
        assert!(body.get("name").is_none());
    }
}
