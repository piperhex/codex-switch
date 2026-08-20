use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Runtime};
use uuid::Uuid;

use crate::{
    aggregate_scheduler,
    models::{ModelContextWindows, ModelReasoningEfforts, ProviderKind, ProviderProfile},
    providers,
    storage::{read_json, read_state, resolve_paths, write_json_atomic, Paths},
};

const AGGREGATE_API_FILE_NAME: &str = "aggregate-apis.json";
pub(crate) const ACTIVE_ID_PREFIX: &str = "aggregate:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AggregateApiConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) model: String,
    pub(crate) member_provider_ids: Vec<String>,
    pub(crate) enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AggregateApiInput {
    id: Option<String>,
    name: String,
    model: String,
    member_provider_ids: Vec<String>,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AggregateApiSummary {
    id: String,
    name: String,
    model: String,
    member_provider_ids: Vec<String>,
    enabled: bool,
    active: bool,
    member_conversation_counts: HashMap<String, usize>,
}

#[tauri::command]
pub(crate) async fn list_aggregate_apis<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<AggregateApiSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_summaries(&app))
        .await
        .map_err(|error| format!("Aggregate API list task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_aggregate_api<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    aggregate: AggregateApiInput,
) -> Result<AggregateApiSummary, String> {
    tauri::async_runtime::spawn_blocking(move || save_blocking(&app, aggregate))
        .await
        .map_err(|error| format!("Aggregate API save task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_aggregate_api<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_blocking(&app, &id))
        .await
        .map_err(|error| format!("Aggregate API delete task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn switch_aggregate_api<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || switch_blocking(&app, &id))
        .await
        .map_err(|error| format!("Aggregate API switch task failed: {error}"))?
}

pub(crate) fn is_active_id(id: &str) -> bool {
    id.starts_with(ACTIVE_ID_PREFIX)
}

pub(crate) fn config_id_from_active_id(id: &str) -> Option<&str> {
    id.strip_prefix(ACTIVE_ID_PREFIX)
}

pub(crate) fn active_id(id: &str) -> String {
    format!("{ACTIVE_ID_PREFIX}{id}")
}

pub(crate) fn read_active_config(
    paths: &Paths,
    active_provider_id: &str,
) -> Result<AggregateApiConfig, String> {
    let id = config_id_from_active_id(active_provider_id)
        .ok_or_else(|| "Aggregate API id is invalid".to_string())?;
    read_config(paths, id)
}

pub(crate) fn read_config(paths: &Paths, id: &str) -> Result<AggregateApiConfig, String> {
    validate_id(id)?;
    read_configs(paths)?
        .into_iter()
        .find(|aggregate| aggregate.id == id)
        .ok_or_else(|| "Aggregate API does not exist".to_string())
}

pub(crate) fn member_profiles(
    paths: &Paths,
    aggregate: &AggregateApiConfig,
) -> Result<Vec<ProviderProfile>, String> {
    let profiles = aggregate
        .member_provider_ids
        .iter()
        .map(|id| providers::read_provider(paths, id))
        .collect::<Result<Vec<_>, _>>()?;
    validate_members(&aggregate.model, &profiles)?;
    Ok(profiles)
}

pub(crate) fn logical_profile(
    aggregate: &AggregateApiConfig,
    profiles: &[ProviderProfile],
) -> Result<ProviderProfile, String> {
    let mut profile = profiles
        .first()
        .cloned()
        .ok_or_else(|| "Aggregate API does not contain any available APIs".to_string())?;
    profile.id = active_id(&aggregate.id);
    profile.kind = ProviderKind::Custom;
    profile.name.clone_from(&aggregate.name);
    profile.group.clear();
    profile.model.clone_from(&aggregate.model);
    profile.models = vec![aggregate.model.clone()];
    profile.model_reasoning_efforts = common_reasoning_efforts(&aggregate.model, profiles);
    profile.model_context_windows = common_context_window(&aggregate.model, profiles);
    profile.image_input_models = common_image_input_models(aggregate, profiles);
    profile.image_input_models_configured = true;
    profile.model_selection_controlled_by_codex = true;
    profile.balance_platform = None;
    Ok(profile)
}

pub(crate) fn force_aggregate_model(provider: &ProviderProfile, model: &str) -> ProviderProfile {
    let mut selected = provider.clone();
    selected.model = model.to_string();
    selected.models = vec![model.to_string()];
    selected.model_selection_controlled_by_codex = false;
    selected
}

pub(crate) fn remove_provider_membership(paths: &Paths, provider_id: &str) -> Result<(), String> {
    let mut configs = read_configs(paths)?;
    let mut changed = false;
    for aggregate in &mut configs {
        let previous_len = aggregate.member_provider_ids.len();
        aggregate
            .member_provider_ids
            .retain(|member_id| member_id != provider_id);
        if aggregate.member_provider_ids.len() != previous_len {
            changed = true;
            aggregate.enabled &= aggregate.member_provider_ids.len() >= 2;
            aggregate_scheduler::reset(&aggregate.id);
        }
    }
    if changed {
        write_configs(paths, &configs)?;
    }
    Ok(())
}

fn list_summaries<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<AggregateApiSummary>, String> {
    let paths = resolve_paths(app)?;
    let active_provider_id = read_state(&paths).active_provider_id;
    let mut summaries = read_configs(&paths)?
        .into_iter()
        .map(|aggregate| summary(aggregate, active_provider_id.as_deref()))
        .collect::<Result<Vec<_>, _>>()?;
    summaries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(summaries)
}

fn save_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    input: AggregateApiInput,
) -> Result<AggregateApiSummary, String> {
    let paths = resolve_paths(app)?;
    let mut configs = read_configs(&paths)?;
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_id(&id)?;
    let config = normalize_input(id.clone(), input, &paths)?;
    if let Some(existing) = configs.iter_mut().find(|aggregate| aggregate.id == id) {
        *existing = config.clone();
    } else {
        configs.push(config.clone());
    }
    write_configs(&paths, &configs)?;
    aggregate_scheduler::reset(&id);

    let expected_active_id = active_id(&id);
    let active = read_state(&paths).active_provider_id.as_deref() == Some(&expected_active_id);
    if active && config.enabled {
        activate_config(app, &paths, &config)?;
    } else if active {
        providers::disable_provider_blocking(app.clone())?;
    }
    emit_changed(app)?;
    summary(config, read_state(&paths).active_provider_id.as_deref())
}

fn delete_blocking<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<(), String> {
    validate_id(id)?;
    let paths = resolve_paths(app)?;
    let mut configs = read_configs(&paths)?;
    let previous_len = configs.len();
    configs.retain(|aggregate| aggregate.id != id);
    if configs.len() == previous_len {
        return Err("Aggregate API does not exist".to_string());
    }
    let expected_active_id = active_id(id);
    let was_active = read_state(&paths).active_provider_id.as_deref() == Some(&expected_active_id);
    write_configs(&paths, &configs)?;
    aggregate_scheduler::reset(id);
    if was_active {
        providers::disable_provider_blocking(app.clone())?;
    }
    emit_changed(app)
}

fn switch_blocking<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    let config = read_config(&paths, id)?;
    if !config.enabled {
        return Err("Enable the aggregate API before using it".to_string());
    }
    activate_config(app, &paths, &config)?;
    emit_changed(app)
}

fn activate_config<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    config: &AggregateApiConfig,
) -> Result<(), String> {
    let profiles = member_profiles(paths, config)?;
    for profile in &profiles {
        providers::validate_provider_activation(profile)?;
    }
    let profile = logical_profile(config, &profiles)?;
    providers::activate_logical_provider(app, paths, &profile)
}

fn normalize_input(
    id: String,
    input: AggregateApiInput,
    paths: &Paths,
) -> Result<AggregateApiConfig, String> {
    let name = require_value("Aggregate API name", &input.name)?;
    let model = require_value("Model", &input.model)?;
    let member_provider_ids = unique_members(input.member_provider_ids)?;
    let profiles = member_provider_ids
        .iter()
        .map(|provider_id| providers::read_provider(paths, provider_id))
        .collect::<Result<Vec<_>, _>>()?;
    validate_members(&model, &profiles)?;
    Ok(AggregateApiConfig {
        id,
        name,
        model,
        member_provider_ids,
        enabled: input.enabled,
    })
}

fn unique_members(member_provider_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let members = member_provider_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .collect::<Vec<_>>();
    if members.len() < 2 {
        return Err("Select at least two APIs for the aggregate".to_string());
    }
    Ok(members)
}

fn validate_members(model: &str, profiles: &[ProviderProfile]) -> Result<(), String> {
    if profiles.len() < 2 {
        return Err("Aggregate API does not contain enough available APIs".to_string());
    }
    if profiles
        .iter()
        .any(|provider| !provider_supports_model(provider, model))
    {
        return Err("Every API in an aggregate must support the selected model".to_string());
    }
    Ok(())
}

fn provider_supports_model(provider: &ProviderProfile, model: &str) -> bool {
    provider.model == model || provider.models.iter().any(|candidate| candidate == model)
}

fn common_reasoning_efforts(model: &str, profiles: &[ProviderProfile]) -> ModelReasoningEfforts {
    let Some(first) = profiles
        .first()
        .and_then(|provider| provider.model_reasoning_efforts.get(model))
        .cloned()
    else {
        return ModelReasoningEfforts::new();
    };
    let common = first
        .into_iter()
        .filter(|effort| {
            profiles.iter().all(|provider| {
                provider
                    .model_reasoning_efforts
                    .get(model)
                    .is_some_and(|efforts| efforts.contains(effort))
            })
        })
        .collect::<Vec<_>>();
    if common.is_empty() {
        ModelReasoningEfforts::new()
    } else {
        [(model.to_string(), common)].into()
    }
}

fn common_context_window(model: &str, profiles: &[ProviderProfile]) -> ModelContextWindows {
    profiles
        .iter()
        .filter_map(|provider| provider.model_context_windows.get(model).copied())
        .min()
        .map(|window| [(model.to_string(), window)].into())
        .unwrap_or_default()
}

fn common_image_input_models(
    aggregate: &AggregateApiConfig,
    profiles: &[ProviderProfile],
) -> Vec<String> {
    let supported_by_all = profiles.iter().all(|provider| {
        provider
            .image_input_models
            .iter()
            .any(|model| model == &aggregate.model)
    });
    if supported_by_all {
        vec![aggregate.model.clone()]
    } else {
        Vec::new()
    }
}

fn summary(
    config: AggregateApiConfig,
    active_provider_id: Option<&str>,
) -> Result<AggregateApiSummary, String> {
    let expected_active_id = active_id(&config.id);
    let member_conversation_counts =
        aggregate_scheduler::conversation_counts(&config.id, &config.member_provider_ids)?;
    Ok(AggregateApiSummary {
        active: active_provider_id == Some(&expected_active_id),
        id: config.id,
        name: config.name,
        model: config.model,
        member_provider_ids: config.member_provider_ids,
        enabled: config.enabled,
        member_conversation_counts,
    })
}

fn read_configs(paths: &Paths) -> Result<Vec<AggregateApiConfig>, String> {
    let path = store_path(paths)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_value(read_json(&path)?)
        .map_err(|error| format!("Aggregate API configuration is invalid: {error}"))
}

fn write_configs(paths: &Paths, configs: &[AggregateApiConfig]) -> Result<(), String> {
    let value = serde_json::to_value(configs).map_err(|error| error.to_string())?;
    write_json_atomic(&store_path(paths)?, &value)
}

fn store_path(paths: &Paths) -> Result<PathBuf, String> {
    paths
        .providers
        .parent()
        .map(|parent| parent.join(AGGREGATE_API_FILE_NAME))
        .ok_or_else(|| "Provider store does not have a parent directory".to_string())
}

fn require_value(label: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(value.to_string())
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    if valid {
        Ok(())
    } else {
        Err("Aggregate API id is invalid".to_string())
    }
}

fn emit_changed<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    app.emit("aggregate-apis-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())
}
