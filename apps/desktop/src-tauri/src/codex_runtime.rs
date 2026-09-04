#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::Duration,
};

#[cfg(any(target_os = "windows", target_os = "macos"))]
use reqwest::blocking::Client;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use serde::Deserialize;
use tauri::AppHandle;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use tauri::Emitter;

#[cfg(target_os = "windows")]
use std::path::Path;

#[cfg(any(target_os = "windows", target_os = "macos"))]
const OFFICIAL_MODEL_REFRESH_TIMEOUT: Duration = Duration::from_secs(20);

#[cfg(any(target_os = "windows", target_os = "macos"))]
const HIDDEN_MODEL_VISIBILITY: &str = "hide";

#[cfg(any(target_os = "windows", target_os = "macos"))]
static MODEL_REFRESH_GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg(any(target_os = "windows", target_os = "macos"))]
static MODEL_REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(any(target_os = "windows", target_os = "macos"))]
static CODEX_RUNTIME_APP: OnceLock<AppHandle> = OnceLock::new();

pub(crate) struct ModelRefreshRequest {
    pub(crate) models: Vec<String>,
    pub(crate) fast_mode_models: Vec<String>,
    pub(crate) image_input_models: Vec<String>,
    pub(crate) model_reasoning_efforts: crate::models::ModelReasoningEfforts,
    pub(crate) selected_model: String,
    pub(crate) reasoning_profile: crate::providers::ReasoningEffortProfile,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[derive(Deserialize)]
struct OfficialModelsResponse {
    #[serde(default)]
    models: Vec<OfficialModel>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[derive(Deserialize)]
struct OfficialModel {
    slug: String,
    #[serde(default)]
    visibility: Option<String>,
    #[serde(default)]
    input_modalities: Vec<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<OfficialReasoningLevel>,
    #[serde(default)]
    additional_speed_tiers: Vec<String>,
    #[serde(default)]
    service_tiers: Vec<OfficialServiceTier>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[derive(Deserialize)]
struct OfficialServiceTier {
    id: String,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[derive(Deserialize)]
struct OfficialReasoningLevel {
    effort: crate::models::ReasoningEffort,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[derive(Default)]
struct OfficialCatalogBuilder {
    seen_models: HashSet<String>,
    models: Vec<String>,
    image_input_models: Vec<String>,
    model_reasoning_efforts: crate::models::ModelReasoningEfforts,
    fast_mode_models: Vec<String>,
}

/// Initializes the managed Codex renderer channel independently from Dream Skin.
pub(crate) fn setup(app: &AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let _ = CODEX_RUNTIME_APP.set(app.clone());
        crate::dream_skin_native::setup_runtime(app)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn notify_service_tier_changed() {
    let Some(app) = CODEX_RUNTIME_APP.get() else {
        return;
    };
    if let Err(error) = app.emit("providers-changed", ()) {
        eprintln!("Failed to publish the Codex service tier change: {error}");
    }
}

/// Relaunches Codex with the local renderer channel. Theme injection remains
/// controlled exclusively by Dream Skin's installation and pause state.
pub(crate) fn restart_managed_session() -> Result<bool, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return match crate::dream_skin_native::restart_runtime_session() {
        Ok(()) => Ok(true),
        Err(error) if error == "Codex runtime is not initialized." => Ok(false),
        Err(error) => Err(error),
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Ok(false)
}

/// Updates the executable used by the next managed restart. ChatGPT updates can
/// leave the previously remembered Store path valid, so restart callers must
/// publish the path observed for the current process before stopping it.
#[cfg(target_os = "windows")]
pub(crate) fn record_launch_executable(path: &str) -> Result<(), String> {
    crate::dream_skin_native::record_runtime_executable(Path::new(path))
}

/// Refreshes Codex's model and config caches through the managed renderer channel.
pub(crate) fn refresh_models(request: ModelRefreshRequest) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        schedule_model_refresh(request);
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = request;
    }
}

/// Refreshes Codex's model and config caches before returning to the caller.
pub(crate) fn refresh_models_blocking(request: ModelRefreshRequest) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let generation = next_model_refresh_generation();
        apply_model_refresh(generation, request);
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = request;
    }
}

/// Loads the current official catalog through the local proxy before refreshing
/// Codex. This avoids restoring a stale app-server model cache after a Provider switch.
pub(crate) fn refresh_official_models(selected_model: String) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let generation = next_model_refresh_generation();
        let _ = thread::Builder::new()
            .name("codex-official-model-refresh".to_string())
            .spawn(move || {
                let payload = official_model_refresh_payload_or_default(selected_model);
                apply_model_refresh(generation, payload);
            });
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = selected_model;
    }
}

