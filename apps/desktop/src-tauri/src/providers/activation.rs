#[tauri::command]
pub(crate) async fn switch_provider<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || switch_provider_blocking(app, id))
        .await
        .map_err(|error| format!("Provider switch task failed: {error}"))?
}

pub(crate) fn switch_provider_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let provider = read_provider(&paths, &id)?;
    activate_provider_profile(&app, &paths, &provider)
}

#[tauri::command]
pub(crate) async fn switch_provider_group<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    group: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || switch_provider_group_blocking(app, group))
        .await
        .map_err(|error| format!("Provider group switch task failed: {error}"))?
}

pub(crate) fn switch_provider_group_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    group: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let group = normalize_provider_group(&group)?;
    let providers = provider_group_profiles(&paths, &group)?;
    for provider in &providers {
        validate_provider_activation(provider)?;
    }
    let original_state = try_read_state(&paths)?;
    let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
    if write_codex {
        for target in crate::storage::resolve_enabled_paths(&app)? {
            backup_codex_config_if_needed(
                &target,
                original_state.active_provider_id.is_none()
                    && original_state.active_provider_group.is_none(),
            )?;
        }
    }
    let mut state = original_state.clone();
    state.active_provider_id = None;
    state.active_provider_group = Some(group.clone());
    state.active_account_id = None;
    change_concurrent_account_routing(&mut state, false, "Provider group switch");
    write_state(&paths, &state)?;
    let config_result = if write_codex {
        crate::storage::resolve_enabled_paths(&app)?
            .iter()
            .try_for_each(|target| {
                write_provider_group_local_proxy_config(target, &group, &providers)
            })
    } else {
        Ok(())
    };
    if let Err(error) = config_result {
        if let Err(rollback_error) = restore_provider_activation_state(
            &paths,
            original_state,
            "Provider group switch rollback",
        ) {
            eprintln!("failed to restore Provider group state: {rollback_error}");
        }
        return Err(error);
    }
    if write_codex {
        for target in crate::storage::resolve_enabled_paths(&app)? {
            refresh_codex_group_models_now_best_effort(&target, &providers);
        }
    }
    crate::claude_code::sync_after_switch(&app)?;
    emit_providers_changed(&app)
}

pub(crate) fn switch_provider_model_and_activate_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    model: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let mut provider = read_provider(&paths, &id)?;
    if provider.model_selection_controlled_by_codex {
        return Err("Provider model selection is controlled within Codex".to_string());
    }
    let selected_model = require_non_empty("Model", &model)?;
    if !provider.models.iter().any(|value| value == &selected_model) {
        return Err("Provider model does not exist".to_string());
    }
    provider.model = selected_model;
    provider = normalize_provider_profile(provider)?;
    validate_provider_activation(&provider)?;
    write_local_provider(&paths, &provider, None)?;
    activate_provider_profile(&app, &paths, &provider)
}

fn activate_provider_profile<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    provider: &ProviderProfile,
) -> Result<(), String> {
    validate_provider_activation(provider)?;
    let original_state = try_read_state(paths)?;
    let write_codex = crate::claude_code::should_write_codex_for_app(app)?;
    if write_codex {
        for target in crate::storage::resolve_enabled_paths(app)? {
            backup_codex_config_if_needed(
                &target,
                original_state.active_provider_id.is_none()
                    && original_state.active_provider_group.is_none(),
            )?;
        }
    }
    let mut state = original_state.clone();
    state.active_provider_id = Some(provider.id.clone());
    state.active_provider_group = None;
    state.active_account_id = None;
    change_concurrent_account_routing(&mut state, false, "Provider switch");
    write_state(paths, &state)?;
    let config_result = if write_codex {
        crate::storage::resolve_enabled_paths(app)?
            .iter()
            .try_for_each(|target| write_provider_local_proxy_config(target, provider))
    } else {
        Ok(())
    };
    if let Err(error) = config_result {
        if let Err(rollback_error) = restore_provider_activation_state(
            paths,
            original_state,
            "Provider switch rollback",
        ) {
            eprintln!("failed to restore provider state after activation error: {rollback_error}");
        }
        return Err(error);
    }
    if write_codex {
        for target in crate::storage::resolve_enabled_paths(app)? {
            refresh_codex_models_now_best_effort(&target, provider);
        }
    }
    crate::claude_code::sync_after_switch(app)?;
    emit_providers_changed(app)
}

