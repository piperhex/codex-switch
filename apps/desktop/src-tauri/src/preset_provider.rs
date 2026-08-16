use std::{collections::HashSet, io::Read, time::Duration};

use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::Value;
use tauri::Runtime;
use url::Url;

use crate::{
    models::{ProviderApiFormat, ProviderKind, ProviderProfile},
    providers::read_provider,
    storage::resolve_paths,
};

const MAX_MODEL_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const MODEL_QUERY_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_MODELS: usize = 500;

const BAILIAN_CODING_MODELS: &str = concat!(
    "qwen3.7-plus\nqwen3.6-plus\nkimi-k2.5\nglm-5\nMiniMax-M2.5\n",
    "qwen3.5-plus\nqwen3-max-2026-01-23\nqwen3-coder-next\nqwen3-coder-plus\nglm-4.7",
);
const BAILIAN_PAYG_RESPONSES_MODELS: &str = concat!(
    "qwen3.7-max\nqwen3.7-plus\nqwen3.6-plus\nqwen3.5-plus\n",
    "qwen3-max-2026-01-23\nqwen3-coder-plus",
);
const BAILIAN_WORKSPACE_REGIONS: &str = concat!(
    "cn-beijing.maas.aliyuncs.com,ap-southeast-1.maas.aliyuncs.com,",
    "ap-northeast-1.maas.aliyuncs.com,eu-central-1.maas.aliyuncs.com",
);

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PresetProviderId {
    OpenRouter,
    Kimi,
    Gemini,
    Bailian,
    Ollama,
    LmStudio,
    Glm,
    MiniMax,
    Mistral,
    Volcengine,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetModelQuery {
    preset_id: PresetProviderId,
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ModelSource {
    OpenAi,
    BailianStatic,
    LmStudioNative,
    Unavailable,
}

#[derive(Clone, Copy)]
struct PresetSpec {
    id: PresetProviderId,
    name: &'static str,
    api_format: ProviderApiFormat,
    endpoints: &'static [&'static str],
    local_only: bool,
    api_key_required: bool,
    model_source: ModelSource,
}

macro_rules! preset {
    (
        $id:ident, $name:literal, $format:ident, $endpoints:expr,
        $local:literal, $key:literal, $source:ident
    ) => {
        PresetSpec {
            id: PresetProviderId::$id,
            name: $name,
            api_format: ProviderApiFormat::$format,
            endpoints: $endpoints,
            local_only: $local,
            api_key_required: $key,
            model_source: ModelSource::$source,
        }
    };
}

const OPENROUTER_ENDPOINTS: &[&str] = &["https://openrouter.ai/api/v1"];
const KIMI_ENDPOINTS: &[&str] = &["https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1"];
const GEMINI_ENDPOINTS: &[&str] = &["https://generativelanguage.googleapis.com/v1beta/openai"];
const BAILIAN_ENDPOINTS: &[&str] = &[
    "https://coding.dashscope.aliyuncs.com/v1",
    "https://coding-intl.dashscope.aliyuncs.com/v1",
];
const GLM_ENDPOINTS: &[&str] = &[
    "https://open.bigmodel.cn/api/paas/v4",
    "https://open.bigmodel.cn/api/coding/paas/v4",
    "https://api.z.ai/api/paas/v4",
];
const MINIMAX_ENDPOINTS: &[&str] = &["https://api.minimaxi.com/v1", "https://api.minimax.io/v1"];
const MISTRAL_ENDPOINTS: &[&str] = &["https://api.mistral.ai/v1", "https://api.eu.mistral.ai/v1"];
const VOLCENGINE_ENDPOINTS: &[&str] = &[
    "https://ark.cn-beijing.volces.com/api/v3",
    "https://ark.ap-southeast.bytepluses.com/api/v3",
];

#[rustfmt::skip]
const PRESET_SPECS: &[PresetSpec] = &[
    preset!(OpenRouter, "OpenRouter", OpenaiResponses, OPENROUTER_ENDPOINTS, false, true, OpenAi),
    preset!(Kimi, "Kimi", OpenaiChat, KIMI_ENDPOINTS, false, true, OpenAi),
    preset!(Gemini, "Gemini API", OpenaiChat, GEMINI_ENDPOINTS, false, true, OpenAi),
    preset!(Bailian, "Alibaba Cloud Model Studio", OpenaiChat, BAILIAN_ENDPOINTS, false, true, BailianStatic),
    preset!(Ollama, "Ollama", OpenaiResponses, &[], true, false, OpenAi),
    preset!(LmStudio, "LM Studio", OpenaiResponses, &[], true, false, LmStudioNative),
    preset!(Glm, "GLM", OpenaiChat, GLM_ENDPOINTS, false, true, Unavailable),
    preset!(MiniMax, "MiniMax", OpenaiChat, MINIMAX_ENDPOINTS, false, true, OpenAi),
    preset!(Mistral, "Mistral", OpenaiChat, MISTRAL_ENDPOINTS, false, true, OpenAi),
    preset!(Volcengine, "Volcengine ModelArk", OpenaiResponses, VOLCENGINE_ENDPOINTS, false, true, Unavailable),
];

#[tauri::command]
pub(crate) async fn fetch_preset_models<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    request: PresetModelQuery,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_models_blocking(app, request))
        .await
        .map_err(|error| format!("Model query task failed: {error}"))?
}

