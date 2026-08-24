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

const GROK_PROVIDER_NAME: &str = "Grok";
const GROK_API_HOST: &str = "api.x.ai";
const MAX_MODEL_RESPONSE_BYTES: u64 = 1024 * 1024;
const MODEL_QUERY_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) fn is_grok_identity(
    kind: ProviderKind,
    name: &str,
    base_url: &str,
    api_format: ProviderApiFormat,
) -> bool {
    kind == ProviderKind::Custom
        && name.trim() == GROK_PROVIDER_NAME
        && api_format == ProviderApiFormat::OpenaiResponses
        && validate_base_url(base_url).is_ok()
}

#[tauri::command]
pub(crate) async fn fetch_grok_models<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_models_blocking(app, base_url, api_key, provider_id)
    })
    .await
    .map_err(|error| format!("Grok model query task failed: {error}"))?
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
        .bearer_auth(token)
        .send()
        .map_err(|error| format!("Could not connect to xAI: {error}"))?;
    let payload = read_model_response(response)?;
    parse_models(&payload)
}

fn model_query_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .timeout(MODEL_QUERY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Codex-Switch")
        .build()
        .map_err(|error| format!("Could not prepare the xAI connection: {error}"))
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
        return Err("Enter the xAI API key before loading models".to_string());
    };
    let provider = read_provider(&resolve_paths(app)?, &provider_id)?;
    if !is_saved_grok_provider(&provider) {
        return Err("The selected provider is not a Grok preset".to_string());
    }
    if provider.api_key.trim().is_empty() {
        return Err("The saved Grok preset does not have an API key".to_string());
    }
    Ok(provider.api_key)
}

fn is_saved_grok_provider(provider: &ProviderProfile) -> bool {
    is_grok_identity(
        provider.kind,
        &provider.name,
        &provider.base_url,
        provider.api_format,
    )
}

fn models_url(base_url: &str) -> Result<Url, String> {
    let mut url = validate_base_url(base_url)?;
    url.set_path("/v1/language-models");
    Ok(url)
}

fn validate_base_url(base_url: &str) -> Result<Url, String> {
    let url = Url::parse(base_url.trim())
        .map_err(|error| format!("Grok Base URL is invalid: {error}"))?;
    let valid_path = url.path().trim_end_matches('/') == "/v1";
    let has_extra_parts = !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some();
    if url.scheme() != "https"
        || !url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case(GROK_API_HOST))
        || url.port_or_known_default() != Some(443)
        || !valid_path
        || has_extra_parts
    {
        return Err("Grok must use the official https://api.x.ai/v1 endpoint".to_string());
    }
    Ok(url)
}

fn read_model_response(response: reqwest::blocking::Response) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("xAI returned HTTP {}", status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODEL_RESPONSE_BYTES)
    {
        return Err("xAI returned too much model data".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_MODEL_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the xAI model list: {error}"))?;
    if bytes.len() as u64 > MAX_MODEL_RESPONSE_BYTES {
        return Err("xAI returned too much model data".to_string());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("xAI returned invalid model data: {error}"))
}

fn parse_models(payload: &Value) -> Result<Vec<String>, String> {
    let entries = payload
        .get("models")
        .or_else(|| payload.get("data"))
        .and_then(Value::as_array)
        .ok_or_else(|| "xAI model data is missing".to_string())?;
    let mut seen = HashSet::new();
    let models = entries
        .iter()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|model| !model.is_empty() && seen.insert((*model).to_string()))
        .map(str::to_string)
        .collect::<Vec<_>>();
    if models.is_empty() {
        Err("xAI did not return any available language models".to_string())
    } else {
        Ok(models)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn accepts_only_the_official_xai_endpoint() {
        assert!(validate_base_url("https://api.x.ai/v1").is_ok());
        assert!(validate_base_url("https://api.x.ai/v1/").is_ok());
        assert!(validate_base_url("http://api.x.ai/v1").is_err());
        assert!(validate_base_url("https://x.ai/v1").is_err());
        assert!(validate_base_url("https://api.x.ai/v1?key=value").is_err());
        assert!(validate_base_url("https://user@api.x.ai/v1").is_err());
    }

    #[test]
    fn builds_the_language_model_catalog_url() {
        assert_eq!(
            models_url("https://api.x.ai/v1").unwrap().as_str(),
            "https://api.x.ai/v1/language-models"
        );
    }

    #[test]
    fn parses_and_deduplicates_language_models() {
        let models = parse_models(&json!({
            "models": [
                { "id": "grok-build-0.1" },
                { "id": "grok-4.6" },
                { "id": "grok-build-0.1" },
                { "id": " " }
            ]
        }))
        .unwrap();

        assert_eq!(models, vec!["grok-build-0.1", "grok-4.6"]);
    }

    #[test]
    fn accepts_the_openai_compatible_models_shape() {
        let models = parse_models(&json!({ "data": [{ "id": "grok-4.6" }] })).unwrap();

        assert_eq!(models, vec!["grok-4.6"]);
    }
}
