use std::{collections::HashSet, fs, io::Read, path::PathBuf, time::Duration};

use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Emitter, Runtime};
use url::Url;
use uuid::Uuid;

use crate::{
    auth::{is_agent_identity_auth, validate_auth},
    codex_config::{self, LocalProxyConfig},
    models::{
        ImageModelTarget, ManagerStateFile, ModelApiFormats, ModelContextWindows,
        ModelReasoningEfforts, ProviderApiFormat, ProviderBalance, ProviderBalanceItem,
        ProviderBalancePlatform, ProviderFieldModifiedAt, ProviderKind, ProviderProfile,
        ProviderSummary, ReasoningEffort, UsageSummary,
    },
    storage::{
        change_concurrent_account_routing, managed_auth_path, read_app_settings, read_json,
        read_state, resolve_paths, try_read_state, write_app_settings, write_json_atomic,
        write_json_if_changed, write_state, write_text_atomic, write_text_if_changed, Paths,
    },
};

pub(crate) use codex_config::{
    LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER, LOCAL_PROXY_BASE_URL, LOCAL_PROXY_HOST,
    LOCAL_PROXY_PORT, LOCAL_PROXY_TOKEN,
};
pub(crate) const CODEX_SWITCH_CONTROL_MODEL: &str = "codex switch control";
const LOCAL_PROXY_PROVIDER_NAME: &str = "Codex Switch Local Proxy";
pub(crate) const DEFAULT_OFFICIAL_MODEL: &str = "gpt-5.6-sol";
const MODEL_CATALOG_FILENAME: &str = "codex-switch-model-catalog.json";
pub(crate) const DEFAULT_MODEL_CONTEXT_WINDOW: u64 = 256_000;
pub(crate) const DEFAULT_DEEPSEEK_MODEL_CONTEXT_WINDOW: u64 = 1_000_000;
const NEW_API_QUOTA_PER_USD: f64 = 500_000.0;
const MAX_BALANCE_RESPONSE_BYTES: u64 = 1024 * 1024;
const MAX_MODEL_RESPONSE_BYTES: u64 = 1024 * 1024;
const MAX_PROVIDER_GROUP_COUNT: usize = 100;

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

fn refresh_codex_models_best_effort(paths: &Paths, provider: &ProviderProfile) {
    if !crate::local_proxy::is_running() {
        return;
    }
    crate::codex_runtime::refresh_models(provider_model_refresh_request(paths, provider));
}

fn refresh_codex_models_now_best_effort(paths: &Paths, provider: &ProviderProfile) {
    if !crate::local_proxy::is_running() {
        return;
    }
    crate::codex_runtime::refresh_models_blocking(provider_model_refresh_request(paths, provider));
}

fn refresh_codex_group_models_best_effort(paths: &Paths, providers: &[ProviderProfile]) {
    if !crate::local_proxy::is_running() {
        return;
    }
    let Some(request) = provider_group_model_refresh_request(paths, providers) else {
        return;
    };
    crate::codex_runtime::refresh_models(request);
}

fn refresh_codex_group_models_now_best_effort(paths: &Paths, providers: &[ProviderProfile]) {
    if !crate::local_proxy::is_running() {
        return;
    }
    let Some(request) = provider_group_model_refresh_request(paths, providers) else {
        return;
    };
    crate::codex_runtime::refresh_models_blocking(request);
}

fn provider_model_refresh_request(
    paths: &Paths,
    provider: &ProviderProfile,
) -> crate::codex_runtime::ModelRefreshRequest {
    let models = codex_visible_models(provider);
    let image_input_models = routed_image_input_models(
        &models,
        &codex_image_input_models(provider),
        image_input_route_enabled(paths),
    );
    crate::codex_runtime::ModelRefreshRequest {
        fast_mode_models: if provider.fast_mode_enabled {
            models.clone()
        } else {
            Vec::new()
        },
        models,
        image_input_models,
        model_reasoning_efforts: codex_model_reasoning_efforts(provider),
        selected_model: codex_model_for_provider(provider).to_string(),
        reasoning_profile: reasoning_effort_profile(provider),
    }
}

