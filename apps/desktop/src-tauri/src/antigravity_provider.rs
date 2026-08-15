use std::{collections::HashSet, io::Read, time::Duration};

use reqwest::blocking::Client;
use serde_json::Value;
use tauri::Runtime;
use url::Url;

use crate::{
    models::{ProviderApiFormat, ProviderKind, ProviderProfile},
    providers::read_provider,
    storage::resolve_paths,
};

const ANTIGRAVITY_PROVIDER_NAME: &str = "Google Antigravity";
const ANTIGRAVITY_GATEWAY_PORT: u16 = 51_122;
const MAX_MODEL_RESPONSE_BYTES: u64 = 1024 * 1024;

pub(crate) fn allows_missing_api_key(provider: &ProviderProfile) -> bool {
    is_antigravity_identity(
        provider.kind,
        &provider.name,
        &provider.base_url,
        provider.api_format,
    )
}

pub(crate) fn is_antigravity_identity(
    kind: ProviderKind,
    name: &str,
    base_url: &str,
    api_format: ProviderApiFormat,
) -> bool {
    kind == ProviderKind::Custom
        && name.trim() == ANTIGRAVITY_PROVIDER_NAME
        && api_format == ProviderApiFormat::OpenaiResponses
        && validate_base_url(base_url).is_ok()
}

#[tauri::command]
pub(crate) async fn fetch_antigravity_models<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_models_blocking(app, base_url, api_key, provider_id)
    })
    .await
    .map_err(|error| format!("Google Antigravity model query task failed: {error}"))?
}

fn fetch_models_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    let query_url = models_url(&base_url)?;
    let supplied_key = api_key.unwrap_or_default().trim().to_string();
    let token = saved_or_supplied_key(&app, supplied_key, provider_id)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Codex-Switch")
        .build()
        .map_err(|error| format!("Could not prepare the Google Antigravity connection: {error}"))?;
    let mut request = client
        .get(query_url)
        .header(reqwest::header::ACCEPT, "application/json");
    if !token.is_empty() {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .map_err(|error| format!("Could not connect to Google Antigravity: {error}"))?;
    let payload = read_model_response(response)?;
    parse_models(&payload)
}

fn saved_or_supplied_key<R: Runtime>(
    app: &tauri::AppHandle<R>,
    supplied_key: String,
    provider_id: Option<String>,
) -> Result<String, String> {
    if !supplied_key.is_empty() {
        return Ok(supplied_key);
    }
    let Some(provider_id) = provider_id else {
        return Ok(String::new());
    };
    let provider = read_provider(&resolve_paths(app)?, &provider_id)?;
    if !allows_missing_api_key(&provider) {
        return Err("The selected provider is not a Google Antigravity preset".to_string());
    }
    Ok(provider.api_key)
}

fn models_url(base_url: &str) -> Result<Url, String> {
    let mut url = validate_base_url(base_url)?;
    url.set_path("/v1/models");
    Ok(url)
}

fn validate_base_url(base_url: &str) -> Result<Url, String> {
    let url = Url::parse(base_url.trim())
        .map_err(|error| format!("Google Antigravity Base URL is invalid: {error}"))?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let is_loopback = matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1");
    let valid_path = url.path().trim_end_matches('/') == "/v1";
    let has_extra_parts = !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some();
    if url.scheme() != "http"
        || !is_loopback
        || url.port_or_known_default() != Some(ANTIGRAVITY_GATEWAY_PORT)
        || !valid_path
        || has_extra_parts
    {
        return Err(
            "Google Antigravity must use the local http://localhost:51122/v1 service".to_string(),
        );
    }
    Ok(url)
}

fn read_model_response(response: reqwest::blocking::Response) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Google Antigravity returned HTTP {}",
            status.as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODEL_RESPONSE_BYTES)
    {
        return Err("Google Antigravity returned too much model data".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_MODEL_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read Google Antigravity models: {error}"))?;
    if bytes.len() as u64 > MAX_MODEL_RESPONSE_BYTES {
        return Err("Google Antigravity returned too much model data".to_string());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Google Antigravity returned invalid model data: {error}"))
}

fn parse_models(payload: &Value) -> Result<Vec<String>, String> {
    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "Google Antigravity model data is missing".to_string())?;
    let mut seen = HashSet::new();
    let models = data
        .iter()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|model| !model.is_empty() && seen.insert((*model).to_string()))
        .map(str::to_string)
        .collect::<Vec<_>>();
    if models.is_empty() {
        Err("Google Antigravity did not return any available models".to_string())
    } else {
        Ok(models)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn accepts_the_default_loopback_gateway_only() {
        assert!(validate_base_url("http://localhost:51122/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:51122/v1/").is_ok());
        assert!(validate_base_url("https://localhost:51122/v1").is_err());
        assert!(validate_base_url("http://localhost:3000/v1").is_err());
        assert!(validate_base_url("http://example.com:51122/v1").is_err());
        assert!(validate_base_url("http://localhost:51122/v1?token=value").is_err());
    }

    #[test]
    fn parses_and_deduplicates_models() {
        let models = parse_models(&json!({
            "data": [
                { "id": "claude-3.5-sonnet" },
                { "id": "gemini-3.5-flash-high" },
                { "id": "claude-3.5-sonnet" },
                { "id": " " }
            ]
        }))
        .unwrap();

        assert_eq!(models, vec!["claude-3.5-sonnet", "gemini-3.5-flash-high"]);
    }
}
