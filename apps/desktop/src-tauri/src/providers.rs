use std::{fs, io::Read, path::PathBuf, time::Duration};

use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Emitter, Runtime};
use url::Url;
use uuid::Uuid;

use crate::{
    auth::{is_agent_identity_auth, validate_auth},
    models::{
        ModelContextWindows, ModelReasoningEfforts, ProviderApiFormat, ProviderBalance,
        ProviderBalanceItem, ProviderBalancePlatform, ProviderFieldModifiedAt, ProviderKind,
        ProviderProfile, ProviderSummary, ReasoningEffort, UsageSummary,
    },
    storage::{
        managed_auth_path, read_json, read_state, resolve_paths, write_json_atomic,
        write_json_if_changed, write_state, write_text_atomic, write_text_if_changed, Paths,
    },
};

const PROVIDER_ROOT_START: &str = "# Codex Switch provider start";
const PROVIDER_ROOT_END: &str = "# Codex Switch provider end";
const PROVIDER_TABLE_START: &str = "# Codex Switch custom provider start";
const PROVIDER_TABLE_END: &str = "# Codex Switch custom provider end";
pub(crate) const LOCAL_PROXY_HOST: &str = "127.0.0.1";
pub(crate) const LOCAL_PROXY_PORT: u16 = 15722;
pub(crate) const LOCAL_PROXY_BASE_URL: &str = "http://127.0.0.1:15722/v1";
pub(crate) const LOCAL_PROXY_TOKEN: &str = "CODEX_SWITCH_LOCAL_PROXY";
pub(crate) const LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER: &str = "x-openai-actor-authorization";
pub(crate) const CODEX_SWITCH_CONTROL_MODEL: &str = "codex switch control";
const LOCAL_PROXY_PROVIDER_ID: &str = "codex-switch-local";
const LOCAL_PROXY_PROVIDER_NAME: &str = "Codex Switch Local Proxy";
pub(crate) const DEFAULT_OFFICIAL_MODEL: &str = "gpt-5.6-sol";
const MODEL_CATALOG_FILENAME: &str = "codex-switch-model-catalog.json";
pub(crate) const DEFAULT_MODEL_CONTEXT_WINDOW: u64 = 256_000;
const NEW_API_QUOTA_PER_USD: f64 = 500_000.0;
const MAX_BALANCE_RESPONSE_BYTES: u64 = 1024 * 1024;
const MAX_MODEL_RESPONSE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReasoningEffortProfile {
    Standard,
    OpenAi,
    OpenAiMax,
    OpenAiUltra,
    DeepSeek,
}

fn emit_providers_changed<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(app);
    Ok(())
}

fn refresh_codex_models_best_effort(provider: &ProviderProfile) {
    if !crate::local_proxy::is_running() {
        return;
    }
    let models = codex_visible_models(provider);
    let image_input_models = codex_image_input_models(provider);
    let model_reasoning_efforts = codex_model_reasoning_efforts(provider);
    let selected_model = codex_model_for_provider(provider).to_string();
    crate::codex_runtime::refresh_models(
        models,
        image_input_models,
        model_reasoning_efforts,
        selected_model,
        reasoning_effort_profile(provider),
    );
}

fn codex_visible_models(provider: &ProviderProfile) -> Vec<String> {
    if provider.model_selection_controlled_by_codex {
        provider.models.clone()
    } else {
        vec![CODEX_SWITCH_CONTROL_MODEL.to_string()]
    }
}

pub(crate) fn codex_image_input_models(provider: &ProviderProfile) -> Vec<String> {
    if provider.model_selection_controlled_by_codex {
        return provider.image_input_models.clone();
    }
    if provider.image_input_models.contains(&provider.model) {
        vec![CODEX_SWITCH_CONTROL_MODEL.to_string()]
    } else {
        Vec::new()
    }
}

pub(crate) fn codex_model_reasoning_efforts(provider: &ProviderProfile) -> ModelReasoningEfforts {
    if provider.model_selection_controlled_by_codex {
        return provider.model_reasoning_efforts.clone();
    }
    provider
        .model_reasoning_efforts
        .get(&provider.model)
        .cloned()
        .map(|efforts| [(CODEX_SWITCH_CONTROL_MODEL.to_string(), efforts)].into())
        .unwrap_or_default()
}

pub(crate) fn codex_model_context_windows(provider: &ProviderProfile) -> ModelContextWindows {
    if provider.model_selection_controlled_by_codex {
        return provider.model_context_windows.clone();
    }
    provider
        .model_context_windows
        .get(&provider.model)
        .copied()
        .map(|context_window| [(CODEX_SWITCH_CONTROL_MODEL.to_string(), context_window)].into())
        .unwrap_or_default()
}

pub(crate) fn reasoning_effort_profile(provider: &ProviderProfile) -> ReasoningEffortProfile {
    if provider.balance_platform == Some(ProviderBalancePlatform::DeepSeek) {
        ReasoningEffortProfile::DeepSeek
    } else {
        reasoning_effort_profile_for_model(&provider.model, ReasoningEffortProfile::Standard)
    }
}

pub(crate) fn reasoning_effort_profile_for_model(
    model: &str,
    fallback: ReasoningEffortProfile,
) -> ReasoningEffortProfile {
    if fallback == ReasoningEffortProfile::DeepSeek {
        return fallback;
    }
    if model.eq_ignore_ascii_case(CODEX_SWITCH_CONTROL_MODEL) {
        return fallback;
    }

    let normalized = model.trim().to_ascii_lowercase();
    if !normalized.starts_with("gpt-") {
        return ReasoningEffortProfile::Standard;
    }
    if normalized.starts_with("gpt-5.6-sol") || normalized.starts_with("gpt-5.6-terra") {
        return ReasoningEffortProfile::OpenAiUltra;
    }
    if normalized.starts_with("gpt-5.6") {
        return ReasoningEffortProfile::OpenAiMax;
    }
    ReasoningEffortProfile::OpenAi
}

fn codex_model_for_provider(provider: &ProviderProfile) -> &str {
    if provider.model_selection_controlled_by_codex {
        &provider.model
    } else {
        CODEX_SWITCH_CONTROL_MODEL
    }
}

pub(crate) fn refresh_codex_models_for_current_target(paths: &Paths) {
    if !crate::local_proxy::is_running() {
        return;
    }
    let state = read_state(paths);
    let Some(id) = state.active_provider_id.as_deref() else {
        refresh_official_codex_models_for_paths(paths);
        return;
    };
    if let Ok(provider) = read_provider(paths, id) {
        refresh_codex_models_best_effort(&provider);
    }
}

pub(crate) fn refresh_official_codex_models_for_paths(paths: &Paths) {
    if !crate::local_proxy::is_running() {
        return;
    }
    crate::codex_runtime::refresh_models(
        Vec::new(),
        Vec::new(),
        ModelReasoningEfforts::new(),
        preferred_official_model(paths),
        ReasoningEffortProfile::Standard,
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderInput {
    id: Option<String>,
    #[serde(default)]
    kind: ProviderKind,
    name: String,
    base_url: String,
    api_key: Option<String>,
    model: String,
    #[serde(default)]
    models: Vec<String>,
    #[serde(default)]
    model_reasoning_efforts: ModelReasoningEfforts,
    #[serde(default)]
    model_context_windows: ModelContextWindows,
    #[serde(default)]
    image_input_models: Vec<String>,
    #[serde(default)]
    context_window: Option<u64>,
    #[serde(default)]
    model_selection_controlled_by_codex: bool,
    api_format: ProviderApiFormat,
    #[serde(default)]
    balance_platform: Option<ProviderBalancePlatform>,
    #[serde(default)]
    balance_query_url: Option<String>,
    #[serde(default)]
    balance_query_token: Option<String>,
    #[serde(default)]
    balance_query_uses_api_key: bool,
    #[serde(default)]
    wallet_query_url: Option<String>,
    #[serde(default)]
    wallet_query_token: Option<String>,
    #[serde(default)]
    wallet_username: Option<String>,
    #[serde(default)]
    wallet_password: Option<String>,
}

#[tauri::command]
pub(crate) fn list_providers<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ProviderSummary>, String> {
    let paths = resolve_paths(&app)?;
    let state = read_state(&paths);
    let mut providers = list_provider_profiles(&paths)?
        .into_iter()
        .map(|provider| {
            provider_summary(
                &provider,
                state.active_provider_id.as_deref() == Some(&provider.id),
                state.auto_switch_provider_id.as_deref() == Some(&provider.id),
            )
        })
        .collect::<Vec<_>>();
    providers.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(providers)
}

#[tauri::command]
pub(crate) fn save_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    provider: ProviderInput,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(&app)?;
    fs::create_dir_all(&paths.providers)
        .map_err(|error| format!("Failed to create provider store: {error}"))?;

    let existing = match provider.id.as_deref() {
        Some(id) => Some(read_provider(&paths, id)?),
        None => None,
    };
    let id = match provider.id {
        Some(id) => {
            validate_provider_id(&id)?;
            id
        }
        None => unique_provider_id(&paths),
    };
    let kind = provider.kind;
    let name = require_non_empty("Provider name", &provider.name)?;
    let base_url = normalize_base_url(&provider.base_url)?;
    let model = if kind == ProviderKind::OpenAi && provider.model.trim().is_empty() {
        DEFAULT_OFFICIAL_MODEL
    } else {
        &provider.model
    };
    let (model, models) = normalize_model_selection(model, provider.models)?;
    let model_reasoning_efforts =
        normalize_model_reasoning_efforts(&models, provider.model_reasoning_efforts);
    let model_context_windows =
        normalize_model_context_windows(&models, provider.model_context_windows);
    let image_input_models = normalize_model_subset(&models, provider.image_input_models);
    let supplied_key = provider.api_key.unwrap_or_default().trim().to_string();
    let api_key = if supplied_key.is_empty() {
        existing
            .as_ref()
            .map(|value| value.api_key.clone())
            .unwrap_or_default()
    } else {
        supplied_key
    };
    if kind != ProviderKind::OpenAi && api_key.is_empty() {
        return Err("API key is required for a new provider".to_string());
    }
    let (balance_platform, balance_query_url, balance_query_token) = normalize_balance_settings(
        provider.balance_platform,
        provider.balance_query_url,
        provider.balance_query_token,
        provider.balance_query_uses_api_key,
        existing.as_ref(),
    )?;
    let (wallet_query_url, wallet_query_token, wallet_username, wallet_password) =
        normalize_wallet_settings(
            balance_platform,
            provider.wallet_query_url,
            provider.wallet_query_token,
            provider.wallet_username,
            provider.wallet_password,
            existing.as_ref(),
        )?;

    let profile = normalize_provider_profile(ProviderProfile {
        id,
        kind,
        name,
        base_url,
        api_key,
        model,
        models,
        model_reasoning_efforts,
        model_context_windows,
        image_input_models,
        context_window: provider.context_window,
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
        api_format: provider.api_format,
        balance_platform,
        balance_query_url,
        balance_query_token,
        wallet_query_url,
        wallet_query_token,
        wallet_username,
        wallet_password,
    })?;
    write_local_provider(&paths, &profile, existing.as_ref())?;

    let state = read_state(&paths);
    if state.active_provider_id.as_deref() == Some(&profile.id) {
        write_active_provider_config(&paths, &profile)?;
        refresh_codex_models_best_effort(&profile);
    }
    emit_providers_changed(&app)?;
    Ok(provider_summary(
        &profile,
        state.active_provider_id.as_deref() == Some(&profile.id),
        state.auto_switch_provider_id.as_deref() == Some(&profile.id),
    ))
}

#[tauri::command]
pub(crate) async fn query_provider_balance<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ProviderBalance, String> {
    tauri::async_runtime::spawn_blocking(move || query_provider_balance_blocking(app, id))
        .await
        .map_err(|error| format!("Provider balance query task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn fetch_deepseek_models<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_deepseek_models_blocking(app, base_url, api_key, provider_id)
    })
    .await
    .map_err(|error| format!("DeepSeek model query task failed: {error}"))?
}

fn fetch_deepseek_models_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    let base_url = normalize_base_url(&base_url)?;
    let supplied_key = api_key.unwrap_or_default().trim().to_string();
    let token = if supplied_key.is_empty() {
        match provider_id {
            Some(id) => {
                let provider = read_provider(&resolve_paths(&app)?, &id)?;
                if provider.balance_platform != Some(ProviderBalancePlatform::DeepSeek) {
                    return Err("The selected provider is not a DeepSeek preset".to_string());
                }
                provider.api_key
            }
            None => String::new(),
        }
    } else {
        supplied_key
    };
    if token.trim().is_empty() {
        return Err("DeepSeek API key is required before fetching models".to_string());
    }

    let query_url = deepseek_endpoint_url(&base_url, "/models")?;
    let client = crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Codex-Switch")
        .build()
        .map_err(|error| format!("Failed to create DeepSeek model query client: {error}"))?;
    let response = client
        .get(query_url)
        .bearer_auth(token.trim())
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .map_err(|error| format!("DeepSeek model query failed: {error}"))?;
    let payload = read_limited_json_response(response, "DeepSeek model", MAX_MODEL_RESPONSE_BYTES)?;
    parse_deepseek_models(&payload)
}

#[tauri::command]
pub(crate) async fn query_provider_usage<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    tauri::async_runtime::spawn_blocking(move || query_provider_usage_blocking(app, id))
        .await
        .map_err(|error| format!("Provider usage query task failed: {error}"))?
}