fn provider_group_model_refresh_request(
    paths: &Paths,
    providers: &[ProviderProfile],
) -> Option<crate::codex_runtime::ModelRefreshRequest> {
    let mut catalog = provider_group_catalog_data(providers);
    catalog.image_input_models = routed_image_input_models(
        &catalog.models,
        &catalog.image_input_models,
        image_input_route_enabled(paths),
    );
    let selected_model = catalog.models.first().cloned()?;
    Some(crate::codex_runtime::ModelRefreshRequest {
        fast_mode_models: if catalog.fast_mode_enabled {
            catalog.models.clone()
        } else {
            Vec::new()
        },
        models: catalog.models,
        image_input_models: catalog.image_input_models,
        model_reasoning_efforts: catalog.reasoning_efforts,
        selected_model,
        reasoning_profile: ReasoningEffortProfile::Standard,
    })
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

fn image_input_route_enabled(paths: &Paths) -> bool {
    read_state(paths).image_input_target.is_some()
}

fn routed_image_input_models(
    models: &[String],
    configured_models: &[String],
    route_enabled: bool,
) -> Vec<String> {
    if route_enabled {
        models.to_vec()
    } else {
        configured_models.to_vec()
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
    let context_window = provider
        .model_context_windows
        .get(&provider.model)
        .copied()
        .unwrap_or_else(|| {
            default_context_window_for_model(&provider.model, provider_context_window(provider))
        });
    [(CODEX_SWITCH_CONTROL_MODEL.to_string(), context_window)].into()
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
        provider
            .models
            .first()
            .map(String::as_str)
            .unwrap_or(&provider.model)
    } else {
        CODEX_SWITCH_CONTROL_MODEL
    }
}

pub(crate) fn refresh_codex_models_for_current_target(paths: &Paths) {
    if !crate::local_proxy::is_running() {
        return;
    }
    let state = read_state(paths);
    if let Some(group) = state.active_provider_group.as_deref() {
        if let Ok(providers) = provider_group_profiles(paths, group) {
            refresh_codex_group_models_best_effort(paths, &providers);
        }
        return;
    }
    let Some(id) = state.active_provider_id.as_deref() else {
        refresh_official_codex_models();
        return;
    };
    if crate::aggregate_api::is_active_id(id) {
        if let Ok(config) = crate::aggregate_api::read_active_config(paths, id) {
            if let Ok(profiles) = crate::aggregate_api::member_profiles(paths, &config) {
                if let Ok(profile) = crate::aggregate_api::logical_profile(&config, &profiles) {
                    refresh_codex_models_best_effort(paths, &profile);
                }
            }
        }
        return;
    }
    if let Ok(provider) = read_provider(paths, id) {
        refresh_codex_models_best_effort(paths, &provider);
    }
}

pub(crate) fn refresh_codex_models_for_current_target_blocking(paths: &Paths) {
    if !crate::local_proxy::is_running() {
        return;
    }
    let state = read_state(paths);
    if let Some(group) = state.active_provider_group.as_deref() {
        if let Ok(providers) = provider_group_profiles(paths, group) {
            refresh_codex_group_models_now_best_effort(paths, &providers);
        }
        return;
    }
    let Some(id) = state.active_provider_id.as_deref() else {
        crate::codex_runtime::refresh_official_models_blocking(official_model());
        return;
    };
    if let Ok(provider) = read_provider(paths, id) {
        refresh_codex_models_now_best_effort(paths, &provider);
    }
}

pub(crate) fn refresh_official_codex_models() {
    if !crate::local_proxy::is_running() {
        return;
    }
    crate::codex_runtime::refresh_official_models(official_model());
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderInput {
    pub(crate) id: Option<String>,
    #[serde(default)]
    pub(crate) kind: ProviderKind,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) group: String,
    pub(crate) base_url: String,
    pub(crate) api_key: Option<String>,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: Vec<String>,
    #[serde(default)]
    pub(crate) model_reasoning_efforts: ModelReasoningEfforts,
    #[serde(default)]
    pub(crate) model_context_windows: ModelContextWindows,
    #[serde(default)]
    pub(crate) model_api_formats: ModelApiFormats,
    #[serde(default)]
    pub(crate) image_input_models: Vec<String>,
    #[serde(default)]
    pub(crate) image_input_models_configured: Option<bool>,
    #[serde(default)]
    pub(crate) context_window: Option<u64>,
    #[serde(default)]
    pub(crate) model_selection_controlled_by_codex: bool,
    #[serde(default)]
    pub(crate) fast_mode_enabled: bool,
    pub(crate) api_format: ProviderApiFormat,
    #[serde(default)]
    pub(crate) balance_platform: Option<ProviderBalancePlatform>,
    #[serde(default)]
    pub(crate) balance_query_url: Option<String>,
    #[serde(default)]
    pub(crate) balance_query_token: Option<String>,
    #[serde(default)]
    pub(crate) balance_query_uses_api_key: bool,
    #[serde(default)]
    pub(crate) wallet_query_url: Option<String>,
    #[serde(default)]
    pub(crate) wallet_query_token: Option<String>,
    #[serde(default)]
    pub(crate) wallet_username: Option<String>,
    #[serde(default)]
    pub(crate) wallet_password: Option<String>,
}
