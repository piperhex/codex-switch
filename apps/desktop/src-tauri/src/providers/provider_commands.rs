#[tauri::command]
pub(crate) fn list_providers<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ProviderSummary>, String> {
    let paths = resolve_paths(&app)?;
    let state = read_state(&paths);
    let mut providers = list_provider_profiles(&paths)?
        .into_iter()
        .map(|provider| {
            let active_in_group = state
                .active_provider_group
                .as_deref()
                .is_some_and(|group| !provider.group.is_empty() && provider.group == group);
            provider_summary(
                &provider,
                active_in_group || state.active_provider_id.as_deref() == Some(&provider.id),
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
    let group = if provider.group.trim().is_empty() {
        existing
            .as_ref()
            .map(|value| value.group.clone())
            .unwrap_or_default()
    } else {
        normalize_provider_group(&provider.group)?
    };
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
    let model_api_formats = normalize_model_api_formats(&models, provider.model_api_formats);
    let image_input_models = normalize_model_subset(&models, provider.image_input_models);
    let api_key = retained_api_key(existing.as_ref(), &base_url, provider.api_key.as_deref());
    if kind != ProviderKind::OpenAi
        && api_key.is_empty()
        && !crate::antigravity_provider::is_antigravity_identity(
            kind,
            &name,
            &base_url,
            provider.api_format,
        )
        && !crate::preset_provider::allows_missing_api_key_fields(
            kind,
            &name,
            &base_url,
            provider.api_format,
        )
    {
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

    let image_input_models_configured = provider
        .image_input_models_configured
        .or_else(|| {
            existing
                .as_ref()
                .map(|profile| profile.image_input_models_configured)
        })
        .unwrap_or(false);
    let profile = normalize_provider_profile(ProviderProfile {
        id,
        kind,
        name,
        group,
        base_url,
        api_key,
        model,
        models,
        model_reasoning_efforts,
        model_context_windows,
        model_api_formats,
        image_input_models,
        image_input_models_configured,
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
        refresh_codex_models_best_effort(&paths, &profile);
    } else if state.active_provider_group.as_deref() == Some(profile.group.as_str()) {
        let group_providers = provider_group_profiles(&paths, &profile.group)?;
        write_provider_group_local_proxy_config(&paths, &profile.group, &group_providers)?;
        refresh_codex_group_models_best_effort(&paths, &group_providers);
    }
    emit_providers_changed(&app)?;
    Ok(provider_summary(
        &profile,
        state.active_provider_id.as_deref() == Some(&profile.id)
            || state.active_provider_group.as_deref() == Some(profile.group.as_str()),
        state.auto_switch_provider_id.as_deref() == Some(&profile.id),
    ))
}

fn retained_api_key(
    existing: Option<&ProviderProfile>,
    base_url: &str,
    supplied_key: Option<&str>,
) -> String {
    let supplied_key = supplied_key.unwrap_or_default().trim();
    if !supplied_key.is_empty() {
        return supplied_key.to_string();
    }
    existing
        .filter(|value| value.base_url == base_url)
        .map(|value| value.api_key.clone())
        .unwrap_or_default()
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
