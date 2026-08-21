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
#[path = "../preset_provider_test_support.rs"]
mod test_support;
#[cfg(test)]
pub(crate) use test_support::{inspect_preset_for_test, reusable_api_key_for_test};
