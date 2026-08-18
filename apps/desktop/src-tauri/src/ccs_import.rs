use std::{
    collections::BTreeMap,
    sync::atomic::{AtomicBool, Ordering},
};

use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use url::Url;

use crate::{
    models::{ProviderApiFormat, ProviderBalancePlatform, ProviderKind},
    providers::{self, ProviderInput},
};

const CCS_SCHEMES: &[&str] = &["ccswitch", "cswitch"];
const CCS_VERSION_HOST: &str = "v1";
const IMPORT_PATH: &str = "/import";
const MAX_PROVIDER_NAME_LENGTH: usize = 200;
const MAX_ENDPOINT_LENGTH: usize = 2_048;
const MAX_API_KEY_LENGTH: usize = 16_384;
const MAX_MODEL_LENGTH: usize = 200;

#[derive(Default)]
pub(crate) struct ImportNavigationState {
    pending: AtomicBool,
}

#[tauri::command]
pub(crate) fn take_ccswitch_import_navigation(state: State<'_, ImportNavigationState>) -> bool {
    state.pending.swap(false, Ordering::AcqRel)
}

/// Handles a URL delivered by the `ccswitch://` desktop deep-link integration.
/// Invalid or unsupported links are ignored after logging a short diagnostic so
/// a malformed link cannot interrupt application startup or the tray process.
pub(crate) fn handle_url<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    let app = app.clone();
    let url = url.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = import_url(&app, &url) {
            eprintln!("ignored CCS import link: {error}");
        }
    });
}

fn import_url<R: Runtime>(app: &AppHandle<R>, url: &Url) -> Result<(), String> {
    validate_route(url)?;
    let query = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<BTreeMap<_, _>>();
    if query.get("resource").map(String::as_str) != Some("provider") {
        return Err("unsupported CCS resource".to_string());
    }

    let app_name = query_value(&query, "app")?.to_ascii_lowercase();
    let name = bounded_query_value(&query, "name", MAX_PROVIDER_NAME_LENGTH)?;
    let endpoint = bounded_query_value(&query, "endpoint", MAX_ENDPOINT_LENGTH)?;
    let api_key = bounded_query_value(&query, "apiKey", MAX_API_KEY_LENGTH)?;
    let model = bounded_optional_query_value(&query, "model", MAX_MODEL_LENGTH)?;
    let (kind, api_format, controlled_by_codex) = provider_kind(&app_name)?;
    let models = if model.is_empty() {
        Vec::new()
    } else {
        vec![model.clone()]
    };
    let balance_platform = query
        .get("balancePlatform")
        .or_else(|| query.get("platform"))
        .and_then(|value| parse_balance_platform(value));
    let provider = ProviderInput {
        id: None,
        kind,
        name,
        group: String::new(),
        base_url: endpoint,
        api_key: Some(api_key),
        model,
        models,
        model_reasoning_efforts: Default::default(),
        model_context_windows: Default::default(),
        image_input_models: Vec::new(),
        image_input_models_configured: Some(false),
        context_window: None,
        model_selection_controlled_by_codex: controlled_by_codex,
        api_format,
        balance_platform,
        balance_query_url: None,
        balance_query_token: None,
        balance_query_uses_api_key: false,
        wallet_query_url: None,
        wallet_query_token: None,
        wallet_username: None,
        wallet_password: None,
    };
    providers::save_provider(app.clone(), provider)?;
    app.state::<ImportNavigationState>()
        .pending
        .store(true, Ordering::Release);
    crate::system_tray::show_dashboard(app);
    if let Err(error) = app.emit("ccswitch-imported", ()) {
        eprintln!("failed to notify the dashboard about the CCS import: {error}");
    }
    Ok(())
}

fn validate_route(url: &Url) -> Result<(), String> {
    if !CCS_SCHEMES.contains(&url.scheme())
        || url.host_str() != Some(CCS_VERSION_HOST)
        || url.path() != IMPORT_PATH
    {
        return Err("unsupported CCS link".to_string());
    }
    Ok(())
}

fn provider_kind(app: &str) -> Result<(ProviderKind, ProviderApiFormat, bool), String> {
    match app {
        "codex" => Ok((
            ProviderKind::OpenAi,
            ProviderApiFormat::OpenaiResponses,
            true,
        )),
        "claude" | "gemini" | "grokbuild" => {
            Ok((ProviderKind::Custom, ProviderApiFormat::OpenaiChat, false))
        }
        _ => Err(format!("unsupported CCS app '{app}'")),
    }
}

fn parse_balance_platform(value: &str) -> Option<ProviderBalancePlatform> {
    match value.trim().to_ascii_lowercase().as_str() {
        "newapi" | "new-api" => Some(ProviderBalancePlatform::NewApi),
        "sub2api" | "sub-2-api" => Some(ProviderBalancePlatform::Sub2Api),
        "deepseek" | "deep-seek" => Some(ProviderBalancePlatform::DeepSeek),
        _ => None,
    }
}

fn query_value<'a>(query: &'a BTreeMap<String, String>, key: &str) -> Result<&'a str, String> {
    query
        .get(key)
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("CCS link is missing {key}"))
}

fn bounded_query_value(
    query: &BTreeMap<String, String>,
    key: &str,
    max_length: usize,
) -> Result<String, String> {
    let value = query_value(query, key)?.trim();
    if value.chars().count() > max_length {
        return Err(format!("CCS {key} is too long"));
    }
    Ok(value.to_string())
}

fn bounded_optional_query_value(
    query: &BTreeMap<String, String>,
    key: &str,
    max_length: usize,
) -> Result<String, String> {
    let value = query.get(key).map(String::as_str).unwrap_or("").trim();
    if value.chars().count() > max_length {
        return Err(format!("CCS {key} is too long"));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_provider_import_route() {
        let url = Url::parse("ccswitch://v1/import?resource=provider&app=codex").unwrap();
        assert!(validate_route(&url).is_ok());
    }

    #[test]
    fn accepts_first_party_provider_import_route() {
        let url = Url::parse("cswitch://v1/import?resource=provider&app=codex").unwrap();
        assert!(validate_route(&url).is_ok());
    }

    #[test]
    fn rejects_other_resources() {
        let url = Url::parse("ccswitch://v1/import?resource=account&app=codex").unwrap();
        let query = url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<BTreeMap<_, _>>();
        assert_ne!(query.get("resource").map(String::as_str), Some("provider"));
    }

    #[test]
    fn maps_sub2api_and_newapi_platforms() {
        assert_eq!(
            parse_balance_platform("sub2api"),
            Some(ProviderBalancePlatform::Sub2Api)
        );
        assert_eq!(
            parse_balance_platform("new-api"),
            Some(ProviderBalancePlatform::NewApi)
        );
    }
}
