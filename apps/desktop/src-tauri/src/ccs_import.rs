use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use url::Url;
use uuid::Uuid;

use crate::{
    models::{
        ModelReasoningEfforts, ProviderApiFormat, ProviderBalancePlatform, ProviderKind,
        ProviderSummary, ReasoningEffort,
    },
    providers::{self, ProviderInput},
    storage::resolve_paths,
};

const CCS_SCHEMES: &[&str] = &["ccswitch", "cswitch"];
const CCS_VERSION_HOST: &str = "v1";
const IMPORT_PATH: &str = "/import";
const MAX_PROVIDER_NAME_LENGTH: usize = 200;
const MAX_ENDPOINT_LENGTH: usize = 2_048;
const MAX_API_KEY_LENGTH: usize = 16_384;
const MAX_MODEL_LENGTH: usize = 200;
const FIRST_DUPLICATE_SUFFIX: usize = 2;
const SUB2API_BALANCE_PATH: &str = "/v1/usage";
const NEW_API_BALANCE_PATH: &str = "/api/usage/token/";
const DEEPSEEK_BALANCE_PATH: &str = "/user/balance";
const DEEPSEEK_MODEL_PREFIX: &str = "deepseek-";
const DEEPSEEK_REASONING_EFFORTS: [ReasoningEffort; 6] = [
    ReasoningEffort::None,
    ReasoningEffort::Low,
    ReasoningEffort::Medium,
    ReasoningEffort::High,
    ReasoningEffort::Xhigh,
    ReasoningEffort::Max,
];

#[derive(Clone)]
struct ImportBalanceSettings {
    platform: Option<ProviderBalancePlatform>,
    query_url: Option<String>,
    uses_api_key: bool,
}

#[derive(Clone)]
struct ImportModels {
    selected: String,
    available: Vec<String>,
}

#[derive(Clone)]
struct PendingProviderImport {
    id: String,
    app_name: String,
    name: String,
    endpoint: String,
    api_key: String,
    models: ImportModels,
    kind: ProviderKind,
    api_format: ProviderApiFormat,
    controlled_by_codex: bool,
    balance: ImportBalanceSettings,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CcSwitchImportRequest {
    request_id: String,
    app: String,
    name: String,
    endpoint: String,
    models: Vec<String>,
    api_key_provided: bool,
    balance_platform: Option<ProviderBalancePlatform>,
}

impl PendingProviderImport {
    fn details(&self) -> CcSwitchImportRequest {
        CcSwitchImportRequest {
            request_id: self.id.clone(),
            app: self.app_name.clone(),
            name: self.name.clone(),
            endpoint: self.endpoint.clone(),
            models: self.models.available.clone(),
            api_key_provided: !self.api_key.is_empty(),
            balance_platform: self.balance.platform,
        }
    }
}

#[derive(Default)]
pub(crate) struct ImportState {
    pending: Mutex<VecDeque<PendingProviderImport>>,
}

/// Handles a URL delivered by the `ccswitch://` desktop deep-link integration.
/// Invalid or unsupported links are ignored after logging a short diagnostic so
/// a malformed link cannot interrupt application startup or the tray process.
pub(crate) fn handle_url<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    let app = app.clone();
    let url = url.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = queue_import(&app, &url) {
            eprintln!("ignored CCS import link: {error}");
        }
    });
}

fn queue_import<R: Runtime>(app: &AppHandle<R>, url: &Url) -> Result<(), String> {
    let mut pending = parse_import(url)?;
    pending.models = import_models(
        &pending.app_name,
        pending.models.selected.clone(),
        &pending.endpoint,
        &pending.api_key,
    )?;
    let paths = resolve_paths(app)?;
    let mut names = providers::list_provider_profiles(&paths)?
        .into_iter()
        .map(|provider| provider.name)
        .collect::<Vec<_>>();
    let state = app.state::<ImportState>();
    let mut queue = state
        .pending
        .lock()
        .map_err(|_| "CCS import queue is unavailable".to_string())?;
    names.extend(queue.iter().map(|item| item.name.clone()));
    pending.name = unique_provider_name(&pending.name, &names);
    queue.push_back(pending);
    drop(queue);

    crate::system_tray::show_dashboard(app);
    app.emit("ccswitch-import-requested", ())
        .map_err(|error| format!("failed to show the CCS import confirmation: {error}"))
}

fn parse_import(url: &Url) -> Result<PendingProviderImport, String> {
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
    let requested_model = import_model(&app_name, requested_model)?;
    let balance = import_balance_settings(&query, &endpoint)?;
    Ok(PendingProviderImport {
        id: Uuid::new_v4().to_string(),
        app_name,
        name,
        endpoint,
        api_key,
        models: ImportModels {
            selected: requested_model.clone(),
            available: vec![requested_model],
        },
        kind,
        api_format,
        controlled_by_codex,
        balance,
    })
}

#[tauri::command]
pub(crate) async fn take_ccswitch_import_request<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<Option<CcSwitchImportRequest>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ImportState>();
        let queue = state
            .pending
            .lock()
            .map_err(|_| "CCS import queue is unavailable".to_string())?;
        Ok(queue.front().map(PendingProviderImport::details))
    })
    .await
    .map_err(|error| format!("failed to read the CCS import request: {error}"))?
}