fn fetch_models_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: PresetModelQuery,
) -> Result<Vec<String>, String> {
    let spec = preset_spec(request.preset_id);
    if spec.model_source == ModelSource::BailianStatic {
        return bailian_static_models(&request.base_url);
    }
    if spec.model_source == ModelSource::Unavailable {
        return Err("This service does not provide a compatible model list".to_string());
    }
    let query_url = models_url(spec, &request.base_url)?;
    let token = resolve_api_key(&app, spec, &request)?;
    let client = model_query_client(spec.local_only)?;
    let mut query = client
        .get(query_url)
        .header(reqwest::header::ACCEPT, "application/json");
    if !token.is_empty() {
        query = query.bearer_auth(token);
    }
    let response = query
        .send()
        .map_err(|error| format!("Could not connect to {}: {error}", spec.name))?;
    let payload = read_model_response(response, spec.name)?;
    parse_models(spec, &payload)
}

fn preset_spec(id: PresetProviderId) -> &'static PresetSpec {
    let spec = PRESET_SPECS.iter().find(|spec| spec.id == id);
    let Some(spec) = spec else {
        unreachable!("every preset id has a descriptor");
    };
    spec
}

fn model_query_client(local_only: bool) -> Result<Client, String> {
    let builder = Client::builder()
        .timeout(MODEL_QUERY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Codex-Switch");
    let builder = if local_only {
        builder.no_proxy()
    } else {
        crate::system_proxy::apply(builder)
    };
    builder
        .build()
        .map_err(|error| format!("Could not prepare the model connection: {error}"))
}

fn resolve_api_key<R: Runtime>(
    app: &tauri::AppHandle<R>,
    spec: &PresetSpec,
    request: &PresetModelQuery,
) -> Result<String, String> {
    let supplied_key = request.api_key.as_deref().unwrap_or_default().trim();
    if !supplied_key.is_empty() {
        return Ok(supplied_key.to_string());
    }
    if let Some(provider_id) = request.provider_id.as_deref() {
        let paths = resolve_paths(app).map_err(|_| "Saved provider could not be loaded")?;
        let provider = read_provider(&paths, provider_id)
            .map_err(|_| "Saved provider could not be loaded".to_string())?;
        if let Some(api_key) = reusable_api_key(&provider, spec.id, &request.base_url) {
            return Ok(api_key);
        }
    }
    if spec.api_key_required {
        Err(format!(
            "Enter the {} API key before loading models",
            spec.name
        ))
    } else {
        Ok(String::new())
    }
}

fn reusable_api_key(
    provider: &ProviderProfile,
    id: PresetProviderId,
    requested_base_url: &str,
) -> Option<String> {
    let spec = preset_spec(id);
    (matches_identity(provider, spec)
        && same_preset_endpoint(spec, &provider.base_url, requested_base_url))
    .then(|| provider.api_key.trim().to_string())
    .filter(|api_key| !api_key.is_empty())
}

fn same_preset_endpoint(spec: &PresetSpec, left: &str, right: &str) -> bool {
    let (Ok(mut left), Ok(mut right)) = (
        validate_base_url(spec, left),
        validate_base_url(spec, right),
    ) else {
        return false;
    };
    let left_path = left.path().trim_end_matches('/').to_string();
    let right_path = right.path().trim_end_matches('/').to_string();
    left.set_path(&left_path);
    right.set_path(&right_path);
    left == right
}

fn matches_identity(provider: &ProviderProfile, spec: &PresetSpec) -> bool {
    provider.kind == ProviderKind::Custom
        && provider.name.trim() == spec.name
        && provider.api_format == api_format_for_base_url(spec, &provider.base_url)
        && validate_base_url(spec, &provider.base_url).is_ok()
}

fn api_format_for_base_url(spec: &PresetSpec, base_url: &str) -> ProviderApiFormat {
    let Ok(url) = validate_base_url(spec, base_url) else {
        return spec.api_format;
    };
    match spec.id {
        PresetProviderId::Bailian if !is_bailian_coding_endpoint(&url) => {
            ProviderApiFormat::OpenaiResponses
        }
        _ => spec.api_format,
    }
}

pub(crate) fn allows_missing_api_key(provider: &ProviderProfile) -> bool {
    PRESET_SPECS
        .iter()
        .filter(|spec| !spec.api_key_required)
        .any(|spec| matches_identity(provider, spec))
}

pub(crate) fn allows_missing_api_key_fields(
    kind: ProviderKind,
    name: &str,
    base_url: &str,
    api_format: ProviderApiFormat,
) -> bool {
    PRESET_SPECS
        .iter()
        .filter(|spec| !spec.api_key_required)
        .any(|spec| {
            kind == ProviderKind::Custom
                && name.trim() == spec.name
                && api_format == api_format_for_base_url(spec, base_url)
                && validate_base_url(spec, base_url).is_ok()
        })
}

fn models_url(spec: &PresetSpec, base_url: &str) -> Result<Url, String> {
    let mut url = validate_base_url(spec, base_url)?;
    if spec.model_source == ModelSource::LmStudioNative {
        url.set_path("/api/v1/models");
    } else {
        let path = format!("{}/models", url.path().trim_end_matches('/'));
        url.set_path(&path);
    }
    if spec.id == PresetProviderId::OpenRouter {
        url.query_pairs_mut()
            .append_pair("output_modalities", "text")
            .append_pair("supported_parameters", "tools");
    }
    Ok(url)
}

fn validate_base_url(spec: &PresetSpec, base_url: &str) -> Result<Url, String> {
    let url = Url::parse(base_url.trim())
        .map_err(|error| format!("{} Base URL is invalid: {error}", spec.name))?;
    let has_extra_parts = !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some();
    if has_extra_parts {
        return Err(format!("{} Base URL contains unsupported parts", spec.name));
    }
    if spec.local_only {
        validate_local_base_url(spec, &url)?;
        return Ok(url);
    }
    if url.scheme() != "https" {
        return Err(format!("Choose an official {} endpoint", spec.name));
    }
    if spec.id == PresetProviderId::Bailian && is_bailian_payg_endpoint(&url) {
        return Ok(url);
    }
    let normalized = base_url.trim().trim_end_matches('/');
    if spec.endpoints.contains(&normalized) {
        Ok(url)
    } else {
        Err(format!("Choose an official {} endpoint", spec.name))
    }
}

fn validate_local_base_url(spec: &PresetSpec, url: &Url) -> Result<(), String> {
    let is_loopback = url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host == "127.0.0.1"
            || matches!(host, "::1" | "[::1]")
    });
    let valid_path = url.path().trim_end_matches('/') == "/v1";
    if url.scheme() == "http" && is_loopback && url.port().is_some() && valid_path {
        Ok(())
    } else {
        Err(format!(
            "{} must use an HTTP loopback address ending in /v1",
            spec.name
        ))
    }
}

