use std::{io::Read, time::Duration};

use reqwest::blocking::Client;
use serde_json::Value;
use url::Url;

const MAX_MODEL_RESPONSE_BYTES: u64 = 1024 * 1024;
const MODEL_QUERY_TIMEOUT: Duration = Duration::from_secs(15);

#[tauri::command]
pub(crate) async fn fetch_relay_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_relay_models_blocking(&base_url, &api_key))
        .await
        .map_err(|error| format!("Relay model query task failed: {error}"))?
}

fn fetch_relay_models_blocking(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let token = api_key.trim();
    if token.is_empty() {
        return Err("Relay API key is required before fetching models".to_string());
    }
    let query_url = relay_models_url(base_url)?;
    let client = Client::builder()
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
