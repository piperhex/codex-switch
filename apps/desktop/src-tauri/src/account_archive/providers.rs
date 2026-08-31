fn collect_providers(paths: &crate::storage::Paths) -> Result<Vec<ProviderSyncPayload>, String> {
    crate::providers::list_provider_profiles(paths)?
        .into_iter()
        .map(|provider| {
            let field_modified_at =
                crate::providers::load_or_init_provider_field_modified_at(paths, &provider.id)?;
            let last_modified_at =
                crate::providers::provider_modified_at(paths, &provider.id)?.to_rfc3339();
            Ok(provider_payload_from_profile(
                provider,
                last_modified_at,
                field_modified_at,
            ))
        })
        .collect()
}

fn provider_payload_from_profile(
    provider: ProviderProfile,
    last_modified_at: String,
    field_modified_at: crate::models::ProviderFieldModifiedAt,
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

fn provider_payload_to_profile(provider: &ProviderSyncPayload) -> Result<ProviderProfile, String> {
    Ok(ProviderProfile {
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
    })
}

fn normalize_archive_path(path: &Path) -> PathBuf {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cs"))
    {
        path.to_path_buf()
    } else {
        path.with_extension("cs")
    }
}