pub(crate) fn query_provider_usage_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    let paths = resolve_paths(&app)?;
    let provider = read_provider(&paths, &id)?;
    if provider.kind != ProviderKind::OpenAi {
        return Err("Usage sync is only available for upstream Codex Switch providers".to_string());
    }
    let query_url = provider_usage_url(&provider.base_url)?;
    let client = crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Codex-Switch")
        .build()
        .map_err(|error| format!("Failed to create usage query client: {error}"))?;
    let mut request = client.get(query_url);
    if !provider.api_key.trim().is_empty() {
        request = request.bearer_auth(provider.api_key.trim());
    }
    let response = request
        .send()
        .map_err(|error| format!("Provider usage query failed: {error}"))?;
    let payload = read_balance_response(response, "Provider usage")?;
    serde_json::from_value(payload)
        .map_err(|error| format!("Provider usage response is invalid: {error}"))
}

fn provider_usage_url(base_url: &str) -> Result<Url, String> {
    let mut url =
        Url::parse(base_url).map_err(|error| format!("Provider Base URL is invalid: {error}"))?;
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&format!("{path}/usage"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn query_provider_balance_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ProviderBalance, String> {
    let paths = resolve_paths(&app)?;
    let provider = read_provider(&paths, &id)?;
    let platform = provider
        .balance_platform
        .ok_or_else(|| "Provider balance query is not enabled".to_string())?;
    let query_url = provider
        .balance_query_url
        .as_deref()
        .ok_or_else(|| "Provider balance query URL is empty".to_string())?;
    let token = provider
        .balance_query_token
        .as_deref()
        .unwrap_or(&provider.api_key)
        .trim();
    if token.is_empty() {
        return Err("Provider balance query token is empty".to_string());
    }

    let client = crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .cookie_store(true)
        .user_agent("Codex-Switch")
        .build()
        .map_err(|error| format!("Failed to create balance query client: {error}"))?;
    let payload = query_balance_payload(&client, query_url, token, None, "API balance")?;
    let parsed = parse_provider_api_balance(platform, &payload)?;
    let mut wallet_amount = parsed.embedded_wallet_amount;
    let mut wallet_unit = parsed.embedded_wallet_unit;
    let mut wallet_error = None;

    if let Some(wallet_url) = provider.wallet_query_url.as_deref() {
        let wallet_result = match platform {
            ProviderBalancePlatform::NewApi => query_new_api_wallet(
                &client,
                wallet_url,
                provider.wallet_query_token.as_deref(),
                provider.wallet_username.as_deref(),
                provider.wallet_password.as_deref(),
            ),
            ProviderBalancePlatform::Sub2Api => {
                provider.wallet_query_token.as_deref().map(|wallet_token| {
                    query_balance_payload(
                        &client,
                        wallet_url,
                        wallet_token.trim(),
                        None,
                        "Wallet balance",
                    )
                    .and_then(|payload| {
                        parse_provider_wallet_balance(ProviderBalancePlatform::Sub2Api, &payload)
                    })
                })
            }
            ProviderBalancePlatform::DeepSeek => None,
        };
        if let Some(wallet_result) = wallet_result {
            match wallet_result {
                Ok((amount, unit)) => {
                    wallet_amount = Some(amount);
                    wallet_unit = unit;
                }
                Err(error) => wallet_error = Some(error),
            }
        }
    }

    Ok(ProviderBalance {
        api_amount: parsed.amount,
        api_unit: parsed.unit,
        api_unlimited: parsed.unlimited,
        wallet_amount,
        wallet_unit,
        wallet_error,
        balance_items: parsed.balance_items,
        queried_at: chrono::Utc::now().timestamp(),
    })
}

fn query_balance_payload(
    client: &Client,
    query_url: &str,
    token: &str,
    user_id: Option<&str>,
    label: &str,
) -> Result<Value, String> {
    if token.is_empty() {
        return Err(format!("{label} query token is empty"));
    }
    let mut request = client.get(query_url).bearer_auth(token);
    if let Some(user_id) = user_id {
        request = request.header("New-Api-User", user_id);
    }
    let response = request
        .send()
        .map_err(|error| format!("{label} query failed: {error}"))?;
    read_balance_response(response, label)
}

fn query_session_balance_payload(
    client: &Client,
    query_url: &str,
    label: &str,
) -> Result<Value, String> {
    let response = client
        .get(query_url)
        .send()
        .map_err(|error| format!("{label} query failed: {error}"))?;
    read_balance_response(response, label)
}

fn read_balance_response(
    response: reqwest::blocking::Response,
    label: &str,
) -> Result<Value, String> {
    read_limited_json_response(response, label, MAX_BALANCE_RESPONSE_BYTES)
}

fn read_limited_json_response(
    response: reqwest::blocking::Response,
    label: &str,
    max_bytes: u64,
) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{label} query returned HTTP {}", status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return Err(format!("{label} response is too large"));
    }
    let mut bytes = Vec::new();
    response
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read {label} response: {error}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("{label} response is too large"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{label} response is invalid JSON: {error}"))
}

fn new_api_login_url(wallet_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(wallet_url)
        .map_err(|error| format!("New API wallet URL is invalid: {error}"))?;
    url.set_path("/api/user/login");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn json_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|id| id.to_string()))
        .or_else(|| value.as_u64().map(|id| id.to_string()))
}

struct NewApiLoginAuth {
    access_token: Option<String>,
    user_id: String,
}

fn parse_new_api_login_auth(payload: &Value) -> Result<NewApiLoginAuth, String> {
    if payload.get("success").and_then(Value::as_bool) == Some(false) {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .filter(|message| !message.trim().is_empty())
            .unwrap_or("username or password was rejected");
        return Err(format!("New API wallet login failed: {message}"));
    }
    let data = payload
        .get("data")
        .ok_or_else(|| "New API wallet login response is missing data".to_string())?;
    let user = data.get("user").unwrap_or(data);
    let access_token = data
        .get("access_token")
        .or_else(|| data.get("accessToken"))
        .or_else(|| user.get("access_token"))
        .or_else(|| user.get("accessToken"))
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .map(str::to_string);
    let user_id = user
        .get("id")
        .and_then(json_id)
        .or_else(|| data.get("id").and_then(json_id))
        .ok_or_else(|| "New API wallet login response is missing the user id".to_string())?;
    Ok(NewApiLoginAuth {
        access_token,
        user_id,
    })
}

fn query_new_api_wallet_with_login(
    client: &Client,
    wallet_url: &str,
    username: &str,
    password: &str,
    preferred_wallet_token: Option<&str>,
) -> Result<(f64, String), String> {
    if username.trim().is_empty() || password.is_empty() {
        return Err("New API wallet username or password is empty".to_string());
    }
    let login_url = new_api_login_url(wallet_url)?;
    let response = client
        .post(login_url)
        .json(&json!({ "username": username.trim(), "password": password }))
        .send()
        .map_err(|error| format!("New API wallet login failed: {error}"))?;
    let payload = read_balance_response(response, "New API wallet login")?;
    let auth = parse_new_api_login_auth(&payload)?;
    let mut prior_error = None;
    if let Some(wallet_token) = preferred_wallet_token.filter(|token| !token.trim().is_empty()) {
        match query_balance_payload(
            client,
            wallet_url,
            wallet_token.trim(),
            Some(&auth.user_id),
            "Wallet balance",
        )
        .and_then(|payload| {
            parse_provider_wallet_balance(ProviderBalancePlatform::NewApi, &payload)
        }) {
            Ok(balance) => return Ok(balance),
            Err(error) => prior_error = Some(format!("Wallet token query failed: {error}")),
        }
    }
    if let Some(access_token) = auth
        .access_token
        .as_deref()
        .filter(|token| Some(*token) != preferred_wallet_token)
    {
        match query_balance_payload(
            client,
            wallet_url,
            access_token,
            Some(&auth.user_id),
            "Wallet balance",
        )
        .and_then(|payload| {
            parse_provider_wallet_balance(ProviderBalancePlatform::NewApi, &payload)
        }) {
            Ok(balance) => return Ok(balance),
            Err(error) => prior_error = Some(format!("Login token query failed: {error}")),
        }
    }
    query_session_balance_payload(client, wallet_url, "Wallet balance")
        .and_then(|payload| {
            parse_provider_wallet_balance(ProviderBalancePlatform::NewApi, &payload)
        })
        .map_err(|session_error| match prior_error {
            Some(prior_error) => {
                format!("{prior_error}; session fallback failed: {session_error}")
            }
            None => format!("Session wallet query failed: {session_error}"),
        })
}

fn query_new_api_wallet(
    client: &Client,
    wallet_url: &str,
    wallet_token: Option<&str>,
    username: Option<&str>,
    password: Option<&str>,
) -> Option<Result<(f64, String), String>> {
    match (username, password) {
        (Some(username), Some(password)) => Some(query_new_api_wallet_with_login(
            client,
            wallet_url,
            username,
            password,
            wallet_token,
        )),
        _ => wallet_token
            .filter(|token| !token.trim().is_empty())
            .map(|token| {
                query_balance_payload(client, wallet_url, token.trim(), None, "Wallet balance")
                    .and_then(|payload| {
                        parse_provider_wallet_balance(ProviderBalancePlatform::NewApi, &payload)
                    })
            }),
    }
}

#[tauri::command]
pub(crate) async fn switch_provider<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || switch_provider_blocking(app, id))
        .await
        .map_err(|error| format!("Provider switch task failed: {error}"))?
}

pub(crate) fn switch_provider_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let provider = read_provider(&paths, &id)?;
    activate_provider_profile(&app, &paths, &provider)
}

pub(crate) fn switch_provider_model_and_activate_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    model: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let mut provider = read_provider(&paths, &id)?;
    if provider.model_selection_controlled_by_codex {
        return Err("Provider model selection is controlled within Codex".to_string());
    }
    let selected_model = require_non_empty("Model", &model)?;
    if !provider.models.iter().any(|value| value == &selected_model) {
        return Err("Provider model does not exist".to_string());
    }
    provider.model = selected_model;
    provider = normalize_provider_profile(provider)?;
    validate_provider_activation(&provider)?;
    write_local_provider(&paths, &provider, None)?;
    activate_provider_profile(&app, &paths, &provider)
}

fn activate_provider_profile<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    provider: &ProviderProfile,
) -> Result<(), String> {
    validate_provider_activation(provider)?;
    let original_state = read_state(paths);
    backup_codex_config_if_needed(paths, original_state.active_provider_id.is_none())?;
    let mut state = original_state.clone();
    state.active_provider_id = Some(provider.id.clone());
    state.active_account_id = None;
    state.concurrent_account_routing_enabled = false;
    write_state(paths, &state)?;
    if let Err(error) = write_provider_local_proxy_config(paths, provider) {
        if let Err(rollback_error) = write_state(paths, &original_state) {
            eprintln!("failed to restore provider state after activation error: {rollback_error}");
        }
        return Err(error);
    }
    refresh_codex_models_best_effort(provider);
    emit_providers_changed(app)
}

fn validate_provider_activation(provider: &ProviderProfile) -> Result<(), String> {
    ensure_not_local_proxy_base_url(&provider.base_url)?;
    ensure_local_proxy_running_for_provider()?;
    if provider.kind != ProviderKind::OpenAi && provider.api_key.trim().is_empty() {
        return Err("Provider API key is empty".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn switch_provider_model<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    model: String,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(&app)?;
    let mut provider = read_provider(&paths, &id)?;
    let selected_model = require_non_empty("Model", &model)?;
    if !provider.models.iter().any(|value| value == &selected_model) {
        provider.models.push(selected_model.clone());
    }
    provider.model = selected_model;
    provider = normalize_provider_profile(provider)?;
    write_local_provider(&paths, &provider, None)?;

    let state = read_state(&paths);
    let active = state.active_provider_id.as_deref() == Some(&provider.id);
    if active {
        write_active_provider_config(&paths, &provider)?;
        refresh_codex_models_best_effort(&provider);
    }
    emit_providers_changed(&app)?;
    Ok(provider_summary(
        &provider,
        active,
        state.auto_switch_provider_id.as_deref() == Some(&provider.id),
    ))
}

#[tauri::command]
pub(crate) fn set_provider_model_control<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    controlled_by_codex: bool,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(&app)?;
    let mut provider = read_provider(&paths, &id)?;
    provider.model_selection_controlled_by_codex = controlled_by_codex;
    provider = normalize_provider_profile(provider)?;
    write_local_provider(&paths, &provider, None)?;

    let state = read_state(&paths);
    let active = state.active_provider_id.as_deref() == Some(&provider.id);
    if active {
        write_active_provider_config(&paths, &provider)?;
        refresh_codex_models_best_effort(&provider);
    }
    emit_providers_changed(&app)?;
    Ok(provider_summary(
        &provider,
        active,
        state.auto_switch_provider_id.as_deref() == Some(&provider.id),
    ))
}

#[tauri::command]
pub(crate) fn set_provider_auto_switch_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let provider = read_provider(&paths, &id)?;
    if provider.kind != ProviderKind::Custom {
        return Err("Automatic fallback is only available for third-party Providers".to_string());
    }

    let mut state = read_state(&paths);
    let next_provider_id = if enabled { Some(id.clone()) } else { None };
    if enabled || state.auto_switch_provider_id.as_deref() == Some(&id) {
        state.auto_switch_provider_id = next_provider_id;
        write_state(&paths, &state)?;
        emit_providers_changed(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn disable_provider<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let original_state = read_state(&paths);
    let mut state = original_state.clone();
    state.active_provider_id = None;
    if crate::local_proxy::is_running() {
        backup_codex_config_if_needed(&paths, original_state.active_provider_id.is_none())?;
        write_state(&paths, &state)?;
        if let Err(error) = write_official_local_proxy_config(&paths) {
            let _ = write_state(&paths, &original_state);
            return Err(error);
        }
    } else {
        restore_official_config(&paths)?;
        write_state(&paths, &state)?;
    }
    refresh_codex_models_for_current_target(&paths);
    emit_providers_changed(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    validate_provider_id(&id)?;
    let original_state = read_state(&paths);
    let was_active = original_state.active_provider_id.as_deref() == Some(&id);
    let was_auto_switch_provider = original_state.auto_switch_provider_id.as_deref() == Some(&id);
    if was_active || was_auto_switch_provider {
        let mut state = original_state.clone();
        if was_auto_switch_provider {
            state.auto_switch_provider_id = None;
        }
        if was_active {
            state.active_provider_id = None;
            if crate::local_proxy::is_running() {
                write_state(&paths, &state)?;
                if let Err(error) = write_official_local_proxy_config(&paths) {
                    let _ = write_state(&paths, &original_state);
                    return Err(error);
                }
            } else {
                restore_official_config(&paths)?;
                write_state(&paths, &state)?;
            }
        } else {
            write_state(&paths, &state)?;
        }
    }
    let path = provider_path(&paths, &id);
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("Failed to delete provider: {error}"))?;
    }
    let versions_path = provider_field_modified_at_path(&paths, &id);
    if versions_path.exists() {
        fs::remove_file(&versions_path)
            .map_err(|error| format!("Failed to delete provider field versions: {error}"))?;
    }
    if was_active {
        refresh_codex_models_for_current_target(&paths);
    }
    emit_providers_changed(&app)?;
    Ok(())
}

pub(crate) fn apply_local_proxy_config_for_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    apply_local_proxy_config_for_paths(&paths)?;
    refresh_codex_models_for_current_target(&paths);
    Ok(())
}

