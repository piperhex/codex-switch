fn read_state_unlocked(paths: &Paths) -> Result<ManagerStateFile, String> {
    let bytes = match fs::read(&paths.state_file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(ManagerStateFile::default());
        }
        Err(error) => return Err(format!("Failed to read application state: {error}")),
    };
    let state = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Application state is invalid: {error}"))?;
    cache_state(paths, &state);
    Ok(state)
}

fn cache_state(paths: &Paths, state: &ManagerStateFile) {
    let cache = STATE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.insert(paths.state_file.clone(), state.clone());
    }
}

fn cached_state(paths: &Paths) -> Option<ManagerStateFile> {
    STATE_CACHE
        .get()
        .and_then(|cache| cache.lock().ok())
        .and_then(|cache| cache.get(&paths.state_file).cloned())
}

pub(crate) fn try_read_state(paths: &Paths) -> Result<ManagerStateFile, String> {
    let _guard = STATE_FILE_LOCK
        .lock()
        .map_err(|_| "Application state lock is poisoned".to_string())?;
    read_state_unlocked(paths)
}

pub(crate) fn read_state(paths: &Paths) -> ManagerStateFile {
    match try_read_state(paths) {
        Ok(state) => state,
        Err(error) => {
            eprintln!("failed to read application state; using the last valid snapshot: {error}");
            cached_state(paths).unwrap_or_default()
        }
    }
}

fn write_state_unlocked(paths: &Paths, requested: &ManagerStateFile) -> Result<(), String> {
    let state_file_exists = paths.state_file.exists();
    let current = read_state_unlocked(paths)?;
    let mut state = requested.clone();
    match state.concurrent_routing_change_reason.take() {
        Some(reason)
            if current.concurrent_account_routing_enabled != state.concurrent_account_routing_enabled
                || current.concurrent_account_group != state.concurrent_account_group =>
        {
            eprintln!(
                "concurrent account routing changed: old={}, new={}, reason={reason}",
                current.concurrent_account_routing_enabled,
                state.concurrent_account_routing_enabled
            );
        }
        Some(_) => {}
        None if state_file_exists => {
            state.concurrent_account_routing_enabled =
                current.concurrent_account_routing_enabled;
            state.concurrent_account_group = current.concurrent_account_group;
        }
        None => {}
    }
    let value = serde_json::to_value(&state).map_err(|error| error.to_string())?;
    write_json_atomic(&paths.state_file, &value)?;
    cache_state(paths, &state);
    Ok(())
}

pub(crate) fn write_state(paths: &Paths, state: &ManagerStateFile) -> Result<(), String> {
    let _guard = STATE_FILE_LOCK
        .lock()
        .map_err(|_| "Application state lock is poisoned".to_string())?;
    write_state_unlocked(paths, state)
}

pub(crate) fn update_state<T>(
    paths: &Paths,
    update: impl FnOnce(&mut ManagerStateFile) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = STATE_FILE_LOCK
        .lock()
        .map_err(|_| "Application state lock is poisoned".to_string())?;
    let mut state = read_state_unlocked(paths)?;
    let result = update(&mut state)?;
    write_state_unlocked(paths, &state)?;
    Ok(result)
}

pub(crate) fn change_concurrent_account_routing(
    state: &mut ManagerStateFile,
    enabled: bool,
    reason: &str,
) {
    state.concurrent_account_routing_enabled = enabled;
    state.concurrent_routing_change_reason = Some(reason.to_string());
}

pub(crate) fn app_settings_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("settings.json"))
}

pub(crate) fn read_app_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<AppSettings, String> {
    let path = app_settings_path(app)?;
    Ok(fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default())
}

pub(crate) fn write_app_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
) -> Result<(), String> {
    let path = app_settings_path(app)?;
    let value = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    write_json_atomic(&path, &value)
}

fn apply_app_settings_version_migration(settings: &mut AppSettings, current_version: &str) -> bool {
    if settings.last_started_version.as_deref() == Some(current_version) {
        return false;
    }
    if settings
        .cloud_base_url
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        settings.cloud_base_url = Some(DEFAULT_CLOUD_BASE_URL.to_string());
    }
    settings.last_started_version = Some(current_version.to_string());
    true
}

pub(crate) fn migrate_app_settings_for_version<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let mut settings = read_app_settings(app)?;
    let current_version = app.package_info().version.to_string();
    if apply_app_settings_version_migration(&mut settings, &current_version) {
        write_app_settings(app, &settings)?;
    }
    Ok(())
}

fn should_activate_import(
    state: &ManagerStateFile,
    activate: bool,
    current_auth_exists: bool,
) -> bool {
    activate
        || (!current_auth_exists
            && state.active_account_id.is_none()
            && state.active_provider_id.is_none()
            && state.active_provider_group.is_none())
}

fn should_sync_current_as_active(
    state: &ManagerStateFile,
    id: &str,
    agent_identity: bool,
    proxy_running: bool,
) -> bool {
    state.active_provider_id.is_none()
        && state.active_provider_group.is_none()
        && !state.local_proxy_enabled
        && !proxy_running
        && state.active_account_id.as_deref() != Some(id)
        && !agent_identity
}

pub(crate) fn import_value<R: Runtime>(
    app: &tauri::AppHandle<R>,
    mut auth: Value,
    activate: bool,
) -> Result<String, String> {
    canonicalize_chatgpt_auth(&mut auth)?;
    validate_auth(&auth)?;
    let paths = resolve_paths(app)?;
    let (_, _, _, id) = account_fields(&auth)?;
    let mut state = read_state(&paths);
    let should_activate = should_activate_import(&state, activate, paths.current_auth.exists());
    write_managed_auth_if_changed(&paths, &id, &auth)?;
    if should_activate {
        let proxy_running = crate::local_proxy::is_running();
        let can_activate = if proxy_running {
            true
        } else if crate::auth::is_agent_identity_auth(&auth) {
            false
        } else {
            crate::commands::sync_current_auth_if_client_stopped(&paths, &auth)?
        };
        if can_activate {
            state.active_account_id = Some(id.clone());
            write_state(&paths, &state)?;
            if crate::local_proxy::is_running() {
                crate::providers::apply_local_proxy_config_for_paths(&paths)?;
            }
        }
    }
    Ok(id)
}

pub(crate) fn sync_current_into_store<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    if !paths.current_auth.exists() {
        return Ok(());
    }
    let mut auth = read_json(&paths.current_auth)?;
    let repaired = canonicalize_chatgpt_auth(&mut auth)?;
    validate_auth(&auth)?;
    let id = import_value(app, auth.clone(), false)?;
    if repaired {
        crate::commands::sync_current_auth_if_client_stopped(&paths, &auth)?;
    }
    let mut state = read_state(&paths);
    // In proxy mode auth.json is either absent or belongs to the optional OpenAI
    // login-state account, which is independent from the upstream official account.
    // Do not let startup synchronization turn that credential into the active account.
    if should_sync_current_as_active(
        &state,
        &id,
        crate::auth::is_agent_identity_auth(&auth),
        crate::local_proxy::is_running(),
    ) {
        state.active_account_id = Some(id);
        write_state(&paths, &state)?;
    }
    Ok(())
}

pub(crate) fn load_usage(path: &Path) -> UsageSummary {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn save_usage(path: &Path, usage: &UsageSummary) -> Result<(), String> {
    let value = serde_json::to_value(usage).map_err(|error| error.to_string())?;
    write_json_atomic(path, &value)
}
