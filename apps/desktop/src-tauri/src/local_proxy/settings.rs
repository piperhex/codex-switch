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
    let mut state = read_state(&paths);
    state.auto_switch_on_quota_exhaustion = enabled;
    write_state(&paths, &state)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn set_concurrent_account_routing_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    if enabled && !is_running() {
        return Err("Start the local proxy before enabling concurrent account routing".to_string());
    }
    let paths = resolve_paths(&app)?;
    let original_state = read_state(&paths);
    let mut state = original_state.clone();
    let mut switched_from_provider = false;
    if enabled {
        let enabled_account_ids = enabled_concurrent_account_ids(&paths, &state)?;
        let first_account_id = enabled_account_ids.first().ok_or_else(|| {
            "Enable at least one official account before enabling concurrent routing".to_string()
        })?;
        if state.active_provider_id.take().is_some() || state.active_provider_group.take().is_some()
        {
            switched_from_provider = true;
        }
        if state
            .active_account_id
            .as_ref()
            .is_none_or(|account_id| !enabled_account_ids.contains(account_id))
        {
            state.active_account_id = Some(first_account_id.clone());
        }
    }
    state.concurrent_account_routing_enabled = enabled;
    write_state(&paths, &state)?;
    if switched_from_provider {
        if let Err(error) = providers::write_official_local_proxy_config(&paths) {
            let _ = write_state(&paths, &original_state);
            return Err(error);
        }
    }
    if enabled {
        if let Err(error) = providers::sync_local_proxy_openai_auth(&paths) {
            let _ = write_state(&paths, &original_state);
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
    Ok(status(&app))
}

#[tauri::command]
pub(crate) fn set_custom_auto_switch_priority_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    let paths = resolve_paths(&app)?;
    let mut state = read_state(&paths);
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
pub(crate) fn set_auto_disable_unreachable_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    let paths = resolve_paths(&app)?;
    let mut state = read_state(&paths);
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

    let mut state = read_state(&paths);
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
    let original_state = read_state(&paths);
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

    let mut state = read_state(&paths);
    if state.local_proxy_openai_auth_account_id == account_id {
        return Ok(status(&app));
    }
    state.local_proxy_openai_auth_account_id = account_id;
    write_state(&paths, &state)?;
    providers::apply_local_proxy_config_for_state(&app)?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    let proxy_status = status(&app);

    crate::commands::restart_chatgpt_unlocked(&app).map_err(|error| {
        format!(
            "OpenAI login state was updated, but ChatGPT/Codex could not be restarted ({error}). Please start ChatGPT or Codex manually."
        )
    })?;
    Ok(proxy_status)
}

#[derive(Clone, Copy)]
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
    let mut state = read_state(&paths);
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
    let state = read_state(&resolve_paths(&app)?);
    let api_key = configured_lan_api_key(&state)
        .ok_or_else(|| "Local network API key is not configured".to_string())?;
    app.clipboard()
        .write_text(api_key)
        .map_err(|error| format!("Failed to copy local network API key: {error}"))
}