pub(crate) fn activate_logical_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    provider: &ProviderProfile,
) -> Result<(), String> {
    ensure_local_proxy_running_for_provider()?;
    ensure_not_local_proxy_base_url(&provider.base_url)?;
    let original_state = try_read_state(paths)?;
    let write_codex = crate::claude_code::should_write_codex_for_app(app)?;
    if write_codex {
        for target in crate::storage::resolve_enabled_paths(app)? {
            backup_codex_config_if_needed(
                &target,
                original_state.active_provider_id.is_none()
                    && original_state.active_provider_group.is_none(),
            )?;
        }
    }
    let mut state = original_state.clone();
    state.active_provider_id = Some(provider.id.clone());
    state.active_provider_group = None;
    state.active_account_id = None;
    change_concurrent_account_routing(&mut state, false, "logical Provider switch");
    write_state(paths, &state)?;
    let config_result = if write_codex {
        crate::storage::resolve_enabled_paths(app)?
            .iter()
            .try_for_each(|target| write_provider_local_proxy_config(target, provider))
    } else {
        Ok(())
    };
    if let Err(error) = config_result {
        if let Err(rollback_error) = restore_provider_activation_state(
            paths,
            original_state,
            "logical Provider switch rollback",
        ) {
            eprintln!("failed to restore aggregate API state: {rollback_error}");
        }
        return Err(error);
    }
    if write_codex {
        for target in crate::storage::resolve_enabled_paths(app)? {
            refresh_codex_models_best_effort(&target, provider);
        }
    }
    crate::claude_code::sync_after_switch(app)?;
    emit_providers_changed(app)
}

fn restore_provider_activation_state(
    paths: &Paths,
    mut state: ManagerStateFile,
    reason: &str,
) -> Result<(), String> {
    let enabled = state.concurrent_account_routing_enabled;
    change_concurrent_account_routing(&mut state, enabled, reason);
    write_state(paths, &state)
}

