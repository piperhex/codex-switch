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
    "https://ark.cn-beijing.volces.com/api/plan/v3",
    "https://ark.cn-beijing.volces.com/api/coding/v3",
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
    preset!(Volcengine, "Volcengine ModelArk", OpenaiResponses, VOLCENGINE_ENDPOINTS, false, true, OpenAi),
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
