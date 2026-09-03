#[tauri::command]
pub(crate) fn set_auto_switch_on_quota_exhaustion<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    if enabled && !is_running() {
        return Err(
            "Start the local proxy before enabling automatic account switching".to_string(),
        );
    }
    let paths = resolve_paths(&app)?;
    let mut state = try_read_state(&paths)?;
    state.auto_switch_on_quota_exhaustion = enabled;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) async fn set_concurrent_account_routing_enabled<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    enabled: bool,
    account_group: Option<String>,
) -> Result<LocalProxyStatus, String> {
    let status_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        set_concurrent_account_routing_enabled_blocking(&app, enabled, account_group)
    })
    .await
    .map_err(|error| format!("Concurrent routing update task failed: {error}"))??;
    Ok(status(&status_app))
}

fn set_concurrent_account_routing_enabled_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
    account_group: Option<String>,
) -> Result<(), String> {
    if enabled && !is_running() {
        return Err("Start the local proxy before enabling concurrent account routing".to_string());
    }
    let paths = resolve_paths(app)?;
    let account_group = account_group
        .map(|group| group.trim().to_string())
        .filter(|group| !group.is_empty());
    if account_group
        .as_ref()
        .is_some_and(|group| group.chars().count() > 80 || group.chars().any(char::is_control))
    {
        return Err("Account group is invalid".to_string());
    }
    let mut snapshot = try_read_state(&paths)?;
    snapshot.concurrent_account_group.clone_from(&account_group);
    let enabled_account_ids = enabled
        .then(|| enabled_concurrent_account_ids(&paths, &snapshot))
        .transpose()?
        .unwrap_or_default();
    let (original_state, applied_state, switched_from_provider) = update_state(&paths, |state| {
        let original_state = state.clone();
        state.concurrent_account_group.clone_from(&account_group);
        let switched_from_provider = apply_concurrent_routing_setting(
            state,
            enabled,
            &enabled_account_ids,
        )?;
        Ok((original_state, state.clone(), switched_from_provider))
    })?;
    let write_codex = crate::claude_code::should_write_codex_for_app(app)?;
    if switched_from_provider && write_codex {
        if let Err(error) = providers::write_official_local_proxy_config(&paths) {
            rollback_concurrent_routing_setting(&paths, &applied_state, &original_state);
            return Err(error);
        }
    }
    if enabled && write_codex {
        if let Err(error) = providers::sync_local_proxy_openai_auth(&paths) {
            rollback_concurrent_routing_setting(&paths, &applied_state, &original_state);
            return Err(error);
        }
    }
    if let Ok(mut router) = concurrent_account_router().lock() {
        router.clear();
    }
    if let Ok(mut sessions) = proxy_sessions().lock() {
        sessions
            .values_mut()
            .for_each(|session| session.concurrent_routed = false);
    }
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_custom_auto_switch_priority_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    let paths = resolve_paths(&app)?;
    let mut state = try_read_state(&paths)?;
    if enabled && (!is_running() || !state.auto_switch_on_quota_exhaustion) {
        return Err(
            "Enable automatic account switching before enabling custom priorities".to_string(),
        );
    }
    state.custom_auto_switch_priority_enabled = enabled;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn set_custom_auto_switch_threshold_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    if enabled
        && (!is_running()
            || !try_read_state(&resolve_paths(&app)?)?.auto_switch_on_quota_exhaustion)
    {
        return Err("Enable automatic account switching before enabling custom thresholds".to_string());
    }
    let paths = resolve_paths(&app)?;
    let mut state = try_read_state(&paths)?;
    state.custom_auto_switch_threshold_enabled = enabled;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

fn apply_concurrent_routing_setting(
    state: &mut ManagerStateFile,
    enabled: bool,
    enabled_account_ids: &[String],
) -> Result<bool, String> {
    let mut switched_from_provider = false;
    if enabled {
        let first_account_id = enabled_account_ids
            .iter()
            .find(|id| !state.disabled_account_ids.contains(id))
            .ok_or_else(|| {
                "Enable at least one official account before enabling concurrent routing"
                    .to_string()
            })?;
        switched_from_provider =
            state.active_provider_id.take().is_some() || state.active_provider_group.take().is_some();
        if state
            .active_account_id
            .as_ref()
            .is_none_or(|account_id| !enabled_account_ids.contains(account_id))
        {
            state.active_account_id = Some(first_account_id.clone());
        }
    }
    change_concurrent_account_routing(state, enabled, "user setting");
    Ok(switched_from_provider)
}

fn rollback_concurrent_routing_setting(
    paths: &Paths,
    applied: &ManagerStateFile,
    original: &ManagerStateFile,
) {
    let result = update_state(paths, |state| {
        if state.active_account_id != applied.active_account_id
            || state.active_provider_id != applied.active_provider_id
            || state.active_provider_group != applied.active_provider_group
            || state.concurrent_account_routing_enabled
                != applied.concurrent_account_routing_enabled
            || state.concurrent_account_group != applied.concurrent_account_group
        {
            return Ok(());
        }
        state.active_account_id = original.active_account_id.clone();
        state.active_provider_id = original.active_provider_id.clone();
        state.active_provider_group = original.active_provider_group.clone();
        state.concurrent_account_group = original.concurrent_account_group.clone();
        change_concurrent_account_routing(
            state,
            original.concurrent_account_routing_enabled,
            "concurrent routing update rollback",
        );
        Ok(())
    });
    if let Err(error) = result {
        eprintln!("failed to restore proxy state: {error}");
    }
}

#[tauri::command]
pub(crate) async fn set_global_auto_switch_threshold<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    threshold: f64,
) -> Result<LocalProxyStatus, String> {
    if !threshold.is_finite() || !(0.0..=100.0).contains(&threshold) {
        return Err("Global auto-switch threshold must be between 0 and 100".to_string());
    }
    let task_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = resolve_paths(&task_app)?;
    let mut state = try_read_state(&paths)?;
        state.global_auto_switch_threshold = threshold;
        write_state(&paths, &state)
    })
    .await
    .map_err(|error| format!("Global threshold task failed: {error}"))??;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn set_auto_disable_unreachable_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    let paths = resolve_paths(&app)?;
    let mut state = try_read_state(&paths)?;
    if enabled && (!is_running() || !state.auto_switch_on_quota_exhaustion) {
        return Err(
            "Enable automatic account switching before enabling automatic disabling by HTTP status"
                .to_string(),
        );
    }
    state.auto_disable_unreachable_accounts = enabled;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn set_image_generation_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    account_id: Option<String>,
) -> Result<LocalProxyStatus, String> {
    if !is_running() {
        return Err(
            "Start the local proxy before selecting an image generation account".to_string(),
        );
    }

    let paths = resolve_paths(&app)?;
    let account_id = account_id.filter(|value| !value.trim().is_empty());
    if let Some(account_id) = account_id.as_deref() {
        let auth = crate::commands::load_validated_managed_auth(&paths, account_id)?;
        if is_agent_identity_auth(&auth) || token_string(&auth, "access_token").is_none() {
            return Err("Image generation account must use an OAuth token".to_string());
        }
    }

    let mut state = try_read_state(&paths)?;
    state.image_generation_account_id = account_id.clone();
    state.image_output_target =
        account_id.map(|account_id| ImageModelTarget::Official { account_id });
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) async fn set_image_model_target<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    route_kind: ImageRouteKind,
    target: Option<ImageModelTarget>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_image_model_target_blocking(app, route_kind, target)
    })
    .await
    .map_err(|error| format!("Image model update task failed: {error}"))?
}

