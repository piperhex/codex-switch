use std::{io::Read, time::Duration};

use reqwest::blocking::Client;
use serde_json::Value;
use url::Url;

use crate::models::ProviderBalancePlatform;

const DETECTION_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_DETECTION_RESPONSE_BYTES: u64 = 256 * 1024;

#[tauri::command]
pub(crate) async fn detect_relay_platform(
    base_url: String,
    api_key: String,
) -> Result<Option<ProviderBalancePlatform>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        detect_relay_platform_blocking(&base_url, &api_key)
    })
    .await
    .map_err(|error| format!("Relay platform detection task failed: {error}"))?
}

fn detect_relay_platform_blocking(
    base_url: &str,
    api_key: &str,
) -> Result<Option<ProviderBalancePlatform>, String> {
    let token = api_key.trim();
    if token.is_empty() {
        return Ok(None);
    }
    let root = relay_root(base_url)?;
    let client = crate::system_proxy::apply(Client::builder())
        .timeout(DETECTION_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Codex-Switch")
        .build()
        .map_err(|error| format!("Failed to create relay detection client: {error}"))?;

    for (platform, path) in [
        (ProviderBalancePlatform::NewApi, "/api/usage/token/"),
        (ProviderBalancePlatform::Sub2Api, "/v1/usage"),
    ] {
        let query_url = format!("{root}{path}");
        let response = match client.get(&query_url).bearer_auth(token).send() {
            Ok(response) => response,
            Err(_) => continue,
        };
        let payload = match read_detection_response(response) {
            Ok(payload) => payload,
            Err(_) => continue,
        };
        if matches_platform(platform, &payload) {
            return Ok(Some(platform));
        }
    }
    Ok(None)
}

fn relay_root(value: &str) -> Result<String, String> {
    let normalized = value.trim().trim_end_matches('/');
    crate::providers::ensure_not_local_proxy_base_url(normalized)?;
    let mut url =
        Url::parse(normalized).map_err(|error| format!("Provider Base URL is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Provider Base URL must be an http:// or https:// URL with a host".to_string());
    }
    let path = url.path().trim_end_matches('/').to_string();
    let root_path = path
        .strip_suffix("/api/v1")
        .or_else(|| path.strip_suffix("/v1"))
        .unwrap_or(&path);
    url.set_path(root_path.trim_end_matches('/'));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn read_detection_response(response: reqwest::blocking::Response) -> Result<Value, String> {
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > MAX_DETECTION_RESPONSE_BYTES)
    {
        return Err("Relay platform endpoint did not return a usable response".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_DETECTION_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read relay platform response: {error}"))?;
    if bytes.len() as u64 > MAX_DETECTION_RESPONSE_BYTES {
        return Err("Relay platform response is too large".to_string());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Relay platform response is invalid JSON: {error}"))
}

fn matches_platform(platform: ProviderBalancePlatform, payload: &Value) -> bool {
    match platform {
        ProviderBalancePlatform::NewApi => payload.get("data").is_some_and(|data| {
            data.get("total_available").is_some()
                || data.get("unlimited_quota").is_some()
                || data.get("quota").is_some()
        }),
        ProviderBalancePlatform::Sub2Api => {
            payload.get("remaining").is_some() && payload.get("unit").is_some()
        }
        ProviderBalancePlatform::DeepSeek => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{matches_platform, relay_root};
    use crate::models::ProviderBalancePlatform;

    #[test]
    fn recognizes_new_api_usage_payload() {
        assert!(matches_platform(
            ProviderBalancePlatform::NewApi,
            &json!({"data": {"total_available": 1000}})
        ));
    }

    #[test]
    fn recognizes_sub2api_usage_payload() {
        assert!(matches_platform(
            ProviderBalancePlatform::Sub2Api,
            &json!({"remaining": 12.5, "unit": "USD"})
        ));
    }

    #[test]
    fn rejects_payloads_from_other_platforms() {
        assert!(!matches_platform(
            ProviderBalancePlatform::NewApi,
            &json!({"remaining": 12.5, "unit": "USD"})
        ));
        assert!(!matches_platform(
            ProviderBalancePlatform::Sub2Api,
            &json!({"data": {"total_available": 1000}})
        ));
    }

    #[test]
    fn strips_openai_compatible_api_suffix_before_probing_platform_endpoints() {
        assert_eq!(
            relay_root("https://relay.example.com/api/v1/").unwrap(),
            "https://relay.example.com"
        );
        assert_eq!(
            relay_root("https://relay.example.com/v1").unwrap(),
            "https://relay.example.com"
        );
    }
}