fn is_bailian_coding_endpoint(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("coding.dashscope.aliyuncs.com" | "coding-intl.dashscope.aliyuncs.com")
    ) && url.path().trim_end_matches('/') == "/v1"
}

fn is_bailian_payg_endpoint(url: &Url) -> bool {
    if url.port().is_some() || url.path().trim_end_matches('/') != "/compatible-mode/v1" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    if matches!(
        host,
        "dashscope.aliyuncs.com" | "dashscope-intl.aliyuncs.com" | "dashscope-us.aliyuncs.com"
    ) {
        return true;
    }
    BAILIAN_WORKSPACE_REGIONS
        .split(',')
        .any(|region| valid_workspace_host(host, region))
}

fn valid_workspace_host(host: &str, region: &str) -> bool {
    let Some(workspace) = host.strip_suffix(&format!(".{region}")) else {
        return false;
    };
    !workspace.is_empty()
        && !workspace.starts_with('-')
        && !workspace.ends_with('-')
        && workspace
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn bailian_static_models(base_url: &str) -> Result<Vec<String>, String> {
    let spec = preset_spec(PresetProviderId::Bailian);
    let url = validate_base_url(spec, base_url)?;
    let models = if is_bailian_coding_endpoint(&url) {
        BAILIAN_CODING_MODELS
    } else {
        BAILIAN_PAYG_RESPONSES_MODELS
    };
    Ok(models.lines().map(str::to_string).collect())
}

fn read_model_response(
    response: reqwest::blocking::Response,
    provider_name: &str,
) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{provider_name} returned HTTP {}", status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODEL_RESPONSE_BYTES)
    {
        return Err(format!("{provider_name} returned too much model data"));
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_MODEL_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the {provider_name} model list: {error}"))?;
    if bytes.len() as u64 > MAX_MODEL_RESPONSE_BYTES {
        return Err(format!("{provider_name} returned too much model data"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{provider_name} returned invalid model data: {error}"))
}

fn parse_models(spec: &PresetSpec, payload: &Value) -> Result<Vec<String>, String> {
    let entries = payload
        .get("data")
        .or_else(|| payload.get("models"))
        .and_then(Value::as_array)
        .ok_or_else(|| "The model list is missing from the response".to_string())?;
    let mut candidates = entries
        .iter()
        .filter(|entry| model_entry_is_supported(spec.id, entry))
        .filter(|entry| lm_studio_model_is_supported(spec, entry))
        .filter_map(|entry| model_id(entry).map(|model| (model, model_prefers_tools(entry))))
        .filter(|(model, _)| model_is_supported(spec.id, model))
        .collect::<Vec<_>>();
    if spec.model_source == ModelSource::LmStudioNative {
        candidates.sort_by_key(|(_, trained_for_tools)| !trained_for_tools);
    }
    let mut seen = HashSet::new();
    let models = candidates
        .into_iter()
        .filter(|(model, _)| seen.insert((*model).to_string()))
        .take(MAX_MODELS)
        .map(|(model, _)| model.to_string())
        .collect::<Vec<_>>();
    if models.is_empty() {
        Err("The service did not return any usable models".to_string())
    } else {
        Ok(models)
    }
}

fn lm_studio_model_is_supported(spec: &PresetSpec, entry: &Value) -> bool {
    spec.model_source != ModelSource::LmStudioNative
        || entry.get("type").and_then(Value::as_str) == Some("llm")
}

fn model_entry_is_supported(id: PresetProviderId, entry: &Value) -> bool {
    if id != PresetProviderId::Mistral {
        return true;
    }
    let capability = |name| {
        entry
            .get("capabilities")
            .and_then(|value| value.get(name))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    };
    let archived = entry
        .get("archived")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    capability("completion_chat") && capability("function_calling") && !archived
}

fn model_prefers_tools(entry: &Value) -> bool {
    entry
        .get("trained_for_tool_use")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn model_id(entry: &Value) -> Option<&str> {
    entry
        .get("id")
        .or_else(|| entry.get("key"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
}

fn model_is_supported(id: PresetProviderId, model: &str) -> bool {
    let normalized = model.to_ascii_lowercase();
    match id {
        PresetProviderId::Gemini => {
            normalized.starts_with("gemini-") && !normalized.contains("embedding")
        }
        PresetProviderId::Glm => normalized.starts_with("glm-"),
        PresetProviderId::MiniMax => normalized.starts_with("minimax-m"),
        PresetProviderId::Mistral => !["embed", "moderation", "ocr", "transcribe", "voxtral"]
            .iter()
            .any(|excluded| normalized.contains(excluded)),
        _ => true,
    }
}
#[cfg(test)]
#[path = "preset_provider_test_support.rs"]
mod test_support;
#[cfg(test)]
pub(crate) use test_support::{inspect_preset_for_test, reusable_api_key_for_test};
