use super::*;

pub(super) fn collect_local_providers<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<ProviderSyncPayload>, String> {
    let paths = resolve_paths(app)?;
    let mut providers = crate::providers::list_provider_profiles(&paths)?
        .into_iter()
        .map(|provider| {
            let field_modified_at =
                crate::providers::load_or_init_provider_field_modified_at(&paths, &provider.id)?;
            let last_modified_at = latest_provider_field_modified_at(&field_modified_at);
            Ok(provider_payload_from_profile(
                provider,
                last_modified_at,
                field_modified_at,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    providers.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(providers)
}

pub(super) fn collect_local_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<ProviderSyncPayload, String> {
    collect_local_providers(app)?
        .into_iter()
        .find(|provider| provider.id == id)
        .ok_or_else(|| format!("Local provider {id} does not exist"))
}

pub(super) fn apply_remote_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    provider: &ProviderSyncPayload,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    let remote_profile = provider_payload_to_profile(provider);
    let local_profile = crate::providers::read_provider(&paths, &provider.id).ok();
    let mut merged = local_profile
        .clone()
        .unwrap_or_else(|| remote_profile.clone());
    let mut local_versions = if local_profile.is_some() {
        crate::providers::load_or_init_provider_field_modified_at(&paths, &provider.id)?
    } else {
        ProviderFieldModifiedAt::default()
    };
    let remote_versions = normalize_provider_field_modified_at(
        provider.field_modified_at.clone(),
        &provider.last_modified_at,
    );
    let local_exists = local_profile.is_some();
    let mut changed = !local_exists;
    macro_rules! merge_field {
        ($field:ident) => {
            if !local_exists
                || remote_field_is_newer(&local_versions.$field, &remote_versions.$field)
            {
                merged.$field = remote_profile.$field.clone();
                local_versions.$field = remote_versions.$field.clone();
                changed = true;
            }
        };
    }
    merge_field!(kind);
    merge_field!(name);
    merge_field!(group);
    merge_field!(base_url);
    merge_field!(api_key);
    merge_field!(model);
    merge_field!(models);
    merge_field!(model_reasoning_efforts);
    merge_field!(model_context_windows);
    merge_field!(model_api_formats);
    if !local_exists
        || remote_field_is_newer(
            &local_versions.image_input_models,
            &remote_versions.image_input_models,
        )
    {
        merged.image_input_models = remote_profile.image_input_models.clone();
        if !merged.image_input_models.is_empty() {
            merged.image_input_models_configured = true;
        }
        local_versions.image_input_models = remote_versions.image_input_models.clone();
        changed = true;
    }
    merge_field!(context_window);
    merge_field!(model_selection_controlled_by_codex);
    merge_field!(api_format);
    merge_field!(balance_platform);
    merge_field!(balance_query_url);
    merge_field!(balance_query_token);
    merge_field!(wallet_query_url);
    merge_field!(wallet_query_token);
    merge_field!(wallet_username);
    merge_field!(wallet_password);
    if changed {
        let state = read_state(&paths);
        let active_group = state.active_provider_group.as_deref();
        let active = state.active_provider_id.as_deref() == Some(&provider.id)
            || active_group == Some(merged.group.as_str())
            || local_profile
                .as_ref()
                .is_some_and(|local| active_group == Some(local.group.as_str()));
        crate::providers::write_synced_provider(&paths, merged, &local_versions)?;
        if crate::local_proxy::is_running() && active {
            crate::providers::apply_local_proxy_config_for_state(app)?;
        }
    }
    Ok(changed)
}

pub(super) fn apply_remote_provider_deletion<R: Runtime>(
    app: &tauri::AppHandle<R>,
    provider_id: &str,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    let existed = crate::providers::read_provider(&paths, provider_id).is_ok();
    if existed {
        crate::providers::delete_provider(app.clone(), provider_id.to_string())?;
    }
    Ok(existed)
}

pub(super) fn normalize_provider_field_modified_at(
    mut values: ProviderFieldModifiedAt,
    fallback: &str,
) -> ProviderFieldModifiedAt {
    for value in [
        &mut values.kind,
        &mut values.name,
        &mut values.group,
        &mut values.base_url,
        &mut values.api_key,
        &mut values.model,
        &mut values.models,
        &mut values.model_reasoning_efforts,
        &mut values.model_context_windows,
        &mut values.model_api_formats,
        &mut values.image_input_models,
        &mut values.context_window,
        &mut values.model_selection_controlled_by_codex,
        &mut values.fast_mode_enabled,
        &mut values.api_format,
        &mut values.balance_platform,
        &mut values.balance_query_url,
        &mut values.balance_query_token,
        &mut values.wallet_query_url,
        &mut values.wallet_query_token,
        &mut values.wallet_username,
        &mut values.wallet_password,
    ] {
        if value.trim().is_empty() {
            *value = fallback.to_string();
        }
    }
    values
}

pub(super) fn latest_provider_field_modified_at(values: &ProviderFieldModifiedAt) -> String {
    [
        &values.kind,
        &values.name,
        &values.group,
        &values.base_url,
        &values.api_key,
        &values.model,
        &values.models,
        &values.model_reasoning_efforts,
        &values.model_context_windows,
        &values.model_api_formats,
        &values.image_input_models,
        &values.context_window,
        &values.model_selection_controlled_by_codex,
        &values.fast_mode_enabled,
        &values.api_format,
        &values.balance_platform,
        &values.balance_query_url,
        &values.balance_query_token,
        &values.wallet_query_url,
        &values.wallet_query_token,
        &values.wallet_username,
        &values.wallet_password,
    ]
    .into_iter()
    .filter_map(|value| parse_last_modified(value))
    .max()
    .unwrap_or_else(Utc::now)
    .to_rfc3339()
}

pub(super) fn provider_payload_from_profile(
    provider: ProviderProfile,
    last_modified_at: String,
    field_modified_at: ProviderFieldModifiedAt,
) -> ProviderSyncPayload {
    ProviderSyncPayload {
        id: provider.id,
        kind: provider.kind,
        name: provider.name,
        group: provider.group,
        base_url: provider.base_url,
        api_key: provider.api_key,
        model: provider.model,
        models: provider.models,
        model_reasoning_efforts: provider.model_reasoning_efforts,
        model_context_windows: provider.model_context_windows,
        model_api_formats: provider.model_api_formats,
        image_input_models: provider.image_input_models,
        context_window: provider.context_window,
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
        fast_mode_enabled: provider.fast_mode_enabled,
        api_format: provider.api_format,
        balance_platform: provider.balance_platform,
        balance_query_url: provider.balance_query_url,
        balance_query_token: provider.balance_query_token,
        wallet_query_url: provider.wallet_query_url,
        wallet_query_token: provider.wallet_query_token,
        wallet_username: provider.wallet_username,
        wallet_password: provider.wallet_password,
        last_modified_at,
        field_modified_at,
    }
}

pub(super) fn provider_payload_to_profile(provider: &ProviderSyncPayload) -> ProviderProfile {
    ProviderProfile {
        id: provider.id.clone(),
        kind: provider.kind,
        name: provider.name.clone(),
        group: provider.group.clone(),
        base_url: provider.base_url.clone(),
        api_key: provider.api_key.clone(),
        model: provider.model.clone(),
        models: provider.models.clone(),
        model_reasoning_efforts: provider.model_reasoning_efforts.clone(),
        model_context_windows: provider.model_context_windows.clone(),
        model_api_formats: provider.model_api_formats.clone(),
        image_input_models: provider.image_input_models.clone(),
        image_input_models_configured: !provider.image_input_models.is_empty(),
        context_window: provider.context_window,
        model_selection_controlled_by_codex: provider.model_selection_controlled_by_codex,
        fast_mode_enabled: provider.fast_mode_enabled,
        api_format: provider.api_format,
        balance_platform: provider.balance_platform,
        balance_query_url: provider.balance_query_url.clone(),
        balance_query_token: provider.balance_query_token.clone(),
        wallet_query_url: provider.wallet_query_url.clone(),
        wallet_query_token: provider.wallet_query_token.clone(),
        wallet_username: provider.wallet_username.clone(),
        wallet_password: provider.wallet_password.clone(),
    }
}

pub(super) fn get_remote_providers<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<CloudProvidersResponse, String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::GET,
        "/sync/providers",
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud provider download", response));
    }
    let payload: CloudProvidersResponse = response
        .json()
        .map_err(|error| format!("Cloud provider download response is invalid: {error}"))?;
    Ok(payload)
}