pub(crate) fn apply_local_proxy_config_for_paths(paths: &Paths) -> Result<(), String> {
    let state = read_state(paths);
    sync_local_proxy_openai_auth_for_state(paths, &state)?;
    backup_codex_config_if_needed(paths, state.active_provider_id.is_none())?;
    if let Some(id) = state.active_provider_id.as_deref() {
        let provider = read_provider(paths, id)?;
        ensure_not_local_proxy_base_url(&provider.base_url)?;
        write_provider_local_proxy_config(paths, &provider)
    } else {
        write_official_local_proxy_config(paths)
    }
}

pub(crate) fn ensure_local_proxy_compatible_for_state(paths: &Paths) -> Result<(), String> {
    let state = read_state(paths);
    validate_local_proxy_openai_auth_account(
        paths,
        state.local_proxy_openai_auth_account_id.as_deref(),
    )?;
    if state.active_provider_id.is_some() {
        return Ok(());
    }
    let Some(account_id) = state.active_account_id.as_deref() else {
        return Ok(());
    };
    let auth = read_json(&managed_auth_path(paths, account_id))?;
    validate_official_auth_for_local_proxy(&auth)
}

pub(crate) fn activate_provider_for_sync(paths: &Paths, id: &str) -> Result<bool, String> {
    let provider = read_provider(paths, id)?;
    ensure_not_local_proxy_base_url(&provider.base_url)?;
    if provider.kind != ProviderKind::OpenAi && provider.api_key.trim().is_empty() {
        return Ok(false);
    }
    if !crate::local_proxy::is_running() {
        return Ok(false);
    }

    let original_state = read_state(paths);
    backup_codex_config_if_needed(paths, original_state.active_provider_id.is_none())?;
    let mut state = original_state.clone();
    state.active_provider_id = Some(provider.id.clone());
    state.active_account_id = None;
    state.concurrent_account_routing_enabled = false;
    write_state(paths, &state)?;
    if let Err(error) = write_provider_local_proxy_config(paths, &provider) {
        let _ = write_state(paths, &original_state);
        return Err(error);
    }
    refresh_codex_models_best_effort(&provider);
    Ok(true)
}

pub(crate) fn cleanup_stale_local_proxy_config<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    cleanup_non_proxy_provider_state(&paths)
}

fn cleanup_non_proxy_provider_state(paths: &Paths) -> Result<(), String> {
    let mut state = read_state(paths);
    let has_managed_proxy_config = if paths.current_config.exists() {
        let current = fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?;
        config_contains_local_proxy(&current)
    } else {
        false
    };
    if state.active_provider_id.is_none() && !has_managed_proxy_config {
        return Ok(());
    }
    restore_official_config(paths)?;
    state.active_provider_id = None;
    state.local_proxy_enabled = false;
    write_state(paths, &state)
}

pub(crate) fn restore_official_config(paths: &Paths) -> Result<(), String> {
    if paths.config_backup.exists() {
        let backup = fs::read_to_string(&paths.config_backup)
            .map_err(|error| format!("Failed to read Codex config backup: {error}"))?;
        // Older interrupted/direct Provider switches could leave Codex Switch's
        // managed blocks inside the backup itself. Never restore those blocks when
        // returning to an official account.
        let official_config =
            if backup.contains(PROVIDER_ROOT_START) || backup.contains(PROVIDER_TABLE_START) {
                remove_marked_blocks(&backup)
            } else {
                backup
            };
        if official_config.trim().is_empty() {
            if paths.current_config.exists() {
                fs::remove_file(&paths.current_config)
                    .map_err(|error| format!("Failed to remove managed Codex config: {error}"))?;
            }
        } else {
            write_text_if_changed(&paths.current_config, &official_config)?;
        }
        fs::remove_file(&paths.config_backup)
            .map_err(|error| format!("Failed to clear Codex config backup: {error}"))?;
        return Ok(());
    }

    if paths.current_config.exists() {
        let current = fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?;
        let cleaned = remove_marked_blocks(&current);
        if cleaned.trim().is_empty() {
            fs::remove_file(&paths.current_config)
                .map_err(|error| format!("Failed to remove managed Codex config: {error}"))?;
        } else if cleaned != current {
            write_text_if_changed(&paths.current_config, &cleaned)?;
        }
    }
    Ok(())
}

fn provider_path(paths: &Paths, id: &str) -> PathBuf {
    paths.providers.join(format!("{id}.json"))
}

fn provider_field_modified_at_path(paths: &Paths, id: &str) -> PathBuf {
    paths.providers.join(format!("{id}.field-modified-at.json"))
}

pub(crate) fn list_provider_profiles(paths: &Paths) -> Result<Vec<ProviderProfile>, String> {
    fs::create_dir_all(&paths.providers)
        .map_err(|error| format!("Failed to create provider store: {error}"))?;

    let mut providers = Vec::new();
    for entry in fs::read_dir(&paths.providers)
        .map_err(|error| format!("Failed to read provider store: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json")
            || entry
                .file_name()
                .to_string_lossy()
                .ends_with(".field-modified-at.json")
        {
            continue;
        }
        providers.push(read_provider_file(entry.path())?);
    }
    providers.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(providers)
}

pub(crate) fn read_provider(paths: &Paths, id: &str) -> Result<ProviderProfile, String> {
    validate_provider_id(id)?;
    read_provider_file(provider_path(paths, id))
}

fn read_provider_file(path: PathBuf) -> Result<ProviderProfile, String> {
    let value = read_json(&path)?;
    let profile: ProviderProfile = serde_json::from_value(value)
        .map_err(|error| format!("Provider profile {} is invalid: {error}", path.display()))?;
    normalize_provider_profile(profile)
        .map_err(|error| format!("Provider profile {} is invalid: {error}", path.display()))
}

fn write_provider(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    let value = serde_json::to_value(provider).map_err(|error| error.to_string())?;
    write_json_atomic(&provider_path(paths, &provider.id), &value)
}

fn provider_field_values(provider: &ProviderProfile) -> Vec<serde_json::Value> {
    vec![
        json!(provider.kind),
        json!(provider.name),
        json!(provider.base_url),
        json!(provider.api_key),
        json!(provider.model),
        json!(provider.models),
        json!(provider.model_reasoning_efforts),
        json!(provider.model_context_windows),
        json!(provider.image_input_models),
        json!(provider.context_window),
        json!(provider.model_selection_controlled_by_codex),
        json!(provider.api_format),
        json!(provider.balance_platform),
        json!(provider.balance_query_url),
        json!(provider.balance_query_token),
        json!(provider.wallet_query_url),
        json!(provider.wallet_query_token),
        json!(provider.wallet_username),
        json!(provider.wallet_password),
    ]
}

fn provider_field_versions_mut(values: &mut ProviderFieldModifiedAt) -> [&mut String; 19] {
    [
        &mut values.kind,
        &mut values.name,
        &mut values.base_url,
        &mut values.api_key,
        &mut values.model,
        &mut values.models,
        &mut values.model_reasoning_efforts,
        &mut values.model_context_windows,
        &mut values.image_input_models,
        &mut values.context_window,
        &mut values.model_selection_controlled_by_codex,
        &mut values.api_format,
        &mut values.balance_platform,
        &mut values.balance_query_url,
        &mut values.balance_query_token,
        &mut values.wallet_query_url,
        &mut values.wallet_query_token,
        &mut values.wallet_username,
        &mut values.wallet_password,
    ]
}

pub(crate) fn load_or_init_provider_field_modified_at(
    paths: &Paths,
    id: &str,
) -> Result<ProviderFieldModifiedAt, String> {
    let fallback = provider_modified_at(paths, id)
        .unwrap_or_else(|_| chrono::Utc::now())
        .to_rfc3339();
    let path = provider_field_modified_at_path(paths, id);
    let mut values = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let mut changed = false;
    for value in provider_field_versions_mut(&mut values) {
        if value.trim().is_empty() {
            *value = fallback.clone();
            changed = true;
        }
    }
    if changed {
        save_provider_field_modified_at(paths, id, &values)?;
    }
    Ok(values)
}

pub(crate) fn save_provider_field_modified_at(
    paths: &Paths,
    id: &str,
    values: &ProviderFieldModifiedAt,
) -> Result<(), String> {
    write_json_atomic(
        &provider_field_modified_at_path(paths, id),
        &serde_json::to_value(values).map_err(|error| error.to_string())?,
    )
}

fn write_local_provider(
    paths: &Paths,
    provider: &ProviderProfile,
    known_existing: Option<&ProviderProfile>,
) -> Result<(), String> {
    let existing = known_existing
        .cloned()
        .or_else(|| read_provider(paths, &provider.id).ok());
    let mut versions = if existing.is_some() {
        load_or_init_provider_field_modified_at(paths, &provider.id)?
    } else {
        ProviderFieldModifiedAt::default()
    };
    let now = chrono::Utc::now().to_rfc3339();
    let old_values = existing.as_ref().map(provider_field_values);
    let new_values = provider_field_values(provider);
    for (index, version) in provider_field_versions_mut(&mut versions)
        .into_iter()
        .enumerate()
    {
        if old_values
            .as_ref()
            .is_none_or(|values| values[index] != new_values[index])
        {
            *version = now.clone();
        }
    }
    write_provider(paths, provider)?;
    save_provider_field_modified_at(paths, &provider.id, &versions)
}

pub(crate) fn write_synced_provider(
    paths: &Paths,
    provider: ProviderProfile,
    field_modified_at: &ProviderFieldModifiedAt,
) -> Result<ProviderProfile, String> {
    let profile = normalize_synced_provider(provider)?;
    write_provider(paths, &profile)?;
    save_provider_field_modified_at(paths, &profile.id, field_modified_at)?;
    Ok(profile)
}

pub(crate) fn provider_modified_at(
    paths: &Paths,
    id: &str,
) -> Result<chrono::DateTime<chrono::Utc>, String> {
    let path = provider_path(paths, id);
    fs::metadata(&path)
        .and_then(|metadata| metadata.modified())
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map_err(|error| {
            format!(
                "Failed to read provider modified time {}: {error}",
                path.display()
            )
        })
}

fn provider_summary(
    provider: &ProviderProfile,
    active: bool,
    auto_switch_enabled: bool,
) -> ProviderSummary {
    ProviderSummary {
        id: provider.id.clone(),
        kind: provider.kind,
        name: provider.name.clone(),
        base_url: provider.base_url.clone(),
        model: provider.model.clone(),
        models: provider.models.clone(),
        model_reasoning_efforts: provider.model_reasoning_efforts.clone(),
        model_context_windows: provider.model_context_windows.clone(),
        image_input_models: provider.image_input_models.clone(),
        context_window: provider.context_window,
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
        api_format: provider.api_format,
        active,
        auto_switch_enabled: auto_switch_enabled && provider.kind == ProviderKind::Custom,
        has_api_key: !provider.api_key.trim().is_empty(),
        supports_direct_switch: provider_switch_supported(crate::local_proxy::is_running()),
        balance_platform: provider.balance_platform,
        balance_query_url: provider.balance_query_url.clone(),
        balance_query_uses_api_key: provider.balance_query_token.is_none(),
        has_balance_query_token: provider
            .balance_query_token
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
        wallet_query_url: provider.wallet_query_url.clone(),
        has_wallet_query_token: provider
            .wallet_query_token
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
        wallet_username: provider.wallet_username.clone(),
        has_wallet_login_credentials: provider
            .wallet_username
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && provider
                .wallet_password
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
    }
}

type NormalizedBalanceSettings = (
    Option<ProviderBalancePlatform>,
    Option<String>,
    Option<String>,
);

type NormalizedWalletSettings = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn normalize_balance_settings(
    platform: Option<ProviderBalancePlatform>,
    query_url: Option<String>,
    supplied_token: Option<String>,
    uses_api_key: bool,
    existing: Option<&ProviderProfile>,
) -> Result<NormalizedBalanceSettings, String> {
    let Some(platform) = platform else {
        return Ok((None, None, None));
    };
    let query_url = normalize_balance_query_url(query_url.as_deref().unwrap_or_default())?;
    if platform == ProviderBalancePlatform::DeepSeek {
        validate_deepseek_balance_query_url(&query_url)?;
    }
    let query_token = if uses_api_key {
        None
    } else {
        let supplied = supplied_token.unwrap_or_default().trim().to_string();
        if !supplied.is_empty() {
            Some(supplied)
        } else {
            existing
                .filter(|profile| profile.balance_platform == Some(platform))
                .and_then(|profile| profile.balance_query_token.clone())
                .filter(|token| !token.trim().is_empty())
        }
    };
    if !uses_api_key && query_token.is_none() {
        return Err("Provider balance query token is required".to_string());
    }
    Ok((Some(platform), Some(query_url), query_token))
}