pub(crate) fn validate_provider_activation(provider: &ProviderProfile) -> Result<(), String> {
    ensure_not_local_proxy_base_url(&provider.base_url)?;
    ensure_local_proxy_running_for_provider()?;
    if provider.kind != ProviderKind::OpenAi
        && provider.api_key.trim().is_empty()
        && !crate::antigravity_provider::allows_missing_api_key(provider)
        && !crate::preset_provider::allows_missing_api_key(provider)
    {
        return Err("Provider API key is empty".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn switch_provider_model<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    model: String,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(&app)?;
    let mut provider = read_provider(&paths, &id)?;
    let selected_model = require_non_empty("Model", &model)?;
    if !provider.models.iter().any(|value| value == &selected_model) {
        provider.models.push(selected_model.clone());
    }
    provider.model = selected_model;
    provider = normalize_provider_profile(provider)?;
    write_local_provider(&paths, &provider, None)?;

    let state = read_state(&paths);
    let active = state.active_provider_id.as_deref() == Some(&provider.id);
    let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
    if active && write_codex {
        for target in crate::storage::resolve_enabled_paths(&app)? {
            write_active_provider_config(&target, &provider)?;
            refresh_codex_models_best_effort(&target, &provider);
        }
    } else if write_codex
        && state.active_provider_group.as_deref() == Some(provider.group.as_str())
    {
        let group_providers = provider_group_profiles(&paths, &provider.group)?;
        for target in crate::storage::resolve_enabled_paths(&app)? {
            write_provider_group_local_proxy_config(
                &target,
                &provider.group,
                &group_providers,
            )?;
            refresh_codex_group_models_best_effort(&target, &group_providers);
        }
    }
    if active || state.active_provider_group.as_deref() == Some(provider.group.as_str()) {
        crate::claude_code::sync_after_switch(&app)?;
    }
    emit_providers_changed(&app)?;
    Ok(provider_summary(
        &provider,
        active || state.active_provider_group.as_deref() == Some(provider.group.as_str()),
        state.auto_switch_provider_id.as_deref() == Some(&provider.id),
    ))
}

#[tauri::command]
pub(crate) fn set_provider_model_control<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    controlled_by_codex: bool,
) -> Result<ProviderSummary, String> {
    let paths = resolve_paths(&app)?;
    let mut provider = read_provider(&paths, &id)?;
    provider.model_selection_controlled_by_codex = controlled_by_codex;
    provider = normalize_provider_profile(provider)?;
    write_local_provider(&paths, &provider, None)?;

    let state = read_state(&paths);
    let active = state.active_provider_id.as_deref() == Some(&provider.id);
    let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
    if active && write_codex {
        for target in crate::storage::resolve_enabled_paths(&app)? {
            write_active_provider_config(&target, &provider)?;
            refresh_codex_models_best_effort(&target, &provider);
        }
    } else if write_codex
        && state.active_provider_group.as_deref() == Some(provider.group.as_str())
    {
        let group_providers = provider_group_profiles(&paths, &provider.group)?;
        for target in crate::storage::resolve_enabled_paths(&app)? {
            write_provider_group_local_proxy_config(
                &target,
                &provider.group,
                &group_providers,
            )?;
            refresh_codex_group_models_best_effort(&target, &group_providers);
        }
    }
    emit_providers_changed(&app)?;
    Ok(provider_summary(
        &provider,
        active || state.active_provider_group.as_deref() == Some(provider.group.as_str()),
        state.auto_switch_provider_id.as_deref() == Some(&provider.id),
    ))
}

#[tauri::command]
pub(crate) fn set_provider_auto_switch_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let provider = read_provider(&paths, &id)?;
    if provider.kind != ProviderKind::Custom {
        return Err("Automatic fallback is only available for third-party Providers".to_string());
    }

    let mut state = try_read_state(&paths)?;
    let next_provider_id = if enabled { Some(id.clone()) } else { None };
    if enabled || state.auto_switch_provider_id.as_deref() == Some(&id) {
        state.auto_switch_provider_id = next_provider_id;
        write_state(&paths, &state)?;
        emit_providers_changed(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn disable_provider<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || disable_provider_blocking(app))
        .await
        .map_err(|error| format!("Provider disable task failed: {error}"))?
}

pub(crate) fn disable_provider_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let original_state = try_read_state(&paths)?;
    let mut state = original_state.clone();
    state.active_provider_id = None;
    state.active_provider_group = None;
    let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
    if !write_codex {
        write_state(&paths, &state)?;
    } else if crate::local_proxy::is_running() {
        let targets = crate::storage::resolve_enabled_paths(&app)?;
        for target in &targets {
            backup_codex_config_if_needed(
                target,
                original_state.active_provider_id.is_none()
                    && original_state.active_provider_group.is_none(),
            )?;
        }
        write_state(&paths, &state)?;
        for target in &targets {
            if let Err(error) = write_official_local_proxy_config(target) {
                let _ = write_state(&paths, &original_state);
                return Err(error);
            }
        }
    } else {
        for target in crate::storage::resolve_enabled_paths(&app)? {
            restore_official_config(&target)?;
        }
        write_state(&paths, &state)?;
    }
    if write_codex {
        for target in crate::storage::resolve_enabled_paths(&app)? {
            refresh_codex_models_for_current_target(&target);
        }
    }
    crate::claude_code::sync_after_switch(&app)?;
    emit_providers_changed(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    validate_provider_id(&id)?;
    let original_state = try_read_state(&paths)?;
    if let Ok(provider) = read_provider(&paths, &id) {
        if original_state.active_provider_group.as_deref() == Some(provider.group.as_str()) {
            return Err(
                "Stop the active Provider group before deleting one of its APIs".to_string(),
            );
        }
    }
    let was_active = original_state.active_provider_id.as_deref() == Some(&id);
    let was_auto_switch_provider = original_state.auto_switch_provider_id.as_deref() == Some(&id);
    if was_active || was_auto_switch_provider {
        let mut state = original_state.clone();
        if was_auto_switch_provider {
            state.auto_switch_provider_id = None;
        }
        if was_active {
            state.active_provider_id = None;
            let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
            if !write_codex {
                write_state(&paths, &state)?;
            } else if crate::local_proxy::is_running() {
                write_state(&paths, &state)?;
                for target in crate::storage::resolve_enabled_paths(&app)? {
                    if let Err(error) = write_official_local_proxy_config(&target) {
                        let _ = write_state(&paths, &original_state);
                        return Err(error);
                    }
                }
            } else {
                for target in crate::storage::resolve_enabled_paths(&app)? {
                    restore_official_config(&target)?;
                }
                write_state(&paths, &state)?;
            }
        } else {
            write_state(&paths, &state)?;
        }
    }
    let mut image_state = try_read_state(&paths)?;
    let cleared_image_input = target_uses_provider(image_state.image_input_target.as_ref(), &id);
    let cleared_image_output = target_uses_provider(image_state.image_output_target.as_ref(), &id);
    if cleared_image_input {
        image_state.image_input_target = None;
    }
    if cleared_image_output {
        image_state.image_output_target = None;
    }
    if cleared_image_input || cleared_image_output {
        write_state(&paths, &image_state)?;
    }
    let path = provider_path(&paths, &id);
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("Failed to delete provider: {error}"))?;
    }
    crate::aggregate_api::remove_provider_membership(&paths, &id)?;
    if let Some(active_id) = original_state
        .active_provider_id
        .as_deref()
        .filter(|active_id| crate::aggregate_api::is_active_id(active_id))
    {
        let config = crate::aggregate_api::read_active_config(&paths, active_id)?;
        if config.enabled {
            for target in crate::storage::resolve_enabled_paths(&app)? {
                apply_local_proxy_config_for_paths(&target)?;
                refresh_codex_models_for_current_target(&target);
            }
        } else {
            disable_provider_blocking(app.clone())?;
        }
    }
    let versions_path = provider_field_modified_at_path(&paths, &id);
    if versions_path.exists() {
        fs::remove_file(&versions_path)
            .map_err(|error| format!("Failed to delete provider field versions: {error}"))?;
    }
    if was_active {
        if crate::claude_code::should_write_codex_for_app(&app)? {
            refresh_codex_models_for_current_target(&paths);
        }
        crate::claude_code::sync_after_switch(&app)?;
    }
    emit_providers_changed(&app)?;
    Ok(())
}
