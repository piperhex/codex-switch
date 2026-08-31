fn require_non_empty(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn normalize_provider_group(value: &str) -> Result<String, String> {
    let group = value.trim();
    if group.chars().count() > 80 {
        return Err("Provider group must be 80 characters or fewer".to_string());
    }
    if group.chars().any(char::is_control) {
        return Err("Provider group contains unsupported characters".to_string());
    }
    Ok(group.to_string())
}

fn normalize_provider_groups(groups: Vec<String>) -> Result<Vec<String>, String> {
    if groups.len() > MAX_PROVIDER_GROUP_COUNT {
        return Err(format!(
            "No more than {MAX_PROVIDER_GROUP_COUNT} Provider groups are allowed"
        ));
    }
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for group in groups {
        let group = normalize_provider_group(&group)?;
        if group.is_empty() {
            return Err("Provider group name is required".to_string());
        }
        if seen.insert(group.clone()) {
            normalized.push(group);
        }
    }
    Ok(normalized)
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

fn normalize_model_api_formats(models: &[String], configured: ModelApiFormats) -> ModelApiFormats {
    configured
        .into_iter()
        .filter_map(|(configured_model, api_format)| {
            let model = configured_model.trim();
            models
                .iter()
                .any(|candidate| candidate == model)
                .then(|| (model.to_string(), api_format))
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
        provider.fast_mode_enabled = true;
        provider.api_format = ProviderApiFormat::OpenaiResponses;
        provider.group.clear();
    }
    provider.group = normalize_provider_group(&provider.group)?;
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
    provider.model_api_formats =
        normalize_model_api_formats(&provider.models, provider.model_api_formats);
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
    provider.group = normalize_provider_group(&provider.group)?;
    provider.base_url = normalize_base_url(&provider.base_url)?;
    provider.api_key = provider.api_key.trim().to_string();
    if provider.kind != ProviderKind::OpenAi
        && provider.api_key.is_empty()
        && !crate::antigravity_provider::allows_missing_api_key(&provider)
        && !crate::preset_provider::allows_missing_api_key(&provider)
    {
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
        return Err(concat!(
            "Provider Base URL must be an upstream API endpoint, ",
            "not the Codex Switch local proxy endpoint"
        )
        .to_string());
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
        preserve_refreshed_auth(paths, account_id);
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

/// Codex may refresh the OAuth token in the live `auth.json` while the proxy is
/// running. Keep that refreshed payload in the managed account before a later
/// proxy/configuration update copies the managed payload back to the live file.
/// This is intentionally best-effort: a partially written external file must
/// never make an otherwise valid proxy configuration change fail.
pub(crate) fn preserve_refreshed_auth(paths: &Paths, account_id: &str) {
    let Ok(mut current_auth) = read_json(&paths.current_auth) else {
        return;
    };
    if crate::auth::is_agent_identity_auth(&current_auth) {
        return;
    }
    let has_original_refresh_time = current_auth
        .get("last_refresh")
        .and_then(Value::as_str)
        .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok());
    if !has_original_refresh_time
        || crate::auth::canonicalize_chatgpt_auth(&mut current_auth).is_err()
        || crate::auth::validate_auth(&current_auth).is_err()
        || crate::auth::account_fields(&current_auth)
            .map(|(_, _, _, id)| id != account_id)
            .unwrap_or(true)
    {
        return;
    }
    if let Err(error) = crate::storage::write_managed_auth_if_newer(paths, account_id, &current_auth)
    {
        eprintln!("failed to preserve refreshed proxy auth for {account_id}: {error}");
    }
}

fn validate_official_auth_for_local_proxy(auth: &Value) -> Result<(), String> {
    validate_auth(auth).map_err(|error| {
        format!(
            concat!(
                "Official Codex local proxy requires a ChatGPT auth.json with tokens.access_token. ",
                "Switch to a valid signed-in official Codex account before starting proxy: {error}"
            ),
            error = error
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