fn normalize_wallet_settings(
    platform: Option<ProviderBalancePlatform>,
    query_url: Option<String>,
    supplied_token: Option<String>,
    supplied_username: Option<String>,
    supplied_password: Option<String>,
    existing: Option<&ProviderProfile>,
) -> Result<NormalizedWalletSettings, String> {
    if platform.is_none() {
        return Ok((None, None, None, None));
    }
    if platform == Some(ProviderBalancePlatform::DeepSeek) {
        return Ok((None, None, None, None));
    }
    let query_url = query_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| normalize_balance_query_url(&value))
        .transpose()?;
    let supplied_token = supplied_token.unwrap_or_default().trim().to_string();
    let query_token = if !supplied_token.is_empty() {
        Some(supplied_token)
    } else {
        existing
            .filter(|profile| {
                profile.balance_platform == platform && profile.wallet_query_url == query_url
            })
            .and_then(|profile| profile.wallet_query_token.clone())
            .filter(|token| !token.trim().is_empty())
    };
    if query_token.is_some() && query_url.is_none() {
        return Err("Provider wallet query URL is required when a wallet token is set".to_string());
    }
    let supplied_username = supplied_username.unwrap_or_default().trim().to_string();
    let supplied_password = supplied_password.unwrap_or_default();
    let existing_login = existing
        .filter(|profile| {
            profile.balance_platform == platform && profile.wallet_query_url == query_url
        })
        .map(|profile| {
            (
                profile.wallet_username.clone(),
                profile.wallet_password.clone(),
            )
        })
        .unwrap_or((None, None));
    let (wallet_username, wallet_password) =
        if platform == Some(ProviderBalancePlatform::NewApi) && !supplied_password.is_empty() {
            if supplied_username.is_empty() {
                return Err(
                    "New API wallet username and password must be provided together".to_string(),
                );
            }
            (Some(supplied_username), Some(supplied_password))
        } else if platform == Some(ProviderBalancePlatform::NewApi) {
            if !supplied_username.is_empty()
                && existing_login.0.as_deref() != Some(supplied_username.as_str())
            {
                return Err(
                    "New API wallet password is required when changing the username".to_string(),
                );
            }
            existing_login
        } else {
            (None, None)
        };
    if (wallet_username.is_some() || wallet_password.is_some()) && query_url.is_none() {
        return Err(
            "Provider wallet query URL is required when wallet login is configured".to_string(),
        );
    }
    Ok((query_url, query_token, wallet_username, wallet_password))
}

fn normalize_balance_query_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Provider balance query URL is required".to_string());
    }
    let url = Url::parse(trimmed)
        .map_err(|error| format!("Provider balance query URL is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(
            "Provider balance query URL must be an http:// or https:// URL with a host".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

struct ParsedProviderApiBalance {
    amount: Option<f64>,
    unit: String,
    unlimited: bool,
    embedded_wallet_amount: Option<f64>,
    embedded_wallet_unit: String,
    balance_items: Vec<ProviderBalanceItem>,
}

fn parse_provider_api_balance(
    platform: ProviderBalancePlatform,
    payload: &Value,
) -> Result<ParsedProviderApiBalance, String> {
    let (amount, unit, unlimited, embedded_wallet_amount, embedded_wallet_unit, balance_items) =
        match platform {
            ProviderBalancePlatform::NewApi => {
                let data = payload
                    .get("data")
                    .ok_or_else(|| "New API balance response is missing data".to_string())?;
                let unlimited = data
                    .get("unlimited_quota")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let available = data
                    .get("total_available")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| {
                        "New API balance response is missing data.total_available".to_string()
                    })?;
                (
                    (!unlimited).then_some((available / NEW_API_QUOTA_PER_USD).max(0.0)),
                    "USD".to_string(),
                    unlimited,
                    None,
                    "USD".to_string(),
                    Vec::new(),
                )
            }
            ProviderBalancePlatform::Sub2Api => {
                let mode = payload.get("mode").and_then(Value::as_str);
                let remaining = payload
                    .get("remaining")
                    .and_then(Value::as_f64)
                    .or_else(|| {
                        payload
                            .get("quota")
                            .and_then(|quota| quota.get("remaining"))
                            .and_then(Value::as_f64)
                    })
                    .ok_or_else(|| "Sub2API balance response is missing remaining".to_string())?;
                let embedded_wallet_amount = payload.get("balance").and_then(Value::as_f64);
                let is_wallet_mode =
                    mode == Some("unrestricted") && embedded_wallet_amount.is_some();
                let unlimited = is_wallet_mode || remaining < 0.0;
                (
                    (!unlimited).then_some(remaining.max(0.0)),
                    payload
                        .get("unit")
                        .and_then(Value::as_str)
                        .unwrap_or("USD")
                        .to_string(),
                    unlimited,
                    embedded_wallet_amount,
                    payload
                        .get("unit")
                        .and_then(Value::as_str)
                        .unwrap_or("USD")
                        .to_string(),
                    Vec::new(),
                )
            }
            ProviderBalancePlatform::DeepSeek => {
                let available = payload
                    .get("is_available")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let mut balance_items = Vec::new();
                for item in payload
                    .get("balance_infos")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let unit = item
                        .get("currency")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|unit| !unit.is_empty())
                        .unwrap_or("CNY")
                        .to_string();
                    let amount =
                        item.get("total_balance")
                            .and_then(json_number)
                            .ok_or_else(|| {
                                "DeepSeek balance response contains an invalid total_balance"
                                    .to_string()
                            })?;
                    balance_items.push(ProviderBalanceItem { amount, unit });
                }
                if available && balance_items.is_empty() {
                    return Err("DeepSeek balance response is missing balance_infos".to_string());
                }
                let primary = balance_items.first();
                (
                    primary.map(|item| item.amount),
                    primary
                        .map(|item| item.unit.clone())
                        .unwrap_or_else(|| "CNY".to_string()),
                    !available,
                    None,
                    "CNY".to_string(),
                    balance_items,
                )
            }
        };
    Ok(ParsedProviderApiBalance {
        amount,
        unit,
        unlimited,
        embedded_wallet_amount,
        embedded_wallet_unit,
        balance_items,
    })
}

fn json_number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.trim().parse().ok()))
}

fn parse_deepseek_models(payload: &Value) -> Result<Vec<String>, String> {
    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "DeepSeek model response is missing data".to_string())?;
    let mut models = Vec::new();
    for item in data {
        if let Some(model) = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty())
        {
            push_model_once(&mut models, model.to_string());
        }
    }
    if models.is_empty() {
        Err("DeepSeek did not return any available models".to_string())
    } else {
        Ok(models)
    }
}

pub(crate) fn deepseek_endpoint_url(base_url: &str, endpoint: &str) -> Result<Url, String> {
    let mut url =
        Url::parse(base_url).map_err(|error| format!("DeepSeek Base URL is invalid: {error}"))?;
    if url.scheme() != "https"
        || url.host_str() != Some("api.deepseek.com")
        || url.port_or_known_default() != Some(443)
    {
        return Err(
            "DeepSeek Base URL must use the official https://api.deepseek.com endpoint".to_string(),
        );
    }
    let mut path = url.path().trim_end_matches('/').to_string();
    if !path.is_empty() && path != "/v1" {
        return Err(
            "DeepSeek Base URL must use the official https://api.deepseek.com endpoint".to_string(),
        );
    }
    if path.ends_with("/v1") {
        path.truncate(path.len() - 3);
    }
    url.set_path(&format!(
        "{}/{}",
        path.trim_end_matches('/'),
        endpoint.trim_start_matches('/')
    ));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn validate_deepseek_balance_query_url(value: &str) -> Result<(), String> {
    let expected = deepseek_endpoint_url("https://api.deepseek.com", "/user/balance")?;
    let actual = Url::parse(value)
        .map_err(|error| format!("Provider balance query URL is invalid: {error}"))?;
    if actual == expected {
        Ok(())
    } else {
        Err("DeepSeek balance queries must use the official endpoint".to_string())
    }
}

fn parse_provider_wallet_balance(
    platform: ProviderBalancePlatform,
    payload: &Value,
) -> Result<(f64, String), String> {
    match platform {
        ProviderBalancePlatform::NewApi => {
            let quota = payload
                .get("data")
                .and_then(|data| data.get("quota"))
                .and_then(Value::as_f64)
                .ok_or_else(|| "New API wallet response is missing data.quota".to_string())?;
            Ok(((quota / NEW_API_QUOTA_PER_USD).max(0.0), "USD".to_string()))
        }
        ProviderBalancePlatform::Sub2Api => {
            let balance = payload
                .get("data")
                .and_then(|data| data.get("balance"))
                .and_then(Value::as_f64)
                .ok_or_else(|| "Sub2API wallet response is missing data.balance".to_string())?;
            Ok((balance.max(0.0), "USD".to_string()))
        }
        ProviderBalancePlatform::DeepSeek => {
            Err("DeepSeek does not use a separate wallet balance endpoint".to_string())
        }
    }
}

fn require_non_empty(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn normalize_model_selection(
    model: &str,
    models: Vec<String>,
) -> Result<(String, Vec<String>), String> {
    let selected = require_non_empty("Model", model)?;
    let mut normalized = Vec::new();
    push_model_once(&mut normalized, selected.clone());
    for model in models {
        push_model_once(&mut normalized, model);
    }
    Ok((selected, normalized))
}

fn normalize_model_subset(models: &[String], selected: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for model in selected {
        let trimmed = model.trim();
        if models.iter().any(|candidate| candidate == trimmed)
            && !normalized.iter().any(|candidate| candidate == trimmed)
        {
            normalized.push(trimmed.to_string());
        }
    }
    normalized
}

fn normalize_model_reasoning_efforts(
    models: &[String],
    configured: ModelReasoningEfforts,
) -> ModelReasoningEfforts {
    let mut normalized = ModelReasoningEfforts::new();
    for (configured_model, efforts) in configured {
        let model = configured_model.trim();
        if efforts.is_empty() || !models.iter().any(|candidate| candidate == model) {
            continue;
        }
        let mut unique = Vec::new();
        for effort in efforts {
            if !unique.contains(&effort) {
                unique.push(effort);
            }
        }
        normalized.insert(model.to_string(), unique);
    }
    normalized
}

fn normalize_model_context_windows(
    models: &[String],
    configured: ModelContextWindows,
) -> ModelContextWindows {
    configured
        .into_iter()
        .filter_map(|(configured_model, context_window)| {
            let model = configured_model.trim();
            let is_known = models.iter().any(|candidate| candidate == model);
            (is_known && context_window > 0).then(|| (model.to_string(), context_window))
        })
        .collect()
}

fn normalize_provider_profile(mut provider: ProviderProfile) -> Result<ProviderProfile, String> {
    if provider.context_window == Some(0) {
        return Err("Context window must be greater than zero".to_string());
    }
    if provider.kind == ProviderKind::OpenAi {
        if provider.model.trim().is_empty() {
            provider.model = DEFAULT_OFFICIAL_MODEL.to_string();
        }
        provider.model_selection_controlled_by_codex = true;
        provider.api_format = ProviderApiFormat::OpenaiResponses;
    }
    if provider.balance_platform == Some(ProviderBalancePlatform::DeepSeek) {
        if provider.kind != ProviderKind::Custom {
            return Err("DeepSeek presets must be third-party proxy providers".to_string());
        }
        deepseek_endpoint_url(&provider.base_url, "/chat/completions")?;
        validate_deepseek_balance_query_url(
            provider.balance_query_url.as_deref().unwrap_or_default(),
        )?;
        provider.api_format = ProviderApiFormat::OpenaiChat;
        provider.balance_query_token = None;
        provider.wallet_query_url = None;
        provider.wallet_query_token = None;
        provider.wallet_username = None;
        provider.wallet_password = None;
    }
    let (model, models) = normalize_model_selection(&provider.model, provider.models)?;
    provider.model = model;
    provider.models = models;
    provider.model_reasoning_efforts =
        normalize_model_reasoning_efforts(&provider.models, provider.model_reasoning_efforts);
    provider.model_context_windows =
        normalize_model_context_windows(&provider.models, provider.model_context_windows);
    provider.image_input_models =
        normalize_model_subset(&provider.models, provider.image_input_models);
    match provider.balance_platform {
        Some(_) => {
            provider.balance_query_url = Some(normalize_balance_query_url(
                provider.balance_query_url.as_deref().unwrap_or_default(),
            )?);
            provider.balance_query_token = provider
                .balance_query_token
                .take()
                .map(|token| token.trim().to_string())
                .filter(|token| !token.is_empty());
            provider.wallet_query_url = provider
                .wallet_query_url
                .take()
                .map(|url| normalize_balance_query_url(&url))
                .transpose()?;
            provider.wallet_query_token = provider
                .wallet_query_token
                .take()
                .map(|token| token.trim().to_string())
                .filter(|token| !token.is_empty());
            provider.wallet_username = provider
                .wallet_username
                .take()
                .map(|username| username.trim().to_string())
                .filter(|username| !username.is_empty());
            provider.wallet_password = provider
                .wallet_password
                .take()
                .filter(|password| !password.is_empty());
        }
        None => {
            provider.balance_query_url = None;
            provider.balance_query_token = None;
            provider.wallet_query_url = None;
            provider.wallet_query_token = None;
            provider.wallet_username = None;
            provider.wallet_password = None;
        }
    }
    Ok(provider)
}

pub(crate) fn uses_upstream_official_models(provider: &ProviderProfile) -> bool {
    provider.kind == ProviderKind::OpenAi
}

fn normalize_synced_provider(mut provider: ProviderProfile) -> Result<ProviderProfile, String> {
    validate_provider_id(&provider.id)?;
    provider.name = require_non_empty("Provider name", &provider.name)?;
    provider.base_url = normalize_base_url(&provider.base_url)?;
    provider.api_key = provider.api_key.trim().to_string();
    if provider.kind != ProviderKind::OpenAi && provider.api_key.is_empty() {
        return Err("Provider API key is empty".to_string());
    }
    normalize_provider_profile(provider)
}

fn push_model_once(models: &mut Vec<String>, model: String) {
    let trimmed = model.trim();
    if trimmed.is_empty() || models.iter().any(|value| value == trimmed) {
        return;
    }
    models.push(trimmed.to_string());
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is required".to_string());
    }
    let url = Url::parse(trimmed).map_err(|error| format!("Base URL is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Base URL must be an http:// or https:// URL with a host".to_string());
    }
    if is_local_proxy_url(&url) {
        return Err("Provider Base URL must be an upstream API endpoint, not the Codex Switch local proxy endpoint".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn ensure_not_local_proxy_base_url(base_url: &str) -> Result<(), String> {
    let url = Url::parse(base_url).map_err(|error| format!("Base URL is invalid: {error}"))?;
    if is_local_proxy_url(&url) {
        Err("Provider Base URL must be an upstream API endpoint, not the Codex Switch local proxy endpoint".to_string())
    } else {
        Ok(())
    }
}

fn is_local_proxy_url(url: &Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    matches!(host.as_str(), LOCAL_PROXY_HOST | "localhost" | "::1")
        && url.port_or_known_default() == Some(LOCAL_PROXY_PORT)
}

pub(crate) fn validate_local_proxy_openai_auth_account(
    paths: &Paths,
    account_id: Option<&str>,
) -> Result<(), String> {
    let Some(account_id) = account_id else {
        return Ok(());
    };
    let auth = read_json(&managed_auth_path(paths, account_id))
        .map_err(|_| "OpenAI login account does not exist".to_string())?;
    validate_auth(&auth)
        .map_err(|error| format!("OpenAI login account has an invalid auth.json: {error}"))?;
    if is_agent_identity_auth(&auth) {
        return Err("OpenAI login account must use an OAuth token".to_string());
    }
    Ok(())
}

pub(crate) fn sync_local_proxy_openai_auth(paths: &Paths) -> Result<(), String> {
    let state = read_state(paths);
    sync_local_proxy_openai_auth_for_state(paths, &state)
}

fn sync_local_proxy_openai_auth_for_state(
    paths: &Paths,
    state: &crate::models::ManagerStateFile,
) -> Result<(), String> {
    if let Some(account_id) = state.local_proxy_openai_auth_account_id.as_deref() {
        validate_local_proxy_openai_auth_account(paths, Some(account_id))?;
        let auth = read_json(&managed_auth_path(paths, account_id))?;
        write_json_if_changed(&paths.current_auth, &auth)?;
        return Ok(());
    }

    match fs::remove_file(&paths.current_auth) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove {}: {error}",
            paths.current_auth.display()
        )),
    }
}

fn validate_official_auth_for_local_proxy(auth: &Value) -> Result<(), String> {
    validate_auth(auth).map_err(|error| {
        format!(
            "Official Codex local proxy requires a ChatGPT auth.json with tokens.access_token. Switch to a valid signed-in official Codex account before starting proxy: {error}"
        )
    })?;
    Ok(())
}

fn validate_provider_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Provider id is invalid".to_string());
    }
    Ok(())
}

