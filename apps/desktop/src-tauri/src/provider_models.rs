use std::{io::Read, time::Duration};

use reqwest::blocking::Client;
use serde_json::Value;
use tauri::Runtime;
use url::Url;

use crate::{models::ProviderProfile, providers::read_provider, storage::resolve_paths};

const MAX_MODEL_RESPONSE_BYTES: u64 = 1024 * 1024;
const MODEL_QUERY_TIMEOUT: Duration = Duration::from_secs(15);

#[tauri::command]
pub(crate) async fn fetch_relay_models<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: String,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let token = required_api_key(&app, &base_url, &api_key, provider_id.as_deref())?;
        fetch_relay_models_blocking(&base_url, &token)
    })
    .await
    .map_err(|_| "Could not load models. Please try again".to_string())?
}

fn required_api_key<R: Runtime>(
    app: &tauri::AppHandle<R>,
    base_url: &str,
    api_key: &str,
    provider_id: Option<&str>,
) -> Result<String, String> {
    if !api_key.trim().is_empty() {
        return Ok(api_key.trim().to_string());
    }
    if let Some(id) = provider_id {
        let paths = resolve_paths(app).map_err(|_| "Saved provider could not be loaded")?;
        let provider =
            read_provider(&paths, id).map_err(|_| "Saved provider could not be loaded")?;
        if let Some(token) = reusable_api_key(&provider, base_url) {
            return Ok(token);
        }
    }
    Err("Enter the API key before loading models".to_string())
}

fn reusable_api_key(provider: &ProviderProfile, base_url: &str) -> Option<String> {
    // Reuse credentials only for the saved endpoint, including its API path.
    let saved_url = normalized_relay_models_url(&provider.base_url)?;
    let requested_url = relay_models_url(base_url).ok()?;
    (saved_url == requested_url)
        .then(|| provider.api_key.trim().to_string())
        .filter(|key| !key.is_empty())
}

fn normalized_relay_models_url(base_url: &str) -> Option<Url> {
    let mut url = relay_models_url(base_url).ok()?;
    let path = url.path().strip_suffix("/models")?.trim_end_matches('/');
    let root = if path.to_ascii_lowercase().ends_with("/v1") {
        &path[..path.len() - "/v1".len()]
    } else {
        path
    };
    url.set_path(&format!("{root}/v1/models"));
    Some(url)
}

pub(crate) fn fetch_relay_models_blocking(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let token = api_key.trim();
    if token.is_empty() {
        return Err("Relay API key is required before fetching models".to_string());
    }
    let query_url = relay_models_url(base_url)?;
    let client = crate::system_proxy::apply(Client::builder())
        .timeout(MODEL_QUERY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Codex-Switch")
        .build()
        .map_err(|error| format!("Failed to create relay model query client: {error}"))?;
    let response = client
        .get(query_url)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .map_err(|error| format!("Relay model query failed: {error}"))?;
    let payload = read_model_response(response)?;
    parse_models(&payload)
}

fn relay_models_url(base_url: &str) -> Result<Url, String> {
    let normalized = base_url.trim().trim_end_matches('/');
    crate::providers::ensure_not_local_proxy_base_url(normalized)?;
    let mut url =
        Url::parse(normalized).map_err(|error| format!("Relay Base URL is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Relay Base URL must be an http:// or https:// URL with a host".to_string());
    }
    let path = url.path().trim_end_matches('/');
    url.set_path(&format!("{path}/models"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn read_model_response(response: reqwest::blocking::Response) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Relay model query returned HTTP {}",
            status.as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODEL_RESPONSE_BYTES)
    {
        return Err("Relay model response is too large".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_MODEL_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read relay model response: {error}"))?;
    if bytes.len() as u64 > MAX_MODEL_RESPONSE_BYTES {
        return Err("Relay model response is too large".to_string());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Relay model response is invalid JSON: {error}"))
}

fn parse_models(payload: &Value) -> Result<Vec<String>, String> {
    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "Relay model response is missing data".to_string())?;
    let mut models = Vec::new();
    for item in data {
        let Some(model) = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty())
        else {
            continue;
        };
        if !models.iter().any(|existing| existing == model) {
            models.push(model.to_string());
        }
    }
    if models.is_empty() {
        Err("Relay did not return any available models".to_string())
    } else {
        Ok(models)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tiny_http::{Header, Response, Server};

    fn saved_provider() -> ProviderProfile {
        serde_json::from_value(json!({
            "id": "relay-test", "name": "Relay", "baseUrl": "https://relay.example.com/api/v1/",
            "apiKey": "sk-saved-test", "model": "gpt-6-astra", "apiFormat": "openaiResponses"
        }))
        .unwrap()
    }

    #[test]
    fn reuses_saved_credentials_only_for_the_same_relay_endpoint() {
        let mut provider = saved_provider();
        assert_eq!(
            reusable_api_key(&provider, "https://relay.example.com/api/v1").as_deref(),
            Some("sk-saved-test")
        );
        for url in [
            "https://other.example.com/api/v1",
            "http://relay.example.com/api/v1",
            "https://relay.example.com:444/api/v1",
            "https://relay.example.com/other/v1",
            "https://relay.example.com/api",
        ] {
            assert!(reusable_api_key(&provider, url).is_none());
        }
        provider.base_url = "https://relay.example.com/api".to_string();
        assert_eq!(
            reusable_api_key(&provider, "https://relay.example.com/api/v1").as_deref(),
            Some("sk-saved-test")
        );
        provider.api_key.clear();
        assert!(reusable_api_key(&provider, &provider.base_url).is_none());
    }

    #[test]
    fn builds_models_url_from_openai_compatible_base_url() {
        let url = relay_models_url("https://relay.example.com/api/v1/?ignored=yes").unwrap();
        assert_eq!(url.as_str(), "https://relay.example.com/api/v1/models");
    }

    #[test]
    fn parses_and_deduplicates_openai_model_lists() {
        let models = parse_models(&json!({
            "object": "list",
            "data": [
                { "id": "gpt-5.6-sol", "object": "model" },
                { "id": "claude-sonnet-4-5", "type": "model" },
                { "id": "gpt-5.6-sol", "object": "model" }
            ]
        }))
        .unwrap();

        assert_eq!(models, vec!["gpt-5.6-sol", "claude-sonnet-4-5"]);
    }

    #[test]
    fn fetches_models_with_bearer_authentication() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}/v1", server.server_addr());
        let worker = std::thread::spawn(move || {
            let request = server.recv().unwrap();
            assert_eq!(request.url(), "/v1/models");
            assert!(request.headers().iter().any(|header| {
                header.field.equiv("Authorization")
                    && header.value.as_str() == "Bearer sk-relay-test"
            }));
            request
                .respond(
                    Response::from_string(r#"{"object":"list","data":[{"id":"gpt-test"}]}"#)
                        .with_header(
                            Header::from_bytes("Content-Type", "application/json").unwrap(),
                        ),
                )
                .unwrap();
        });

        let models = fetch_relay_models_blocking(&base_url, "sk-relay-test").unwrap();

        assert_eq!(models, vec!["gpt-test"]);
        worker.join().unwrap();
    }
}