fn set_image_model_target_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    route_kind: ImageRouteKind,
    target: Option<ImageModelTarget>,
) -> Result<LocalProxyStatus, String> {
    if !is_running() {
        return Err("Start the local proxy before selecting an image model".to_string());
    }
    let paths = resolve_paths(&app)?;
    validate_image_model_target(&paths, route_kind, target.as_ref())?;
    let original_state = try_read_state(&paths)?;
    let mut state = original_state.clone();
    match route_kind {
        ImageRouteKind::Input => state.image_input_target = target,
        ImageRouteKind::Output => {
            state.image_generation_account_id = official_target_account_id(target.as_ref());
            state.image_output_target = target;
        }
    }
    write_state(&paths, &state)?;
    if route_kind == ImageRouteKind::Input {
        if let Err(error) = providers::apply_local_proxy_config_for_paths(&paths) {
            return match write_state(&paths, &original_state) {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error}; failed to restore the previous image model setting: {rollback_error}"
                )),
            };
        }
        providers::refresh_codex_models_for_current_target_blocking(&paths);
    }
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

fn validate_image_model_target(
    paths: &Paths,
    route_kind: ImageRouteKind,
    target: Option<&ImageModelTarget>,
) -> Result<(), String> {
    let Some(target) = target else {
        return Ok(());
    };
    match target {
        ImageModelTarget::Official { account_id } => {
            let auth = crate::commands::load_validated_managed_auth(paths, account_id.trim())?;
            if route_kind == ImageRouteKind::Output
                && (is_agent_identity_auth(&auth) || token_string(&auth, "access_token").is_none())
            {
                return Err("Image output account must use an OAuth token".to_string());
            }
            Ok(())
        }
        ImageModelTarget::Provider { provider_id, model } => {
            let provider = providers::read_provider(paths, provider_id.trim())?;
            let model = model.trim();
            if !provider.models.iter().any(|candidate| candidate == model) {
                return Err(
                    "The selected image model is not available for this Provider".to_string(),
                );
            }
            if route_kind == ImageRouteKind::Input
                && !provider
                    .image_input_models
                    .iter()
                    .any(|candidate| candidate == model)
            {
                return Err("The selected Provider model does not support image input".to_string());
            }
            Ok(())
        }
    }
}

