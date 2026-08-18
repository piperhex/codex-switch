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
const SUB2API_BALANCE_PATH: &str = "/v1/usage";
const NEW_API_BALANCE_PATH: &str = "/api/usage/token/";
const DEEPSEEK_BALANCE_PATH: &str = "/user/balance";

struct ImportBalanceSettings {
    platform: Option<ProviderBalancePlatform>,
    query_url: Option<String>,
    uses_api_key: bool,
}

struct ImportModels {
    selected: String,
    available: Vec<String>,
}

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
    let requested_model = bounded_optional_query_value(&query, "model", MAX_MODEL_LENGTH)?;
    let (kind, api_format, controlled_by_codex) = provider_kind(&app_name)?;
    let models = import_models(&app_name, requested_model, &endpoint, &api_key)?;
    let balance = import_balance_settings(&query, &endpoint)?;
    let provider = ProviderInput {
        id: None,
        kind,
        name,
        group: String::new(),
        base_url: endpoint,
        api_key: Some(api_key),
        model: models.selected,
        models: models.available,
        model_reasoning_efforts: Default::default(),
        model_context_windows: Default::default(),
        image_input_models: Vec::new(),
        image_input_models_configured: Some(false),
        context_window: None,
        model_selection_controlled_by_codex: controlled_by_codex,
        api_format,
        balance_platform: balance.platform,
        balance_query_url: balance.query_url,
        balance_query_token: None,
        balance_query_uses_api_key: balance.uses_api_key,
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
            ProviderKind::Custom,
            ProviderApiFormat::OpenaiResponses,
            false,
        )),
        "claude" | "gemini" | "grokbuild" => {
            Ok((ProviderKind::Custom, ProviderApiFormat::OpenaiChat, false))
        }
        _ => Err(format!("unsupported CCS app '{app}'")),
    }
}

fn import_model(app: &str, requested_model: String) -> Result<String, String> {
    if !requested_model.is_empty() {
        return Ok(requested_model);
    }
    match app {
        "codex" => Ok(providers::DEFAULT_OFFICIAL_MODEL.to_string()),
        _ => Err("CCS link is missing model".to_string()),
    }
}

fn import_models(
    app: &str,
    requested_model: String,
    endpoint: &str,
    api_key: &str,
) -> Result<ImportModels, String> {
    let preferred = import_model(app, requested_model)?;
    let fetched = crate::provider_models::fetch_relay_models_blocking(endpoint, api_key);
    Ok(resolve_import_models(preferred, fetched))
}

fn resolve_import_models(preferred: String, fetched: Result<Vec<String>, String>) -> ImportModels {
    let available = match fetched {
        Ok(models) if !models.is_empty() => models,
        Ok(_) => vec![preferred.clone()],
        Err(error) => {
            eprintln!("failed to load models for a CCS import; using the default: {error}");
            vec![preferred.clone()]
        }
    };
    let selected = if available.contains(&preferred) {
        preferred
    } else {
        available.first().cloned().unwrap_or(preferred)
    };
    ImportModels {
        selected,
        available,
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

fn import_balance_settings(
    query: &BTreeMap<String, String>,
    endpoint: &str,
) -> Result<ImportBalanceSettings, String> {
    let platform = query
        .get("balancePlatform")
        .or_else(|| query.get("platform"))
        .and_then(|value| parse_balance_platform(value));
    let query_url = platform
        .map(|platform| default_balance_query_url(endpoint, platform))
        .transpose()?;
    Ok(ImportBalanceSettings {
        platform,
        query_url,
        uses_api_key: platform.is_some(),
    })
}

fn default_balance_query_url(
    endpoint: &str,
    platform: ProviderBalancePlatform,
) -> Result<String, String> {
    let mut url =
        Url::parse(endpoint).map_err(|error| format!("CCS endpoint is invalid: {error}"))?;
    let root_path = url.path().trim_end_matches('/');
    let root_path = root_path
        .strip_suffix("/v1")
        .unwrap_or(root_path)
        .trim_end_matches('/');
    let balance_path = match platform {
        ProviderBalancePlatform::NewApi => NEW_API_BALANCE_PATH,
        ProviderBalancePlatform::Sub2Api => SUB2API_BALANCE_PATH,
        ProviderBalancePlatform::DeepSeek => DEEPSEEK_BALANCE_PATH,
    };
    url.set_path(&format!("{root_path}{balance_path}"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
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

    #[test]
    fn imports_codex_links_as_relay_providers() {
        let (kind, api_format, controlled_by_codex) = provider_kind("codex").unwrap();

        assert_eq!(kind, ProviderKind::Custom);
        assert_eq!(api_format, ProviderApiFormat::OpenaiResponses);
        assert!(!controlled_by_codex);
        assert_eq!(
            import_model("codex", String::new()).unwrap(),
            providers::DEFAULT_OFFICIAL_MODEL
        );
    }

    #[test]
    fn imported_relay_prefers_its_requested_model() {
        let models = resolve_import_models(
            "gpt-requested".to_string(),
            Ok(vec!["gpt-first".to_string(), "gpt-requested".to_string()]),
        );

        assert_eq!(models.selected, "gpt-requested");
        assert_eq!(models.available, vec!["gpt-first", "gpt-requested"]);
    }

    #[test]
    fn imported_relay_selects_the_first_fetched_model_when_needed() {
        let models = resolve_import_models(
            providers::DEFAULT_OFFICIAL_MODEL.to_string(),
            Ok(vec![
                "relay-model-a".to_string(),
                "relay-model-b".to_string(),
            ]),
        );

        assert_eq!(models.selected, "relay-model-a");
        assert_eq!(models.available, vec!["relay-model-a", "relay-model-b"]);
    }

    #[test]
    fn imported_relay_keeps_a_default_when_model_discovery_fails() {
        let models = resolve_import_models(
            providers::DEFAULT_OFFICIAL_MODEL.to_string(),
            Err("unavailable".to_string()),
        );

        assert_eq!(models.selected, providers::DEFAULT_OFFICIAL_MODEL);
        assert_eq!(models.available, vec![providers::DEFAULT_OFFICIAL_MODEL]);
    }

    #[test]
    fn supplies_sub2api_balance_defaults_for_compatible_links() {
        let query = Url::parse(
            "cswitch://v1/import?balancePlatform=sub2api&endpoint=https%3A%2F%2Frelay.example.com%2Fv1",
        )
        .unwrap()
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<BTreeMap<_, _>>();

        let settings = import_balance_settings(&query, &query["endpoint"]).unwrap();

        assert_eq!(settings.platform, Some(ProviderBalancePlatform::Sub2Api));
        assert_eq!(
            settings.query_url.as_deref(),
            Some("https://relay.example.com/v1/usage")
        );
        assert!(settings.uses_api_key);
    }

    #[test]
    fn supplies_new_api_balance_defaults_for_nested_endpoints() {
        let query = BTreeMap::from([("platform".to_string(), "new-api".to_string())]);

        let settings =
            import_balance_settings(&query, "https://relay.example.com/codex/v1/").unwrap();

        assert_eq!(settings.platform, Some(ProviderBalancePlatform::NewApi));
        assert_eq!(
            settings.query_url.as_deref(),
            Some("https://relay.example.com/codex/api/usage/token/")
        );
        assert!(settings.uses_api_key);
    }
}