fn unique_provider_id(paths: &Paths) -> String {
    loop {
        let id = Uuid::new_v4().to_string();
        if !provider_path(paths, &id).exists() {
            return id;
        }
    }
}

fn backup_codex_config_if_needed(paths: &Paths, entering_provider: bool) -> Result<(), String> {
    if !entering_provider || paths.config_backup.exists() {
        return Ok(());
    }
    let backup = if paths.current_config.exists() {
        fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?
    } else {
        String::new()
    };
    write_text_atomic(&paths.config_backup, &backup)
}

pub(crate) fn write_official_local_proxy_config(paths: &Paths) -> Result<(), String> {
    let model = preferred_official_model(paths);
    write_local_proxy_config(paths, LOCAL_PROXY_PROVIDER_NAME, Some(&model), false)
}

fn write_provider_local_proxy_config(
    paths: &Paths,
    provider: &ProviderProfile,
) -> Result<(), String> {
    let uses_local_catalog = !uses_upstream_official_models(provider);
    if uses_local_catalog {
        write_provider_model_catalog(paths, provider)?;
    }
    write_local_proxy_config(
        paths,
        &provider.name,
        Some(codex_model_for_provider(provider)),
        uses_local_catalog,
    )
}

fn write_active_provider_config(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    ensure_local_proxy_running_for_provider()?;
    write_provider_local_proxy_config(paths, provider)
}

fn provider_switch_supported(proxy_running: bool) -> bool {
    proxy_running
}

fn ensure_local_proxy_running_for_provider() -> Result<(), String> {
    if crate::local_proxy::is_running() {
        Ok(())
    } else {
        Err("Third-party Providers require the local proxy. Start the local proxy before switching Provider."
            .to_string())
    }
}

pub(crate) fn provider_context_window(provider: &ProviderProfile) -> u64 {
    provider
        .context_window
        .unwrap_or(DEFAULT_MODEL_CONTEXT_WINDOW)
}

pub(crate) fn effective_provider_context_window(provider: &ProviderProfile) -> u64 {
    provider_context_window(provider).saturating_mul(95) / 100
}

pub(crate) fn effective_provider_context_window_for_model(
    provider: &ProviderProfile,
    model: &str,
) -> u64 {
    provider
        .model_context_windows
        .get(model)
        .copied()
        .unwrap_or_else(|| provider_context_window(provider))
        .saturating_mul(95)
        / 100
}

struct ModelCatalogOptions<'a> {
    image_input_models: &'a [String],
    reasoning_efforts: &'a ModelReasoningEfforts,
    context_windows: &'a ModelContextWindows,
    default_context_window: u64,
    reasoning_profile: ReasoningEffortProfile,
}

fn model_catalog_for_models(models: &[String], options: ModelCatalogOptions<'_>) -> Value {
    let entries = models
        .iter()
        .enumerate()
        .map(|(index, model)| {
            let model_reasoning_profile =
                reasoning_effort_profile_for_model(model, options.reasoning_profile);
            let reasoning_levels = supported_reasoning_levels_for_model(
                model,
                model_reasoning_profile,
                options.reasoning_efforts,
            );
            let model_context_window = options
                .context_windows
                .get(model)
                .copied()
                .unwrap_or(options.default_context_window);
            provider_model_catalog_entry(
                model,
                index,
                model_context_window,
                reasoning_levels,
                options.image_input_models.contains(model),
            )
        })
        .collect::<Vec<_>>();
    json!({ "models": entries })
}

pub(crate) fn supported_reasoning_levels(profile: ReasoningEffortProfile) -> Value {
    let levels = match profile {
        ReasoningEffortProfile::Standard => vec![
            json!({ "effort": "none", "description": "Disable Thinking" }),
            json!({ "effort": "high", "description": "Enabled Thinking" }),
        ],
        ReasoningEffortProfile::OpenAi => openai_reasoning_levels(false, false),
        ReasoningEffortProfile::OpenAiMax => openai_reasoning_levels(true, false),
        ReasoningEffortProfile::OpenAiUltra => openai_reasoning_levels(true, true),
        ReasoningEffortProfile::DeepSeek => vec![
            json!({ "effort": "none", "description": "Disable Thinking" }),
            json!({ "effort": "low", "description": "Low Thinking" }),
            json!({ "effort": "medium", "description": "Standard Thinking" }),
            json!({ "effort": "high", "description": "High Thinking" }),
            json!({ "effort": "xhigh", "description": "Extended Thinking" }),
            json!({ "effort": "max", "description": "Maximum Thinking" }),
        ],
    };
    Value::Array(levels)
}

pub(crate) fn supported_reasoning_levels_for_model(
    model: &str,
    fallback: ReasoningEffortProfile,
    configured: &ModelReasoningEfforts,
) -> Value {
    configured.get(model).map_or_else(
        || supported_reasoning_levels(fallback),
        |efforts| Value::Array(efforts.iter().map(reasoning_level).collect()),
    )
}

fn reasoning_level(effort: &ReasoningEffort) -> Value {
    let (effort, description) = match effort {
        ReasoningEffort::None => ("none", "Disable thinking"),
        ReasoningEffort::Low => ("low", "Fast responses with lighter reasoning"),
        ReasoningEffort::Medium => (
            "medium",
            "Balances speed and reasoning depth for everyday tasks",
        ),
        ReasoningEffort::High => ("high", "Greater reasoning depth for complex problems"),
        ReasoningEffort::Xhigh => ("xhigh", "Extra high reasoning depth for complex problems"),
        ReasoningEffort::Max => ("max", "Maximum reasoning depth for the hardest problems"),
        ReasoningEffort::Ultra => ("ultra", "Maximum reasoning with automatic task delegation"),
    };
    json!({ "effort": effort, "description": description })
}

fn openai_reasoning_levels(include_max: bool, include_ultra: bool) -> Vec<Value> {
    let mut levels = vec![
        json!({ "effort": "low", "description": "Fast responses with lighter reasoning" }),
        json!({
            "effort": "medium",
            "description": "Balances speed and reasoning depth for everyday tasks"
        }),
        json!({ "effort": "high", "description": "Greater reasoning depth for complex problems" }),
        json!({
            "effort": "xhigh",
            "description": "Extra high reasoning depth for complex problems"
        }),
    ];
    if include_max {
        levels.push(json!({
            "effort": "max",
            "description": "Maximum reasoning depth for the hardest problems"
        }));
    }
    if include_ultra {
        levels.push(json!({
            "effort": "ultra",
            "description": "Maximum reasoning with automatic task delegation"
        }));
    }
    levels
}

fn provider_model_catalog_entry(
    model: &str,
    index: usize,
    context_window: u64,
    reasoning_levels: Value,
    supports_image_input: bool,
) -> Value {
    let input_modalities = if supports_image_input {
        json!(["text", "image"])
    } else {
        json!(["text"])
    };
    json!({
        "slug": model,
        "display_name": model,
        "description": model,
        "base_instructions": "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals.",
        "default_reasoning_level": "high",
        "supported_reasoning_levels": reasoning_levels,
        "shell_type": "shell_command",
        "visibility": "list",
        "supported_in_api": true,
        "priority": 1000 + index,
        "supports_reasoning_summaries": true,
        "default_reasoning_summary": "none",
        "support_verbosity": false,
        "default_verbosity": null,
        "apply_patch_tool_type": null,
        "web_search_tool_type": "text",
        "truncation_policy": { "mode": "bytes", "limit": 10000 },
        "supports_parallel_tool_calls": false,
        "supports_image_detail_original": false,
        "context_window": context_window,
        "max_context_window": context_window,
        "auto_compact_token_limit": null,
        "comp_hash": null,
        "effective_context_window_percent": 95,
        "experimental_supported_tools": [],
        "input_modalities": input_modalities,
        "supports_search_tool": false,
        "use_responses_lite": false,
        "auto_review_model_override": null,
        "tool_mode": null,
        "multi_agent_version": null,
        "additional_speed_tiers": [],
        "service_tiers": [],
        "default_service_tier": null,
        "availability_nux": null,
        "upgrade": null
    })
}

fn write_provider_model_catalog(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    let catalog = model_catalog_for_provider(provider);
    write_json_if_changed(&paths.codex_home.join(MODEL_CATALOG_FILENAME), &catalog).map(|_| ())
}

pub(crate) fn model_catalog_for_provider(provider: &ProviderProfile) -> Value {
    let models = codex_visible_models(provider);
    let image_input_models = codex_image_input_models(provider);
    let reasoning_efforts = codex_model_reasoning_efforts(provider);
    let context_windows = codex_model_context_windows(provider);
    model_catalog_for_models(
        &models,
        ModelCatalogOptions {
            image_input_models: &image_input_models,
            reasoning_efforts: &reasoning_efforts,
            context_windows: &context_windows,
            default_context_window: provider_context_window(provider),
            reasoning_profile: reasoning_effort_profile(provider),
        },
    )
}

fn write_local_proxy_config(
    paths: &Paths,
    name: &str,
    model: Option<&str>,
    include_model_catalog: bool,
) -> Result<(), String> {
    let existing = if paths.current_config.exists() {
        fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?
    } else {
        String::new()
    };
    let requires_openai_auth = read_state(paths)
        .local_proxy_openai_auth_account_id
        .is_some();
    let token_command = std::env::current_exe()
        .map_err(|error| format!("Failed to locate Codex Switch for local proxy auth: {error}"))?
        .display()
        .to_string();
    let options = LocalProxyConfigOptions {
        name,
        model,
        include_model_catalog,
        requires_openai_auth,
        token_command: &token_command,
    };
    let merged = merge_local_proxy_config(&existing, &options);
    write_text_if_changed(&paths.current_config, &merged).map(|_| ())
}

