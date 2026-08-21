fn target_uses_provider(target: Option<&ImageModelTarget>, provider_id: &str) -> bool {
    matches!(
        target,
        Some(ImageModelTarget::Provider { provider_id: selected, .. }) if selected == provider_id
    )
}

pub(crate) fn apply_local_proxy_config_for_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    apply_local_proxy_config_for_paths(&paths)?;
    refresh_codex_models_for_current_target(&paths);
    Ok(())
}

pub(crate) fn apply_local_proxy_config_for_paths(paths: &Paths) -> Result<(), String> {
    let state = read_state(paths);
    sync_local_proxy_openai_auth_for_state(paths, &state)?;
    backup_codex_config_if_needed(
        paths,
        state.active_provider_id.is_none() && state.active_provider_group.is_none(),
    )?;
    if let Some(group) = state.active_provider_group.as_deref() {
        let providers = provider_group_profiles(paths, group)?;
        return write_provider_group_local_proxy_config(paths, group, &providers);
    }
    if let Some(id) = state.active_provider_id.as_deref() {
        if crate::aggregate_api::is_active_id(id) {
            let config = crate::aggregate_api::read_active_config(paths, id)?;
            let profiles = crate::aggregate_api::member_profiles(paths, &config)?;
            let profile = crate::aggregate_api::logical_profile(&config, &profiles)?;
            return write_provider_local_proxy_config(paths, &profile);
        }
        let provider = read_provider(paths, id)?;
        ensure_not_local_proxy_base_url(&provider.base_url)?;
        write_provider_local_proxy_config(paths, &provider)
    } else {
        write_official_local_proxy_config(paths)
    }
}

pub(crate) fn ensure_local_proxy_compatible_for_state(paths: &Paths) -> Result<(), String> {
    let state = read_state(paths);
    validate_local_proxy_openai_auth_account(
        paths,
        state.local_proxy_openai_auth_account_id.as_deref(),
    )?;
    if state.active_provider_id.is_some() || state.active_provider_group.is_some() {
        return Ok(());
    }
    let Some(account_id) = state.active_account_id.as_deref() else {
        return Ok(());
    };
    let auth = read_json(&managed_auth_path(paths, account_id))?;
    validate_official_auth_for_local_proxy(&auth)
}

pub(crate) fn activate_provider_for_sync(paths: &Paths, id: &str) -> Result<bool, String> {
    let provider = read_provider(paths, id)?;
    ensure_not_local_proxy_base_url(&provider.base_url)?;
    if provider.kind != ProviderKind::OpenAi
        && provider.api_key.trim().is_empty()
        && !crate::antigravity_provider::allows_missing_api_key(&provider)
        && !crate::preset_provider::allows_missing_api_key(&provider)
    {
        return Ok(false);
    }
    if !crate::local_proxy::is_running() {
        return Ok(false);
    }

    let original_state = read_state(paths);
    backup_codex_config_if_needed(
        paths,
        original_state.active_provider_id.is_none()
            && original_state.active_provider_group.is_none(),
    )?;
    let mut state = original_state.clone();
    state.active_provider_id = Some(provider.id.clone());
    state.active_provider_group = None;
    state.active_account_id = None;
    state.concurrent_account_routing_enabled = false;
    write_state(paths, &state)?;
    if let Err(error) = write_provider_local_proxy_config(paths, &provider) {
        let _ = write_state(paths, &original_state);
        return Err(error);
    }
    refresh_codex_models_best_effort(paths, &provider);
    Ok(true)
}

pub(crate) fn cleanup_stale_local_proxy_config<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    cleanup_non_proxy_provider_state(&paths)
}

fn cleanup_non_proxy_provider_state(paths: &Paths) -> Result<(), String> {
    let mut state = read_state(paths);
    let has_managed_proxy_config = if paths.current_config.exists() {
        let current = fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?;
        config_contains_local_proxy(&current)
    } else {
        false
    };
    if state.active_provider_id.is_none()
        && state.active_provider_group.is_none()
        && !has_managed_proxy_config
    {
        return Ok(());
    }
    restore_official_config(paths)?;
    state.active_provider_id = None;
    state.active_provider_group = None;
    state.local_proxy_enabled = false;
    write_state(paths, &state)
}

pub(crate) fn restore_official_config(paths: &Paths) -> Result<(), String> {
    restore_official_config_with_model(paths, None)
}

pub(crate) fn restore_default_official_config(paths: &Paths) -> Result<(), String> {
    restore_official_config_with_model(paths, Some(DEFAULT_OFFICIAL_MODEL))
}

fn restore_official_config_with_model(paths: &Paths, model: Option<&str>) -> Result<(), String> {
    let backup = paths
        .config_backup
        .exists()
        .then(|| {
            fs::read_to_string(&paths.config_backup)
                .map_err(|error| format!("Failed to read Codex config backup: {error}"))
        })
        .transpose()?;
    let current = if paths.current_config.exists() {
        fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?
    } else {
        backup.clone().unwrap_or_default()
    };
    let official_config = codex_config::restore_official(&current, backup.as_deref(), model)
        .map_err(|error| error.to_string())?;
    write_text_if_changed(&paths.current_config, &official_config)?;
    if paths.config_backup.exists() {
        fs::remove_file(&paths.config_backup)
            .map_err(|error| format!("Failed to clear Codex config backup: {error}"))?;
    }
    Ok(())
}

fn provider_path(paths: &Paths, id: &str) -> PathBuf {
    paths.providers.join(format!("{id}.json"))
}

fn provider_field_modified_at_path(paths: &Paths, id: &str) -> PathBuf {
    paths.providers.join(format!("{id}.field-modified-at.json"))
}

pub(crate) fn list_provider_profiles(paths: &Paths) -> Result<Vec<ProviderProfile>, String> {
    fs::create_dir_all(&paths.providers)
        .map_err(|error| format!("Failed to create provider store: {error}"))?;

    let mut providers = Vec::new();
    for entry in fs::read_dir(&paths.providers)
        .map_err(|error| format!("Failed to read provider store: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json")
            || entry
                .file_name()
                .to_string_lossy()
                .ends_with(".field-modified-at.json")
        {
            continue;
        }
        providers.push(read_provider_file(entry.path())?);
    }
    providers.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(providers)
}