fn official_target_account_id(target: Option<&ImageModelTarget>) -> Option<String> {
    match target {
        Some(ImageModelTarget::Official { account_id }) => Some(account_id.trim().to_string()),
        _ => None,
    }
}

#[tauri::command]
pub(crate) async fn set_local_proxy_openai_auth_account<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    account_id: Option<String>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_local_proxy_openai_auth_account_blocking(app, account_id)
    })
    .await
    .map_err(|error| format!("OpenAI login update task failed: {error}"))?
}

pub(crate) fn set_local_proxy_openai_auth_account_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    account_id: Option<String>,
) -> Result<LocalProxyStatus, String> {
    if !is_running() {
        return Err("Start the local proxy before selecting an OpenAI login account".to_string());
    }

    let _switch_guard = crate::commands::account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    let paths = resolve_paths(&app)?;
    let account_id = account_id.filter(|value| !value.trim().is_empty());
    providers::validate_local_proxy_openai_auth_account(&paths, account_id.as_deref())?;

    let mut state = try_read_state(&paths)?;
    if state.local_proxy_openai_auth_account_id == account_id {
        if update_proxy_service_tier_for_openai_auth(account_id.as_deref()) {
            app.emit("providers-changed", ())
                .map_err(|error| error.to_string())?;
            providers::refresh_codex_models_for_current_target(&paths);
        }
        return Ok(status(&app));
    }
    if let Some(previous_account_id) = state.local_proxy_openai_auth_account_id.as_deref() {
        providers::preserve_refreshed_auth(&paths, previous_account_id);
    }
    state.local_proxy_openai_auth_account_id = account_id;
    write_state(&paths, &state)?;
    update_proxy_service_tier_for_openai_auth(state.local_proxy_openai_auth_account_id.as_deref());
    let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
    if write_codex {
        providers::apply_local_proxy_config_for_state(&app)?;
    }
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    let proxy_status = status(&app);

    if write_codex {
        crate::commands::restart_chatgpt_unlocked(&app).map_err(|error| {
            format!(
                "OpenAI login state was updated, but ChatGPT/Codex could not be restarted ({error}). Please start ChatGPT or Codex manually."
            )
        })?;
    }
    Ok(proxy_status)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OfficialCredentialPurpose {
    Default,
    ImageInput,
    ImageGeneration,
}

enum OfficialRequestAuthentication {
    OAuth {
        access_token: String,
        chatgpt_account_id: Option<String>,
    },
    AgentIdentity {
        active_account_id: String,
        auth: Value,
        request_authentication: agent_identity::AgentIdentityRequestAuthentication,
    },
}

struct OfficialProxyCredentials {
    authentication: OfficialRequestAuthentication,
    token_usage_account: TokenUsageAccount,
}

#[tauri::command]
pub(crate) fn set_local_proxy_listen_on_all_interfaces<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
    api_key: Option<String>,
) -> Result<LocalProxyStatus, String> {
    if !is_running() {
        return Err("Start the local proxy before changing its listening address".to_string());
    }

    let paths = resolve_paths(&app)?;
    let mut state = try_read_state(&paths)?;
    let previous_enabled = lan_listening_enabled(&state);
    if let Some(api_key) = api_key.map(|value| value.trim().to_string()) {
        if !api_key.is_empty() {
            state.local_proxy_lan_api_key = Some(api_key);
        }
    }
    if enabled && configured_lan_api_key(&state).is_none() {
        return Err("API key is required before listening on the local network".to_string());
    }
    state.local_proxy_listen_on_all_interfaces = enabled;
    let next_enabled = lan_listening_enabled(&state);
    write_state(&paths, &state)?;
    if previous_enabled == next_enabled {
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        return Ok(status(&app));
    }

    stop_server();
    if let Err(error) = start_server(app.clone()) {
        state.local_proxy_listen_on_all_interfaces = previous_enabled;
        let _ = write_state(&paths, &state);
        let restore_error = start_server(app.clone()).err();
        return Err(match restore_error {
            Some(restore_error) => format!(
                "Failed to restart local proxy with the requested listening address: {error}. Failed to restore the previous listener: {restore_error}"
            ),
            None => format!(
                "Failed to restart local proxy with the requested listening address: {error}. The previous listener was restored."
            ),
        });
    }

    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn copy_local_proxy_lan_api_key<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let state = try_read_state(&resolve_paths(&app)?)?;
    let api_key = configured_lan_api_key(&state)
        .ok_or_else(|| "Local network API key is not configured".to_string())?;
    app.clipboard()
        .write_text(api_key)
        .map_err(|error| format!("Failed to copy local network API key: {error}"))
}