#[cfg(test)]
fn merge_provider_config(existing: &str, provider: &ProviderProfile) -> String {
    let cleaned = remove_provider_conflicts(&remove_marked_blocks(existing));
    let mut config = String::new();
    config.push_str(PROVIDER_ROOT_START);
    config.push('\n');
    config.push_str("model_provider = \"custom\"\n");
    config.push_str(&format!("model = {}\n", toml_string(&provider.model)));
    config.push_str("disable_response_storage = true\n");
    config.push_str(PROVIDER_ROOT_END);
    config.push_str("\n\n");

    let cleaned = cleaned.trim();
    if !cleaned.is_empty() {
        config.push_str(cleaned);
        config.push_str("\n\n");
    }

    config.push_str(PROVIDER_TABLE_START);
    config.push('\n');
    config.push_str("[model_providers.custom]\n");
    config.push_str(&format!("name = {}\n", toml_string(&provider.name)));
    config.push_str(&format!("base_url = {}\n", toml_string(&provider.base_url)));
    config.push_str("wire_api = \"responses\"\n");
    if !provider.api_key.trim().is_empty() {
        config.push_str(&format!(
            "experimental_bearer_token = {}\n",
            toml_string(&provider.api_key)
        ));
    }
    config.push_str(PROVIDER_TABLE_END);
    config.push('\n');
    config
}

struct LocalProxyConfigOptions<'a> {
    name: &'a str,
    model: Option<&'a str>,
    include_model_catalog: bool,
    requires_openai_auth: bool,
    token_command: &'a str,
}

fn merge_local_proxy_config(existing: &str, options: &LocalProxyConfigOptions<'_>) -> String {
    let cleaned = remove_provider_conflicts(&remove_marked_blocks(existing));
    let model = options
        .model
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut config = String::new();
    config.push_str(PROVIDER_ROOT_START);
    config.push('\n');
    config.push_str(&format!(
        "model_provider = {}\n",
        toml_string(LOCAL_PROXY_PROVIDER_ID)
    ));
    if let Some(model) = model {
        config.push_str(&format!("model = {}\n", toml_string(model)));
    }
    if options.include_model_catalog {
        config.push_str(&format!(
            "model_catalog_json = {}\n",
            toml_string(MODEL_CATALOG_FILENAME)
        ));
    }
    config.push_str("disable_response_storage = true\n");
    config.push_str(PROVIDER_ROOT_END);
    config.push_str("\n\n");

    let cleaned = cleaned.trim();
    if !cleaned.is_empty() {
        config.push_str(cleaned);
        config.push_str("\n\n");
    }

    config.push_str(PROVIDER_TABLE_START);
    config.push('\n');
    config.push_str(&format!("[model_providers.{LOCAL_PROXY_PROVIDER_ID}]\n"));
    config.push_str(&format!("name = {}\n", toml_string(options.name)));
    config.push_str(&format!(
        "base_url = {}\n",
        toml_string(LOCAL_PROXY_BASE_URL)
    ));
    config.push_str("wire_api = \"responses\"\n");
    config.push_str(&format!(
        "requires_openai_auth = {}\n",
        options.requires_openai_auth
    ));
    if options.requires_openai_auth {
        config.push_str(&format!(
            "experimental_bearer_token = {}\n",
            toml_string(LOCAL_PROXY_TOKEN)
        ));
    } else {
        config.push_str(&format!(
            "auth = {{ command = {}, args = [\"--print-local-proxy-token\"], timeout_ms = 5000, refresh_interval_ms = 300000 }}\n",
            toml_string(options.token_command)
        ));
    }
    config.push_str(&format!(
        "http_headers = {{ {} = {} }}\n",
        toml_string(LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER),
        toml_string(LOCAL_PROXY_TOKEN)
    ));
    config.push_str(PROVIDER_TABLE_END);
    config.push('\n');
    config
}

fn remove_marked_blocks(config: &str) -> String {
    let mut output = Vec::new();
    let mut skipping = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed == PROVIDER_ROOT_START || trimmed == PROVIDER_TABLE_START {
            skipping = true;
            continue;
        }
        if skipping && (trimmed == PROVIDER_ROOT_END || trimmed == PROVIDER_TABLE_END) {
            skipping = false;
            continue;
        }
        if !skipping {
            output.push(line);
        }
    }
    output.join("\n")
}

fn remove_provider_conflicts(config: &str) -> String {
    let mut output = Vec::new();
    let mut in_root = true;
    let mut removing_custom_provider = false;
    let local_proxy_provider_header = format!("[model_providers.{LOCAL_PROXY_PROVIDER_ID}]");

    for line in config.lines() {
        let trimmed = line.trim();
        if removing_custom_provider {
            if is_table_header(trimmed) {
                removing_custom_provider = false;
            } else {
                continue;
            }
        }

        if is_table_header(trimmed) {
            in_root = false;
            if trimmed == "[model_providers.custom]"
                || trimmed == local_proxy_provider_header.as_str()
            {
                removing_custom_provider = true;
                continue;
            }
            output.push(line);
            continue;
        }

        if in_root && is_provider_root_key(trimmed) {
            continue;
        }
        output.push(line);
    }

    output.join("\n")
}

fn config_contains_local_proxy(config: &str) -> bool {
    config.contains(LOCAL_PROXY_BASE_URL)
        || config.contains(LOCAL_PROXY_TOKEN)
        || config.contains(&format!("[model_providers.{LOCAL_PROXY_PROVIDER_ID}]"))
}

pub(crate) fn preferred_official_model(paths: &Paths) -> String {
    let current = fs::read_to_string(&paths.current_config).ok();
    let backup = fs::read_to_string(&paths.config_backup).ok();
    preferred_official_model_from_configs(current.as_deref(), backup.as_deref())
}

fn preferred_official_model_from_configs(current: Option<&str>, backup: Option<&str>) -> String {
    backup
        .and_then(|config| extract_root_model(&remove_marked_blocks(config)))
        .or_else(|| {
            current.and_then(|config| {
                let cleaned = remove_marked_blocks(config);
                extract_root_model(&cleaned)
            })
        })
        .unwrap_or_else(|| DEFAULT_OFFICIAL_MODEL.to_string())
}

fn extract_root_model(config: &str) -> Option<String> {
    let mut in_root = true;
    for line in config.lines() {
        let trimmed = line.trim();
        if is_table_header(trimmed) {
            in_root = false;
            continue;
        }
        if !in_root || !trimmed.starts_with("model") {
            continue;
        }
        let Some(rest) = trimmed.strip_prefix("model") else {
            continue;
        };
        let rest = rest.trim_start();
        if !rest.starts_with('=') {
            continue;
        }
        let value = rest[1..].trim();
        return parse_toml_string_literal(value);
    }
    None
}

fn parse_toml_string_literal(value: &str) -> Option<String> {
    let quote = value.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let mut escaped = false;
    let mut output = String::new();
    for ch in value[quote.len_utf8()..].chars() {
        if quote == '"' && escaped {
            let decoded = match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            };
            output.push(decoded);
            escaped = false;
            continue;
        }
        if quote == '"' && ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == quote {
            return Some(output);
        }
        output.push(ch);
    }
    None
}

fn is_table_header(value: &str) -> bool {
    value.starts_with('[') && value.ends_with(']')
}

fn is_provider_root_key(value: &str) -> bool {
    [
        "model_provider",
        "model",
        "disable_response_storage",
        "model_catalog_json",
    ]
    .iter()
    .any(|key| value.starts_with(key) && value[key.len()..].trim_start().starts_with('='))
}