/// Loads the official catalog and refreshes Codex before returning to the caller.
pub(crate) fn refresh_official_models_blocking(selected_model: String) {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let generation = next_model_refresh_generation();
        let payload = official_model_refresh_payload_or_default(selected_model);
        apply_model_refresh(generation, payload);
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = selected_model;
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn schedule_model_refresh(request: ModelRefreshRequest) {
    let generation = next_model_refresh_generation();
    let _ = thread::Builder::new()
        .name("codex-model-picker-refresh".to_string())
        .spawn(move || apply_model_refresh(generation, request));
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn official_model_refresh_payload_or_default(selected_model: String) -> ModelRefreshRequest {
    load_official_model_refresh_payload(selected_model.clone()).unwrap_or_else(|error| {
        eprintln!("Failed to load the official Codex model catalog: {error}");
        empty_official_model_refresh_payload(selected_model)
    })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn next_model_refresh_generation() -> u64 {
    MODEL_REFRESH_GENERATION.fetch_add(1, Ordering::AcqRel) + 1
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn apply_model_refresh(generation: u64, request: ModelRefreshRequest) {
    let _guard = MODEL_REFRESH_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if MODEL_REFRESH_GENERATION.load(Ordering::Acquire) != generation {
        return;
    }
    match crate::dream_skin_native::refresh_codex_models(
        &request.models,
        &request.fast_mode_models,
        &request.image_input_models,
        &request.model_reasoning_efforts,
        &request.selected_model,
        request.reasoning_profile,
    ) {
        Ok(result) if result.refreshed => {}
        Ok(result) => eprintln!(
            "Codex model picker refresh was skipped: {}",
            result.reason.as_deref().unwrap_or("unknown reason")
        ),
        Err(error) => eprintln!("Codex model picker refresh failed: {error}"),
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn load_official_model_refresh_payload(
    selected_model: String,
) -> Result<ModelRefreshRequest, String> {
    let client_version = CODEX_RUNTIME_APP
        .get()
        .and_then(|app| crate::storage::resolve_paths(app).ok())
        .map(|paths| crate::official_models::model_client_version(&paths))
        .unwrap_or_else(|| crate::official_models::MIN_CODEX_MODEL_CLIENT_VERSION.to_string());
    let url = format!(
        "http://{}:{}/v1/models?client_version={}",
        crate::providers::LOCAL_PROXY_HOST,
        crate::providers::LOCAL_PROXY_PORT,
        client_version
    );
    let response = Client::builder()
        .timeout(OFFICIAL_MODEL_REFRESH_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to create the model catalog client: {error}"))?
        .get(url)
        .bearer_auth(crate::providers::LOCAL_PROXY_TOKEN)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Official model catalog request failed: {error}"))?;
    parse_official_model_catalog(response, selected_model)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn parse_official_model_catalog(
    response: reqwest::blocking::Response,
    selected_model: String,
) -> Result<ModelRefreshRequest, String> {
    let catalog = response
        .json::<OfficialModelsResponse>()
        .map_err(|error| format!("Official model catalog is invalid: {error}"))?;
    official_model_refresh_payload(catalog, selected_model)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn official_model_refresh_payload(
    catalog: OfficialModelsResponse,
    selected_model: String,
) -> Result<ModelRefreshRequest, String> {
    let mut builder = OfficialCatalogBuilder::default();
    for model in catalog.models {
        builder.append(model);
    }
    builder.finish(selected_model)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl OfficialCatalogBuilder {
    fn append(&mut self, model: OfficialModel) {
        if model.visibility.as_deref() == Some(HIDDEN_MODEL_VISIBILITY) {
            return;
        }
        let slug = model.slug.trim().to_string();
        if slug.is_empty() || !self.seen_models.insert(slug.clone()) {
            return;
        }
        if model.input_modalities.iter().any(|value| value == "image") {
            self.image_input_models.push(slug.clone());
        }
        if model
            .additional_speed_tiers
            .iter()
            .any(|tier| tier == "fast")
            || model.service_tiers.iter().any(|tier| tier.id == "priority")
        {
            self.fast_mode_models.push(slug.clone());
        }
        let efforts = unique_reasoning_efforts(model.supported_reasoning_levels);
        if !efforts.is_empty() {
            self.model_reasoning_efforts.insert(slug.clone(), efforts);
        }
        self.models.push(slug);
    }

    fn finish(self, selected_model: String) -> Result<ModelRefreshRequest, String> {
        if self.models.is_empty() {
            return Err("Official model catalog is empty".to_string());
        }
        Ok(ModelRefreshRequest {
            models: self.models,
            fast_mode_models: self.fast_mode_models,
            image_input_models: self.image_input_models,
            model_reasoning_efforts: self.model_reasoning_efforts,
            selected_model,
            reasoning_profile: crate::providers::ReasoningEffortProfile::Standard,
        })
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn unique_reasoning_efforts(
    levels: Vec<OfficialReasoningLevel>,
) -> Vec<crate::models::ReasoningEffort> {
    levels
        .into_iter()
        .map(|level| level.effort)
        .fold(Vec::new(), |mut efforts, effort| {
            if !efforts.contains(&effort) {
                efforts.push(effort);
            }
            efforts
        })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn empty_official_model_refresh_payload(selected_model: String) -> ModelRefreshRequest {
    ModelRefreshRequest {
        models: vec![selected_model.clone()],
        fast_mode_models: vec![selected_model.clone()],
        image_input_models: Vec::new(),
        model_reasoning_efforts: crate::models::ModelReasoningEfforts::new(),
        selected_model,
        reasoning_profile: crate::providers::ReasoningEffortProfile::Standard,
    }
}

#[cfg(all(test, any(target_os = "windows", target_os = "macos")))]
mod tests {
    use super::*;

    #[test]
    fn official_catalog_preserves_models_capabilities_and_reasoning() {
        let catalog = serde_json::from_value::<OfficialModelsResponse>(serde_json::json!({
            "models": [
                {
                    "slug": "gpt-5.6-sol",
                    "input_modalities": ["text", "image"],
                    "supported_reasoning_levels": [
                        { "effort": "low" },
                        { "effort": "ultra" },
                        { "effort": "ultra" }
                    ],
                    "additional_speed_tiers": ["fast"],
                    "service_tiers": [{ "id": "priority" }]
                },
                {
                    "slug": "gpt-reserve",
                    "visibility": "hide",
                    "input_modalities": ["text", "image"],
                    "supported_reasoning_levels": [{ "effort": "max" }],
                    "additional_speed_tiers": ["fast"]
                },
                { "slug": "gpt-5.4", "input_modalities": ["text"] },
                { "slug": "gpt-5.6-sol" }
            ]
        }))
        .unwrap();

        let payload = official_model_refresh_payload(catalog, "gpt-5.6-sol".to_string()).unwrap();

        assert_eq!(payload.models, vec!["gpt-5.6-sol", "gpt-5.4"]);
        assert_eq!(payload.image_input_models, vec!["gpt-5.6-sol"]);
        assert_eq!(payload.fast_mode_models, vec!["gpt-5.6-sol"]);
        assert!(!payload.model_reasoning_efforts.contains_key("gpt-reserve"));
        assert_eq!(
            payload.model_reasoning_efforts["gpt-5.6-sol"],
            vec![
                crate::models::ReasoningEffort::Low,
                crate::models::ReasoningEffort::Ultra
            ]
        );
    }

    #[test]
    fn official_catalog_rejects_empty_model_lists() {
        let catalog = OfficialModelsResponse { models: Vec::new() };

        let error = official_model_refresh_payload(catalog, "gpt-5.6-sol".to_string())
            .err()
            .unwrap();

        assert_eq!(error, "Official model catalog is empty");
    }

    #[test]
    fn official_fallback_keeps_fast_available_without_login() {
        let payload = empty_official_model_refresh_payload("gpt-5.6-sol".to_string());

        assert_eq!(payload.models, vec!["gpt-5.6-sol"]);
        assert_eq!(payload.fast_mode_models, vec!["gpt-5.6-sol"]);
    }
}