#[tauri::command]
pub(crate) async fn cancel_ccswitch_provider_import<R: Runtime + 'static>(
    app: AppHandle<R>,
    request_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_pending_import(&app, &request_id).map(drop))
        .await
        .map_err(|error| format!("failed to cancel the CCS import request: {error}"))?
}

#[tauri::command]
pub(crate) async fn confirm_ccswitch_provider_import<R: Runtime + 'static>(
    app: AppHandle<R>,
    request_id: String,
    name: String,
) -> Result<ProviderSummary, String> {
    tauri::async_runtime::spawn_blocking(move || confirm_import(&app, &request_id, &name))
        .await
        .map_err(|error| format!("failed to confirm the CCS import request: {error}"))?
}

fn confirm_import<R: Runtime>(
    app: &AppHandle<R>,
    request_id: &str,
    requested_name: &str,
) -> Result<ProviderSummary, String> {
    let requested_name = bounded_value(requested_name, "name", MAX_PROVIDER_NAME_LENGTH)?;
    let pending = remove_pending_import(app, request_id)?;
    let result = save_pending_import(app, pending.clone(), requested_name);
    if result.is_err() {
        restore_pending_import(app, pending)?;
    }
    result
}

fn save_pending_import<R: Runtime>(
    app: &AppHandle<R>,
    pending: PendingProviderImport,
    requested_name: String,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(app)?;
    let existing_names = providers::list_provider_profiles(&paths)?
        .into_iter()
        .map(|provider| provider.name)
        .collect::<Vec<_>>();
    let name = unique_provider_name(&requested_name, &existing_names);
    let models = pending.models.clone();
    providers::save_provider(app.clone(), pending_provider_input(pending, name, models))
}

fn pending_provider_input(
    pending: PendingProviderImport,
    name: String,
    models: ImportModels,
) -> ProviderInput {
    let model_reasoning_efforts = imported_model_reasoning_efforts(&models.available);
    ProviderInput {
        id: None,
        kind: pending.kind,
        name,
        group: String::new(),
        base_url: pending.endpoint,
        api_key: Some(pending.api_key),
        model: models.selected,
        models: models.available,
        model_reasoning_efforts,
        model_context_windows: Default::default(),
        model_api_formats: Default::default(),
        image_input_models: Vec::new(),
        image_input_models_configured: Some(false),
        context_window: None,
        model_selection_controlled_by_codex: pending.controlled_by_codex,
        fast_mode_enabled: false,
        api_format: pending.api_format,
        balance_platform: pending.balance.platform,
        balance_query_url: pending.balance.query_url,
        balance_query_token: None,
        balance_query_uses_api_key: pending.balance.uses_api_key,
        wallet_query_url: None,
        wallet_query_token: None,
        wallet_username: None,
        wallet_password: None,
    }
}

fn imported_model_reasoning_efforts(models: &[String]) -> ModelReasoningEfforts {
    models
        .iter()
        .filter(|model| {
            model
                .trim()
                .to_ascii_lowercase()
                .starts_with(DEEPSEEK_MODEL_PREFIX)
        })
        .map(|model| (model.clone(), DEEPSEEK_REASONING_EFFORTS.to_vec()))
        .collect()
}

fn remove_pending_import<R: Runtime>(
    app: &AppHandle<R>,
    request_id: &str,
) -> Result<PendingProviderImport, String> {
    let state = app.state::<ImportState>();
    let mut queue = state
        .pending
        .lock()
        .map_err(|_| "CCS import queue is unavailable".to_string())?;
    let index = queue
        .iter()
        .position(|pending| pending.id == request_id)
        .ok_or_else(|| "CCS import request is no longer available".to_string())?;
    queue
        .remove(index)
        .ok_or_else(|| "CCS import request is no longer available".to_string())
}

fn restore_pending_import<R: Runtime>(
    app: &AppHandle<R>,
    pending: PendingProviderImport,
) -> Result<(), String> {
    let state = app.state::<ImportState>();
    state
        .pending
        .lock()
        .map_err(|_| "CCS import queue is unavailable".to_string())?
        .push_front(pending);
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
            true,
        )),
        "claude" | "gemini" | "grokbuild" => {
            Ok((ProviderKind::Custom, ProviderApiFormat::OpenaiChat, true))
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
    bounded_value(query_value(query, key)?, key, max_length)
}

fn bounded_value(value: &str, key: &str, max_length: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("CCS link is missing {key}"));
    }
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

fn unique_provider_name(requested: &str, existing_names: &[String]) -> String {
    let normalized_names = existing_names
        .iter()
        .map(|name| name.trim().to_lowercase())
        .collect::<BTreeSet<_>>();
    if !normalized_names.contains(&requested.to_lowercase()) {
        return requested.to_string();
    }
    for number in FIRST_DUPLICATE_SUFFIX.. {
        let suffix = format!(" ({number})");
        let base_length = MAX_PROVIDER_NAME_LENGTH.saturating_sub(suffix.chars().count());
        let base = requested.chars().take(base_length).collect::<String>();
        let candidate = format!("{}{suffix}", base.trim_end());
        if !normalized_names.contains(&candidate.to_lowercase()) {
            return candidate;
        }
    }
    unreachable!("provider suffix search always has another number")
}

#[cfg(test)]
mod tests;