fn toml_string(value: &str) -> String {
    let mut output = String::from("\"");
    for ch in value.chars() {
        match ch {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            ch if ch.is_control() => {
                let code = ch as u32;
                if code <= 0xFFFF {
                    output.push_str(&format!("\\u{code:04X}"));
                } else {
                    output.push_str(&format!("\\U{code:08X}"));
                }
            }
            ch => output.push(ch),
        }
    }
    output.push('"');
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::json;
    use tiny_http::{Header, Response, Server};

    fn provider() -> ProviderProfile {
        ProviderProfile {
            id: "p".to_string(),
            kind: ProviderKind::Custom,
            name: "Gateway".to_string(),
            base_url: "https://gateway.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4.1".to_string(),
            models: vec!["gpt-4.1".to_string()],
            model_reasoning_efforts: ModelReasoningEfforts::new(),
            model_context_windows: ModelContextWindows::new(),
            image_input_models: Vec::new(),
            context_window: None,
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiResponses,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        }
    }

    #[test]
    fn parses_new_api_remaining_quota_as_usd() {
        let balance = parse_provider_api_balance(
            ProviderBalancePlatform::NewApi,
            &json!({
                "data": {
                    "total_available": 54_040_000,
                    "unlimited_quota": false
                }
            }),
        )
        .unwrap();
        assert_eq!(balance.amount, Some(108.08));
        assert_eq!(balance.unit, "USD");
        assert!(!balance.unlimited);
    }

    #[test]
    fn parses_sub2api_remaining_balance() {
        let balance = parse_provider_api_balance(
            ProviderBalancePlatform::Sub2Api,
            &json!({
                "mode": "quota_limited",
                "remaining": 12.5,
                "unit": "USD"
            }),
        )
        .unwrap();
        assert_eq!(balance.amount, Some(12.5));
        assert_eq!(balance.unit, "USD");
        assert!(!balance.unlimited);
    }

    #[test]
    fn parses_deepseek_multi_currency_balance() {
        let balance = parse_provider_api_balance(
            ProviderBalancePlatform::DeepSeek,
            &json!({
                "is_available": true,
                "balance_infos": [
                    { "currency": "CNY", "total_balance": "88.80" },
                    { "currency": "USD", "total_balance": "12.50" }
                ]
            }),
        )
        .unwrap();

        assert_eq!(balance.amount, Some(88.8));
        assert_eq!(balance.unit, "CNY");
        assert!(!balance.unlimited);
        assert_eq!(balance.balance_items.len(), 2);
        assert_eq!(balance.balance_items[1].unit, "USD");
        assert_eq!(balance.balance_items[1].amount, 12.5);
    }

    #[test]
    fn parses_and_deduplicates_deepseek_models() {
        let models = parse_deepseek_models(&json!({
            "object": "list",
            "data": [
                { "id": "deepseek-v4-flash", "object": "model" },
                { "id": "deepseek-v4-pro", "object": "model" },
                { "id": "deepseek-v4-flash", "object": "model" }
            ]
        }))
        .unwrap();

        assert_eq!(models, vec!["deepseek-v4-flash", "deepseek-v4-pro"]);
    }

    #[test]
    fn deepseek_endpoints_strip_optional_v1_prefix() {
        assert_eq!(
            deepseek_endpoint_url("https://api.deepseek.com/v1", "/models")
                .unwrap()
                .as_str(),
            "https://api.deepseek.com/models"
        );
        assert_eq!(
            deepseek_endpoint_url("https://api.deepseek.com", "/models")
                .unwrap()
                .as_str(),
            "https://api.deepseek.com/models"
        );
        assert!(deepseek_endpoint_url("https://example.com", "/models").is_err());
        assert!(deepseek_endpoint_url("https://api.deepseek.com:444", "/models").is_err());
        assert!(deepseek_endpoint_url("https://api.deepseek.com/custom", "/models").is_err());
    }

    #[test]
    fn parses_sub2api_unrestricted_key_as_api_unlimited_and_wallet_balance() {
        let balance = parse_provider_api_balance(
            ProviderBalancePlatform::Sub2Api,
            &json!({
                "mode": "unrestricted",
                "remaining": 21.75,
                "balance": 21.75,
                "unit": "USD"
            }),
        )
        .unwrap();
        assert_eq!(balance.amount, None);
        assert!(balance.unlimited);
        assert_eq!(balance.embedded_wallet_amount, Some(21.75));
        assert_eq!(balance.embedded_wallet_unit, "USD");
    }

    #[test]
    fn parses_new_api_wallet_quota_as_usd() {
        let (amount, unit) = parse_provider_wallet_balance(
            ProviderBalancePlatform::NewApi,
            &json!({ "data": { "quota": 6_250_000 } }),
        )
        .unwrap();
        assert_eq!(amount, 12.5);
        assert_eq!(unit, "USD");
    }

    #[test]
    fn parses_current_new_api_login_bundle() {
        let auth = parse_new_api_login_auth(&json!({
            "success": true,
            "data": {
                "access_token": "login-token",
                "user": { "id": 42 }
            }
        }))
        .unwrap();

        assert_eq!(auth.access_token.as_deref(), Some("login-token"));
        assert_eq!(auth.user_id, "42");
    }

    #[test]
    fn parses_legacy_new_api_login_user() {
        let auth = parse_new_api_login_auth(&json!({
            "success": true,
            "data": {
                "id": 7,
                "access_token": "legacy-token"
            }
        }))
        .unwrap();

        assert_eq!(auth.access_token.as_deref(), Some("legacy-token"));
        assert_eq!(auth.user_id, "7");
    }

    #[test]
    fn new_api_wallet_login_falls_back_to_session_cookie() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let wallet_url = format!("http://{}/api/user/self", server.server_addr());
        let worker = std::thread::spawn(move || {
            let login = server.recv().unwrap();
            assert_eq!(login.url(), "/api/user/login");
            login
                .respond(
                    Response::from_string(r#"{"success":true,"data":{"id":42}}"#)
                        .with_header(
                            Header::from_bytes(
                                "Set-Cookie",
                                "session=test-session; Path=/; HttpOnly",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            Header::from_bytes("Content-Type", "application/json").unwrap(),
                        ),
                )
                .unwrap();

            let wallet = server.recv().unwrap();
            assert_eq!(wallet.url(), "/api/user/self");
            assert!(wallet
                .headers()
                .iter()
                .any(|header| header.field.equiv("Cookie")
                    && header.value.as_str().contains("session=test-session")));
            wallet
                .respond(
                    Response::from_string(r#"{"success":true,"data":{"quota":6250000}}"#)
                        .with_header(
                            Header::from_bytes("Content-Type", "application/json").unwrap(),
                        ),
                )
                .unwrap();
        });
        let client = Client::builder().cookie_store(true).build().unwrap();

        let (amount, unit) =
            query_new_api_wallet_with_login(&client, &wallet_url, "user", "password", None)
                .unwrap();

        assert_eq!(amount, 12.5);
        assert_eq!(unit, "USD");
        worker.join().unwrap();
    }

    #[test]
    fn new_api_wallet_login_supplies_user_id_to_saved_token() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let wallet_url = format!("http://{}/api/user/self", server.server_addr());
        let worker = std::thread::spawn(move || {
            let login = server.recv().unwrap();
            assert_eq!(login.url(), "/api/user/login");
            login
                .respond(
                    Response::from_string(r#"{"success":true,"data":{"id":42}}"#).with_header(
                        Header::from_bytes("Content-Type", "application/json").unwrap(),
                    ),
                )
                .unwrap();

            let wallet = server.recv().unwrap();
            assert_eq!(wallet.url(), "/api/user/self");
            assert!(wallet.headers().iter().any(|header| {
                header.field.equiv("Authorization")
                    && header.value.as_str() == "Bearer saved-wallet-token"
            }));
            assert!(wallet.headers().iter().any(|header| {
                header.field.equiv("New-Api-User") && header.value.as_str() == "42"
            }));
            wallet
                .respond(
                    Response::from_string(r#"{"success":true,"data":{"quota":6250000}}"#)
                        .with_header(
                            Header::from_bytes("Content-Type", "application/json").unwrap(),
                        ),
                )
                .unwrap();
        });
        let client = Client::builder().cookie_store(true).build().unwrap();

        let (amount, unit) = query_new_api_wallet_with_login(
            &client,
            &wallet_url,
            "user",
            "password",
            Some("saved-wallet-token"),
        )
        .unwrap();

        assert_eq!(amount, 12.5);
        assert_eq!(unit, "USD");
        worker.join().unwrap();
    }

    #[test]
    fn parses_sub2api_wallet_balance() {
        let (amount, unit) = parse_provider_wallet_balance(
            ProviderBalancePlatform::Sub2Api,
            &json!({ "code": 0, "data": { "balance": 8.25 } }),
        )
        .unwrap();
        assert_eq!(amount, 8.25);
        assert_eq!(unit, "USD");
    }

    fn test_auth() -> Value {
        let claims = json!({
            "email": "first@example.com",
            "sub": "first-user",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "first-account"
            }
        });
        let token = format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
        );
        json!({
            "auth_mode": "chatgpt",
            "tokens": {
                "id_token": token,
                "access_token": "header.payload.signature",
                "refresh_token": "refresh-token",
                "account_id": "first-account"
            }
        })
    }

    fn test_agent_identity_auth() -> Value {
        json!({
            "auth_mode": "agentIdentity",
            "agent_identity": {
                "agent_runtime_id": "agent-runtime",
                "agent_private_key": base64::engine::general_purpose::STANDARD.encode([8_u8; 48]),
                "account_id": "agent-workspace",
                "chatgpt_user_id": "agent-user",
                "email": "agent@example.com"
            }
        })
    }

    fn test_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-provider-test-{}",
            uuid::Uuid::new_v4()
        ));
        let codex_home = root.join("codex-home");
        let app_data = root.join("app-data");
        Paths {
            current_auth: codex_home.join("auth.json"),
            current_config: codex_home.join("config.toml"),
            codex_home,
            accounts: app_data.join("accounts"),
            providers: app_data.join("providers"),
            config_backup: app_data.join("config-before-provider.toml"),
            state_file: app_data.join("state.json"),
        }
    }

    #[test]
    fn providers_can_only_switch_while_proxy_is_running() {
        assert!(!provider_switch_supported(false));
        assert!(provider_switch_supported(true));
    }

    #[test]
    fn new_provider_ids_are_random_version_four_uuids() {
        let paths = test_paths();
        let first = unique_provider_id(&paths);
        let second = unique_provider_id(&paths);

        assert_eq!(Uuid::parse_str(&first).unwrap().get_version_num(), 4);
        assert_eq!(Uuid::parse_str(&second).unwrap().get_version_num(), 4);
        assert_ne!(first, second);
    }

    #[test]
    fn startup_restores_legacy_direct_provider_config() {
        let paths = test_paths();
        let official_config = "model = \"gpt-5.5\"\n";
        write_text_atomic(&paths.config_backup, official_config).unwrap();
        write_text_atomic(
            &paths.current_config,
            &merge_provider_config(official_config, &provider()),
        )
        .unwrap();
        write_state(
            &paths,
            &crate::models::ManagerStateFile {
                active_account_id: Some("official-account".to_string()),
                active_provider_id: Some("p".to_string()),
                ..crate::models::ManagerStateFile::default()
            },
        )
        .unwrap();

        cleanup_non_proxy_provider_state(&paths).unwrap();

        assert_eq!(
            fs::read_to_string(&paths.current_config).unwrap(),
            official_config
        );
        assert!(!paths.config_backup.exists());
        let state = read_state(&paths);
        assert_eq!(state.active_account_id.as_deref(), Some("official-account"));
        assert!(state.active_provider_id.is_none());
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn official_proxy_without_login_selection_removes_current_auth() {
        let paths = test_paths();
        let auth = test_auth();
        let (_, _, _, id) = crate::auth::account_fields(&auth).unwrap();
        write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();
        write_json_atomic(&paths.current_auth, &auth).unwrap();
        write_state(
            &paths,
            &crate::models::ManagerStateFile {
                active_account_id: Some(id),
                ..crate::models::ManagerStateFile::default()
            },
        )
        .unwrap();

        apply_local_proxy_config_for_paths(&paths).unwrap();

        assert!(!paths.current_auth.exists());
        assert!(fs::read_to_string(&paths.current_config)
            .unwrap()
            .contains("requires_openai_auth = false"));
        let root = paths.codex_home.parent().unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn official_proxy_can_start_without_any_account() {
        let paths = test_paths();

        ensure_local_proxy_compatible_for_state(&paths).unwrap();
        apply_local_proxy_config_for_paths(&paths).unwrap();

        assert!(!paths.current_auth.exists());
        assert!(fs::read_to_string(&paths.current_config)
            .unwrap()
            .contains("requires_openai_auth = false"));
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn restoring_official_config_removes_managed_provider_blocks_from_backup() {
        let paths = test_paths();
        let official_setting = "model_reasoning_effort = \"high\"\n";
        let stale_backup = merge_provider_config(official_setting, &provider());
        write_text_atomic(&paths.config_backup, &stale_backup).unwrap();
        write_text_atomic(&paths.current_config, &stale_backup).unwrap();

        restore_official_config(&paths).unwrap();

        let restored = fs::read_to_string(&paths.current_config).unwrap();
        assert!(restored.contains(official_setting.trim()));
        assert!(!restored.contains(PROVIDER_ROOT_START));
        assert!(!restored.contains("[model_providers.custom]"));
        assert!(!restored.contains("https://gateway.example.com/v1"));
        assert!(!paths.config_backup.exists());
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn official_proxy_keeps_agent_identity_out_of_current_auth() {
        let paths = test_paths();
        let auth = test_agent_identity_auth();
        let (_, _, _, id) = crate::auth::account_fields(&auth).unwrap();
        write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();
        write_state(
            &paths,
            &crate::models::ManagerStateFile {
                active_account_id: Some(id),
                ..crate::models::ManagerStateFile::default()
            },
        )
        .unwrap();

        ensure_local_proxy_compatible_for_state(&paths).unwrap();
        apply_local_proxy_config_for_paths(&paths).unwrap();
        assert!(!paths.current_auth.exists());
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn proxy_start_allows_an_agent_identity_when_a_provider_is_selected() {
        let paths = test_paths();
        let auth = test_agent_identity_auth();
        let (_, _, _, id) = crate::auth::account_fields(&auth).unwrap();
        write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();
        write_provider(&paths, &provider()).unwrap();
        write_state(
            &paths,
            &crate::models::ManagerStateFile {
                active_account_id: Some(id),
                active_provider_id: Some("p".to_string()),
                ..crate::models::ManagerStateFile::default()
            },
        )
        .unwrap();

        ensure_local_proxy_compatible_for_state(&paths).unwrap();
        apply_local_proxy_config_for_paths(&paths).unwrap();
        assert!(!paths.current_auth.exists());
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn selected_proxy_openai_login_writes_auth_and_enables_config_flag() {
        let paths = test_paths();
        let auth = test_auth();
        let (_, _, _, id) = crate::auth::account_fields(&auth).unwrap();
        write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();
        write_provider(&paths, &provider()).unwrap();
        write_state(
            &paths,
            &crate::models::ManagerStateFile {
                active_provider_id: Some("p".to_string()),
                local_proxy_openai_auth_account_id: Some(id),
                ..crate::models::ManagerStateFile::default()
            },
        )
        .unwrap();

        ensure_local_proxy_compatible_for_state(&paths).unwrap();
        apply_local_proxy_config_for_paths(&paths).unwrap();

        assert_eq!(read_json(&paths.current_auth).unwrap(), auth);
        assert!(fs::read_to_string(&paths.current_config)
            .unwrap()
            .contains("requires_openai_auth = true"));

        let mut state = read_state(&paths);
        state.local_proxy_openai_auth_account_id = None;
        write_state(&paths, &state).unwrap();
        apply_local_proxy_config_for_paths(&paths).unwrap();

        assert!(!paths.current_auth.exists());
        assert!(fs::read_to_string(&paths.current_config)
            .unwrap()
            .contains("requires_openai_auth = false"));
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn agent_identity_cannot_be_used_as_proxy_openai_login() {
        let paths = test_paths();
        let auth = test_agent_identity_auth();
        let (_, _, _, id) = crate::auth::account_fields(&auth).unwrap();
        write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();

        let error = validate_local_proxy_openai_auth_account(&paths, Some(&id)).unwrap_err();

        assert!(error.contains("OAuth token"));
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn local_proxy_config_points_codex_to_local_responses() {
        let options = LocalProxyConfigOptions {
            name: "Proxy",
            model: Some("deepseek-chat"),
            include_model_catalog: true,
            requires_openai_auth: false,
            token_command: r"C:\Program Files\Codex Switch\codex-switch.exe",
        };
        let merged = merge_local_proxy_config("model = \"old\"", &options);
        assert!(merged.contains("model_provider = \"codex-switch-local\""));
        assert!(merged.contains("model = \"deepseek-chat\""));
        assert!(merged.contains("model_catalog_json = \"codex-switch-model-catalog.json\""));
        assert!(merged.contains("base_url = \"http://127.0.0.1:15722/v1\""));
        assert!(merged.contains("requires_openai_auth = false"));
        assert!(merged.contains(
            "http_headers = { \"x-openai-actor-authorization\" = \"CODEX_SWITCH_LOCAL_PROXY\" }"
        ));
        assert!(merged.contains("--print-local-proxy-token"));
        assert!(merged.contains(
            "auth = { command = \"C:\\\\Program Files\\\\Codex Switch\\\\codex-switch.exe\""
        ));
        assert!(!merged.contains("model = \"old\""));
    }

    #[test]
    fn provider_config_replaces_conflicting_root_keys_and_custom_provider() {
        let existing = r#"
model = "old"
approval_policy = "on-request"

[model_providers.custom]
base_url = "https://old.example.com"

[profiles.default]
sandbox_mode = "workspace-write"
"#;

        let merged = merge_provider_config(existing, &provider());
        assert!(merged.contains("model_provider = \"custom\""));
        assert!(merged.contains("model = \"gpt-4.1\""));
        assert!(!merged.contains("model_catalog_json"));
        assert!(!merged.contains("requires_openai_auth"));
        assert!(merged.contains("approval_policy = \"on-request\""));
        assert!(merged.contains("[profiles.default]"));
        assert!(!merged.contains("https://old.example.com"));
    }

    #[test]
    fn provider_config_uses_dynamic_models_when_codex_controls_models() {
        let mut provider = provider();
        provider.model_selection_controlled_by_codex = true;

        let merged = merge_provider_config("", &provider);

        assert!(!merged.contains("model_catalog_json"));
    }

    #[test]
    fn switch_control_uses_fixed_model_name_for_codex() {
        let provider = provider();

        assert_eq!(
            codex_model_for_provider(&provider),
            CODEX_SWITCH_CONTROL_MODEL
        );
    }

    #[test]
    fn codex_control_keeps_selected_provider_model() {
        let mut provider = provider();
        provider.model_selection_controlled_by_codex = true;

        assert_eq!(codex_model_for_provider(&provider), "gpt-4.1");
    }

    #[test]
    fn provider_config_keeps_dynamic_models_for_a_custom_context_window() {
        let mut provider = provider();
        provider.context_window = Some(256_000);

        let merged = merge_provider_config("", &provider);

        assert!(!merged.contains("model_catalog_json"));
    }

    #[test]
    fn openai_provider_config_uses_upstream_model_catalog() {
        let mut provider = provider();
        provider.kind = ProviderKind::OpenAi;
        provider.model_selection_controlled_by_codex = true;

        let merged = merge_provider_config("", &provider);

        assert!(!merged.contains("model_catalog_json"));
    }

    #[test]
    fn openai_provider_config_omits_empty_api_key() {
        let mut provider = provider();
        provider.kind = ProviderKind::OpenAi;
        provider.api_key.clear();

        let merged = merge_provider_config("", &provider);

        assert!(!merged.contains("experimental_bearer_token"));
    }

    #[test]
    fn synced_openai_provider_allows_empty_api_key() {
        let mut provider = provider();
        provider.kind = ProviderKind::OpenAi;
        provider.api_key = "  ".to_string();

        let profile = normalize_synced_provider(provider).unwrap();

        assert!(profile.api_key.is_empty());
    }

    #[test]
    fn synced_custom_provider_still_requires_api_key() {
        let mut provider = provider();
        provider.api_key.clear();

        let error = normalize_synced_provider(provider).unwrap_err();

        assert_eq!(error, "Provider API key is empty");
    }

    #[test]
    fn normalize_openai_provider_enforces_official_behavior() {
        let mut provider = provider();
        provider.kind = ProviderKind::OpenAi;
        provider.model.clear();
        provider.models.clear();
        provider.model_selection_controlled_by_codex = false;
        provider.api_format = ProviderApiFormat::OpenaiChat;

        let profile = normalize_provider_profile(provider).unwrap();

        assert_eq!(profile.model, DEFAULT_OFFICIAL_MODEL);
        assert_eq!(profile.models, vec![DEFAULT_OFFICIAL_MODEL]);
        assert!(profile.model_selection_controlled_by_codex);
        assert_eq!(profile.api_format, ProviderApiFormat::OpenaiResponses);
    }

    #[test]
    fn normalize_provider_profile_keeps_legacy_model_as_model_list() {
        let profile = normalize_provider_profile(ProviderProfile {
            id: "p".to_string(),
            kind: ProviderKind::Custom,
            name: "Gateway".to_string(),
            base_url: "https://gateway.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4.1".to_string(),
            models: Vec::new(),
            model_reasoning_efforts: ModelReasoningEfforts::new(),
            model_context_windows: ModelContextWindows::new(),
            image_input_models: vec!["missing-model".to_string()],
            context_window: None,
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiResponses,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        })
        .unwrap();

        assert_eq!(profile.model, "gpt-4.1");
        assert_eq!(profile.models, vec!["gpt-4.1"]);
        assert!(profile.image_input_models.is_empty());
    }

    #[test]
    fn normalize_deepseek_preset_keeps_model_control_setting() {
        let mut profile = provider();
        profile.name = "DeepSeek".to_string();
        profile.base_url = "https://api.deepseek.com".to_string();
        profile.model = "deepseek-v4-pro".to_string();
        profile.models = vec!["deepseek-v4-pro".to_string()];
        profile.api_format = ProviderApiFormat::OpenaiResponses;
        profile.model_selection_controlled_by_codex = false;
        profile.balance_platform = Some(ProviderBalancePlatform::DeepSeek);
        profile.balance_query_url = Some("https://api.deepseek.com/user/balance".to_string());

        let profile = normalize_provider_profile(profile).unwrap();

        assert_eq!(profile.api_format, ProviderApiFormat::OpenaiChat);
        assert!(!profile.model_selection_controlled_by_codex);
    }

    #[test]
    fn normalize_deepseek_preset_rejects_non_official_upstream() {
        let mut profile = provider();
        profile.balance_platform = Some(ProviderBalancePlatform::DeepSeek);
        profile.balance_query_url = Some("https://api.deepseek.com/user/balance".to_string());

        assert!(normalize_provider_profile(profile).is_err());
    }

    #[test]
    fn normalize_model_selection_trims_and_deduplicates_models() {
        let (model, models) = normalize_model_selection(
            " deepseek-chat ",
            vec![
                "deepseek-chat".to_string(),
                " deepseek-reasoner ".to_string(),
                String::new(),
                "deepseek-chat".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(model, "deepseek-chat");
        assert_eq!(models, vec!["deepseek-chat", "deepseek-reasoner"]);
    }

    #[test]
    fn gpt_reasoning_profiles_match_official_model_families_case_insensitively() {
        assert_eq!(
            reasoning_effort_profile_for_model("GPT-5.4", ReasoningEffortProfile::Standard),
            ReasoningEffortProfile::OpenAi
        );
        assert_eq!(
            reasoning_effort_profile_for_model("gpt-5.6-luna", ReasoningEffortProfile::Standard),
            ReasoningEffortProfile::OpenAiMax
        );
        assert_eq!(
            reasoning_effort_profile_for_model("GPT-5.6-SOL", ReasoningEffortProfile::Standard),
            ReasoningEffortProfile::OpenAiUltra
        );
        assert_eq!(
            reasoning_effort_profile_for_model("claude-sonnet", ReasoningEffortProfile::Standard),
            ReasoningEffortProfile::Standard
        );
        assert_eq!(
            reasoning_effort_profile_for_model("gpt-5.6-sol", ReasoningEffortProfile::DeepSeek),
            ReasoningEffortProfile::DeepSeek
        );
    }

    #[test]
    fn provider_model_catalog_uses_model_specific_reasoning_levels() {
        let models = vec![
            "gpt-5.6-sol".to_string(),
            "GPT-5.6-LUNA".to_string(),
            "gpt-5.4".to_string(),
            "claude-sonnet".to_string(),
        ];
        let catalog = model_catalog_for_models(
            &models,
            ModelCatalogOptions {
                image_input_models: &[],
                reasoning_efforts: &ModelReasoningEfforts::new(),
                context_windows: &ModelContextWindows::new(),
                default_context_window: DEFAULT_MODEL_CONTEXT_WINDOW,
                reasoning_profile: ReasoningEffortProfile::Standard,
            },
        );
        let entries = catalog["models"].as_array().unwrap();
        let efforts = |index: usize| {
            entries[index]["supported_reasoning_levels"]
                .as_array()
                .unwrap()
                .iter()
                .map(|level| level["effort"].as_str().unwrap())
                .collect::<Vec<_>>()
        };

        assert_eq!(
            efforts(0),
            vec!["low", "medium", "high", "xhigh", "max", "ultra"]
        );
        assert_eq!(efforts(1), vec!["low", "medium", "high", "xhigh", "max"]);
        assert_eq!(efforts(2), vec!["low", "medium", "high", "xhigh"]);
        assert_eq!(efforts(3), vec!["none", "high"]);
    }

    #[test]
    fn configured_reasoning_levels_override_defaults_and_are_normalized() {
        let configured = [
            (
                " gpt-5.6-sol ".to_string(),
                vec![
                    ReasoningEffort::Low,
                    ReasoningEffort::High,
                    ReasoningEffort::High,
                ],
            ),
            ("missing".to_string(), vec![ReasoningEffort::Ultra]),
        ]
        .into();
        let normalized =
            normalize_model_reasoning_efforts(&["gpt-5.6-sol".to_string()], configured);
        let catalog = model_catalog_for_models(
            &["gpt-5.6-sol".to_string()],
            ModelCatalogOptions {
                image_input_models: &[],
                reasoning_efforts: &normalized,
                context_windows: &ModelContextWindows::new(),
                default_context_window: DEFAULT_MODEL_CONTEXT_WINDOW,
                reasoning_profile: ReasoningEffortProfile::Standard,
            },
        );
        let efforts = catalog["models"][0]["supported_reasoning_levels"]
            .as_array()
            .unwrap()
            .iter()
            .map(|level| level["effort"].as_str().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(efforts, vec!["low", "high"]);
        assert!(!normalized.contains_key("missing"));
    }

    #[test]
    fn switch_control_inherits_the_selected_gpt_model_reasoning_levels() {
        let mut provider = provider();
        provider.model = "GPT-5.6-SOL".to_string();
        provider
            .model_context_windows
            .insert(provider.model.clone(), 400_000);
        let model_context_windows = codex_model_context_windows(&provider);
        let catalog = model_catalog_for_models(
            &[CODEX_SWITCH_CONTROL_MODEL.to_string()],
            ModelCatalogOptions {
                image_input_models: &[],
                reasoning_efforts: &ModelReasoningEfforts::new(),
                context_windows: &model_context_windows,
                default_context_window: provider_context_window(&provider),
                reasoning_profile: reasoning_effort_profile(&provider),
            },
        );
        let efforts = catalog["models"][0]["supported_reasoning_levels"]
            .as_array()
            .unwrap()
            .iter()
            .map(|level| level["effort"].as_str().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(
            efforts,
            vec!["low", "medium", "high", "xhigh", "max", "ultra"]
        );
        assert_eq!(catalog["models"][0]["context_window"], 400_000);
    }

    #[test]
    fn provider_model_catalog_contains_codex_visible_models() {
        let mut provider = provider();
        provider.models = vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()];
        provider.image_input_models = vec!["deepseek-reasoner".to_string()];
        provider.context_window = Some(256_000);
        provider
            .model_context_windows
            .insert("deepseek-reasoner".to_string(), 400_000);
        provider.model_selection_controlled_by_codex = true;
        let catalog = model_catalog_for_models(
            &provider.models,
            ModelCatalogOptions {
                image_input_models: &provider.image_input_models,
                reasoning_efforts: &ModelReasoningEfforts::new(),
                context_windows: &provider.model_context_windows,
                default_context_window: provider_context_window(&provider),
                reasoning_profile: ReasoningEffortProfile::DeepSeek,
            },
        );
        let models = catalog["models"].as_array().unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["slug"], "deepseek-chat");
        assert_eq!(models[0]["display_name"], "deepseek-chat");
        assert!(models[0]["base_instructions"]
            .as_str()
            .unwrap()
            .contains("You are Codex"));
        assert!(models[0].get("default_verbosity").is_some());
        assert!(models[0].get("apply_patch_tool_type").is_some());
        assert_eq!(models[0]["use_responses_lite"], false);
        assert!(models[0].get("tool_mode").is_some());
        assert!(models[0].get("multi_agent_version").is_some());
        assert_eq!(models[0]["context_window"], 256_000);
        assert_eq!(models[0]["max_context_window"], 256_000);
        assert_eq!(models[1]["context_window"], 400_000);
        assert_eq!(models[1]["max_context_window"], 400_000);
        assert_eq!(models[0]["input_modalities"], json!(["text"]));
        assert_eq!(models[1]["input_modalities"], json!(["text", "image"]));
        assert_eq!(
            models[0]["supported_reasoning_levels"]
                .as_array()
                .unwrap()
                .iter()
                .map(|level| level["effort"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["none", "low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(models[1]["slug"], "deepseek-reasoner");
    }

    #[test]
    fn switch_control_uses_the_active_models_image_capability() {
        let mut provider = provider();
        provider.image_input_models = vec![provider.model.clone()];

        assert_eq!(
            codex_image_input_models(&provider),
            vec![CODEX_SWITCH_CONTROL_MODEL.to_string()]
        );

        provider.image_input_models.clear();
        assert!(codex_image_input_models(&provider).is_empty());
    }

    #[test]
    fn provider_context_window_defaults_and_rejects_zero() {
        let provider = provider();
        assert_eq!(
            provider_context_window(&provider),
            DEFAULT_MODEL_CONTEXT_WINDOW
        );

        let mut invalid = provider;
        invalid.context_window = Some(0);
        assert_eq!(
            normalize_provider_profile(invalid).unwrap_err(),
            "Context window must be greater than zero"
        );
    }

    #[test]
    fn toml_string_escapes_secret_characters() {
        assert_eq!(toml_string("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }

    #[test]
    fn provider_base_url_rejects_local_proxy_endpoint() {
        assert!(normalize_base_url("http://127.0.0.1:15722/v1")
            .unwrap_err()
            .contains("local proxy"));
        assert!(normalize_base_url("http://localhost:15722/v1")
            .unwrap_err()
            .contains("local proxy"));
        assert!(normalize_base_url("https://api.deepseek.com/v1").is_ok());
    }

    #[test]
    fn provider_usage_url_follows_the_configured_proxy_base_path() {
        assert_eq!(
            provider_usage_url("https://switch.example.com/v1")
                .unwrap()
                .as_str(),
            "https://switch.example.com/v1/usage"
        );
        assert_eq!(
            provider_usage_url("https://switch.example.com/codex/v1/?ignored=true")
                .unwrap()
                .as_str(),
            "https://switch.example.com/codex/v1/usage"
        );
    }

    #[test]
    fn official_local_proxy_uses_backed_up_official_model_after_provider() {
        let backup = r#"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
"#;
        let provider_options = LocalProxyConfigOptions {
            name: "DeepSeek",
            model: Some("deepseek-v4-flash"),
            include_model_catalog: true,
            requires_openai_auth: false,
            token_command: "codex-switch",
        };
        let provider_proxy = merge_local_proxy_config(backup, &provider_options);

        assert_eq!(
            preferred_official_model_from_configs(Some(&provider_proxy), Some(backup)),
            "gpt-5.5"
        );

        let official_model =
            preferred_official_model_from_configs(Some(&provider_proxy), Some(backup));
        let official_options = LocalProxyConfigOptions {
            name: LOCAL_PROXY_PROVIDER_NAME,
            model: Some(&official_model),
            include_model_catalog: false,
            requires_openai_auth: false,
            token_command: "codex-switch",
        };
        let official_proxy = merge_local_proxy_config(&provider_proxy, &official_options);
        let first_model = extract_root_model(&official_proxy).unwrap();

        assert_eq!(first_model, "gpt-5.5");
        assert!(!official_proxy.contains("deepseek-v4-flash"));
    }

    #[test]
    fn official_model_does_not_reuse_managed_provider_model_without_backup() {
        let provider_options = LocalProxyConfigOptions {
            name: "DeepSeek",
            model: Some("deepseek-v4-flash"),
            include_model_catalog: true,
            requires_openai_auth: false,
            token_command: "codex-switch",
        };
        let provider_proxy = merge_local_proxy_config(r#"model = "gpt-5.5""#, &provider_options);

        assert_eq!(
            preferred_official_model_from_configs(Some(&provider_proxy), None),
            DEFAULT_OFFICIAL_MODEL
        );
    }

    #[test]
    fn official_model_does_not_reuse_managed_provider_model_from_stale_backup() {
        let managed_provider = merge_provider_config("", &provider());

        assert_eq!(
            preferred_official_model_from_configs(None, Some(&managed_provider)),
            DEFAULT_OFFICIAL_MODEL
        );
    }

    #[test]
    fn official_model_uses_plain_current_config_without_backup() {
        assert_eq!(
            preferred_official_model_from_configs(Some(r#"model = "gpt-5.5""#), None),
            "gpt-5.5"
        );
    }
}
