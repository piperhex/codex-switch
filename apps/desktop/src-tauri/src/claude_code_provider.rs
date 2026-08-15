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

const CLAUDE_CODE_PROVIDER_NAME: &str = "Claude Code";
const CLAUDE_API_HOST: &str = "api.anthropic.com";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_MODEL_RESPONSE_BYTES: u64 = 1024 * 1024;
const MODEL_QUERY_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) fn is_claude_code_identity(
    kind: ProviderKind,
    name: &str,
    base_url: &str,
    api_format: ProviderApiFormat,
) -> bool {
    kind == ProviderKind::Custom
        && name.trim() == CLAUDE_CODE_PROVIDER_NAME
        && api_format == ProviderApiFormat::OpenaiChat
        && validate_base_url(base_url).is_ok()
}

#[tauri::command]
pub(crate) async fn fetch_claude_code_models<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_models_blocking(app, base_url, api_key, provider_id)
    })
    .await
    .map_err(|error| format!("Claude Code model query task failed: {error}"))?
}

fn fetch_models_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    let query_url = models_url(&base_url)?;
    let supplied_key = api_key.unwrap_or_default().trim().to_string();
    let token = required_api_key(&app, supplied_key, provider_id)?;
    let client = model_query_client()?;
    let response = client
        .get(query_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("x-api-key", &token)
        .bearer_auth(token)
        .send()
        .map_err(|error| format!("Could not connect to Anthropic: {error}"))?;
    let payload = read_model_response(response)?;
    parse_models(&payload)
}

fn model_query_client() -> Result<Client, String> {
    Client::builder()
        .timeout(MODEL_QUERY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Codex-Switch")
        .build()
        .map_err(|error| format!("Could not prepare the Anthropic connection: {error}"))
}

fn required_api_key<R: Runtime>(
    app: &tauri::AppHandle<R>,
    supplied_key: String,
    provider_id: Option<String>,
) -> Result<String, String> {
    if !supplied_key.is_empty() {
        return Ok(supplied_key);
    }
    let Some(provider_id) = provider_id else {
        return Err("Enter the Anthropic API key before loading models".to_string());
    };
    let provider = read_provider(&resolve_paths(app)?, &provider_id)?;
    if !is_saved_claude_code_provider(&provider) {
        return Err("The selected provider is not a Claude Code preset".to_string());
    }
    if provider.api_key.trim().is_empty() {
        return Err("The saved Claude Code preset does not have an API key".to_string());
    }
    Ok(provider.api_key)
}

fn is_saved_claude_code_provider(provider: &ProviderProfile) -> bool {
    is_claude_code_identity(
        provider.kind,
        &provider.name,
        &provider.base_url,
        provider.api_format,
    )
}

fn models_url(base_url: &str) -> Result<Url, String> {
    let mut url = validate_base_url(base_url)?;
    url.set_path("/v1/models");
    url.query_pairs_mut().append_pair("limit", "1000");
    Ok(url)
}

fn validate_base_url(base_url: &str) -> Result<Url, String> {
    let url = Url::parse(base_url.trim())
        .map_err(|error| format!("Claude Code Base URL is invalid: {error}"))?;
    let valid_path = url.path().trim_end_matches('/') == "/v1";
    let has_extra_parts = !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some();
    if url.scheme() != "https"
        || !url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case(CLAUDE_API_HOST))
        || url.port_or_known_default() != Some(443)
        || !valid_path
        || has_extra_parts
    {
        return Err(
            "Claude Code must use the official https://api.anthropic.com/v1 endpoint".to_string(),
        );
    }
    Ok(url)
}

fn read_model_response(response: reqwest::blocking::Response) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Anthropic returned HTTP {}", status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODEL_RESPONSE_BYTES)
    {
        return Err("Anthropic returned too much model data".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_MODEL_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the Anthropic model list: {error}"))?;
    if bytes.len() as u64 > MAX_MODEL_RESPONSE_BYTES {
        return Err("Anthropic returned too much model data".to_string());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Anthropic returned invalid model data: {error}"))
}

fn parse_models(payload: &Value) -> Result<Vec<String>, String> {
    let entries = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "Anthropic model data is missing".to_string())?;
    let mut seen = HashSet::new();
    let models = entries
        .iter()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|model| !model.is_empty() && seen.insert((*model).to_string()))
        .map(str::to_string)
        .collect::<Vec<_>>();
    if models.is_empty() {
        Err("Anthropic did not return any available models".to_string())
    } else {
        Ok(models)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn accepts_only_the_official_anthropic_endpoint() {
        assert!(validate_base_url("https://api.anthropic.com/v1").is_ok());
        assert!(validate_base_url("https://api.anthropic.com/v1/").is_ok());
        assert!(validate_base_url("http://api.anthropic.com/v1").is_err());
        assert!(validate_base_url("https://anthropic.com/v1").is_err());
        assert!(validate_base_url("https://api.anthropic.com/v1?key=value").is_err());
        assert!(validate_base_url("https://user@api.anthropic.com/v1").is_err());
    }

    #[test]
    fn builds_the_paginated_model_catalog_url() {
        assert_eq!(
            models_url("https://api.anthropic.com/v1").unwrap().as_str(),
            "https://api.anthropic.com/v1/models?limit=1000"
        );
    }

    #[test]
    fn parses_and_deduplicates_models() {
        let models = parse_models(&json!({
            "data": [
                { "id": "claude-sonnet-5", "type": "model" },
                { "id": "claude-opus-5", "type": "model" },
                { "id": "claude-sonnet-5", "type": "model" },
                { "id": " " }
            ],
            "has_more": false
        }))
        .unwrap();

        assert_eq!(models, vec!["claude-sonnet-5", "claude-opus-5"]);
    }

    #[test]
    fn recognizes_only_the_claude_code_preset_identity() {
        assert!(is_claude_code_identity(
            ProviderKind::Custom,
            "Claude Code",
            "https://api.anthropic.com/v1",
            ProviderApiFormat::OpenaiChat,
        ));
        assert!(!is_claude_code_identity(
            ProviderKind::Custom,
            "Claude Code",
            "https://example.com/v1",
            ProviderApiFormat::OpenaiChat,
        ));
    }
}
