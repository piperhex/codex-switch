use std::{fmt, time::Duration};

use reqwest::blocking::{Client, ClientBuilder};
use tauri::Runtime;
use url::Url;

use crate::{
    claude_code_provider::is_claude_code_identity,
    grok_provider::is_grok_identity,
    models::ProviderProfile,
    providers::{ensure_not_local_proxy_base_url, read_provider},
    storage::resolve_paths,
};

const CONNECTIVITY_TIMEOUT: Duration = Duration::from_secs(10);
const ANTHROPIC_VERSION: &str = "2023-06-01";
const LM_STUDIO_PROVIDER_NAME: &str = "LM Studio";

#[derive(Debug)]
enum ConnectivityError {
    ProviderUnavailable,
    InvalidBaseUrl(String),
    Client(String),
    Request(String),
    Http(u16, String),
}

impl fmt::Display for ConnectivityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProviderUnavailable => {
                write!(formatter, "The Provider configuration is unavailable")
            }
            Self::InvalidBaseUrl(detail) => write!(formatter, "Invalid Base URL: {detail}"),
            Self::Client(detail) => write!(formatter, "Could not prepare the connection: {detail}"),
            Self::Request(detail) => write!(formatter, "Could not connect: {detail}"),
            Self::Http(status, reason) => {
                write!(formatter, "The Provider returned HTTP {status} {reason}")
            }
        }
    }
}

#[derive(Clone, Copy)]
enum ConnectivityEndpoint {
    Standard,
    ClaudeCode,
    Grok,
    LmStudio,
}

#[tauri::command]
pub(crate) async fn test_provider_connectivity<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || test_provider_connectivity_blocking(&app, &id))
        .await
        .map_err(|error| format!("Provider connectivity task failed: {error}"))?
        .map_err(|error| error.to_string())
}

fn test_provider_connectivity_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<(), ConnectivityError> {
    let paths = resolve_paths(app).map_err(|_| ConnectivityError::ProviderUnavailable)?;
    let provider = read_provider(&paths, id).map_err(|_| ConnectivityError::ProviderUnavailable)?;
    let endpoint = connectivity_endpoint(&provider);
    let url = connectivity_url(&provider.base_url, endpoint)?;
    let client = connectivity_client(&url)?;
    let response = send_connectivity_request(&client, &url, &provider, endpoint)?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let reason = status
        .canonical_reason()
        .unwrap_or("Unknown error")
        .to_string();
    Err(ConnectivityError::Http(status.as_u16(), reason))
}

fn connectivity_endpoint(provider: &ProviderProfile) -> ConnectivityEndpoint {
    let identity = (
        provider.kind,
        provider.name.as_str(),
        provider.base_url.as_str(),
        provider.api_format,
    );
    if is_claude_code_identity(identity.0, identity.1, identity.2, identity.3) {
        return ConnectivityEndpoint::ClaudeCode;
    }
    if is_grok_identity(identity.0, identity.1, identity.2, identity.3) {
        return ConnectivityEndpoint::Grok;
    }
    if provider.name.trim() == LM_STUDIO_PROVIDER_NAME {
        return ConnectivityEndpoint::LmStudio;
    }
    ConnectivityEndpoint::Standard
}

fn connectivity_url(
    base_url: &str,
    endpoint: ConnectivityEndpoint,
) -> Result<Url, ConnectivityError> {
    let normalized = base_url.trim().trim_end_matches('/');
    ensure_not_local_proxy_base_url(normalized).map_err(ConnectivityError::InvalidBaseUrl)?;
    let mut url = Url::parse(normalized)
        .map_err(|error| ConnectivityError::InvalidBaseUrl(error.to_string()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(ConnectivityError::InvalidBaseUrl(
            "expected an http:// or https:// URL with a host".to_string(),
        ));
    }
    let path = match endpoint {
        ConnectivityEndpoint::ClaudeCode => "/v1/models".to_string(),
        ConnectivityEndpoint::Grok => "/v1/language-models".to_string(),
        ConnectivityEndpoint::LmStudio => "/api/v1/models".to_string(),
        ConnectivityEndpoint::Standard => format!("{}/models", url.path().trim_end_matches('/')),
    };
    url.set_path(&path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn connectivity_client(url: &Url) -> Result<Client, ConnectivityError> {
    let builder = ClientBuilder::new()
        .timeout(CONNECTIVITY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Codex-Switch");
    let builder = if url.host_str().is_some_and(is_loopback_host) {
        builder.no_proxy()
    } else {
        crate::system_proxy::apply(builder)
    };
    builder
        .build()
        .map_err(|error| ConnectivityError::Client(error.to_string()))
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || matches!(host, "127.0.0.1" | "::1" | "[::1]")
}

fn send_connectivity_request(
    client: &Client,
    url: &Url,
    provider: &ProviderProfile,
    endpoint: ConnectivityEndpoint,
) -> Result<reqwest::blocking::Response, ConnectivityError> {
    let mut request = client
        .get(url.clone())
        .header(reqwest::header::ACCEPT, "application/json");
    let api_key = provider.api_key.trim();
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    if matches!(endpoint, ConnectivityEndpoint::ClaudeCode) {
        request = request
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("x-api-key", api_key);
    }
    request
        .send()
        .map_err(|error| ConnectivityError::Request(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_standard_models_endpoint() {
        let url = connectivity_url(
            "https://relay.example.com/api/v1/",
            ConnectivityEndpoint::Standard,
        )
        .unwrap();
        assert_eq!(url.as_str(), "https://relay.example.com/api/v1/models");
    }

    #[test]
    fn uses_provider_specific_models_endpoints() {
        let claude = connectivity_url(
            "https://api.anthropic.com/v1",
            ConnectivityEndpoint::ClaudeCode,
        )
        .unwrap();
        let grok = connectivity_url("https://api.x.ai/v1", ConnectivityEndpoint::Grok).unwrap();
        assert_eq!(claude.as_str(), "https://api.anthropic.com/v1/models");
        assert_eq!(grok.as_str(), "https://api.x.ai/v1/language-models");
    }
}
