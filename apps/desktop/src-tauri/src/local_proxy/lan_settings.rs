/// Apply listener and API key changes without blocking the window thread.
#[tauri::command]
pub(crate) async fn set_local_proxy_listen_on_all_interfaces<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
    api_key: Option<String>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_local_proxy_listen_on_all_interfaces_blocking(app, enabled, api_key)
    })
    .await
    .map_err(|_| "暂时无法更新局域网监听设置，请稍后重试。".to_string())?
}

/// Read and copy the selected key on a worker thread, without returning its secret to the UI.
#[tauri::command]
pub(crate) async fn copy_local_proxy_lan_api_key<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || copy_local_proxy_lan_api_key_blocking(app, id))
        .await
        .map_err(|_| "暂时无法复制 API Key，请稍后重试。".to_string())?
}

fn set_local_proxy_listen_on_all_interfaces_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
    api_key: Option<String>,
) -> Result<LocalProxyStatus, String> {
    if !is_running() {
        return Err("请先开启代理模式。".to_string());
    }
    let paths = resolve_paths(&app)?;
    let previous_enabled = update_state(&paths, |state| {
        let previous_enabled = lan_listening_enabled(state);
        state.local_proxy_listen_on_all_interfaces = enabled;
        apply_legacy_lan_key(state, api_key)?;
        if enabled && configured_lan_api_key(state).is_none() {
            return Err("请先添加并启用至少一个 API Key。".to_string());
        }
        Ok(previous_enabled)
    })?;
    if previous_enabled != enabled {
        restart_lan_listener(&app, &paths, previous_enabled)?;
    }
    app.emit("providers-changed", ())
        .map_err(|_| "暂时无法刷新代理状态，请稍后重试。".to_string())?;
    Ok(status(&app))
}

fn apply_legacy_lan_key(
    state: &mut ManagerStateFile,
    api_key: Option<String>,
) -> Result<(), String> {
    lan_keys::migrate_legacy_key(state);
    let Some(secret) = api_key.filter(|key| !key.trim().is_empty()) else {
        return Ok(());
    };
    let existing = state.local_proxy_lan_api_keys.first();
    let key = crate::models::SaveLocalProxyLanApiKey {
        id: existing.map(|key| key.id.clone()),
        name: existing
            .map(|key| key.name.clone())
            .unwrap_or_else(|| "默认 API Key".to_string()),
        api_key: Some(secret),
        enabled: true,
        quota_usd: existing.and_then(|key| key.quota_usd),
        acknowledge_usage: false,
    };
    lan_keys::save_key(state, key).map_err(|error| error.to_string())
}

fn restart_lan_listener<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    previous_enabled: bool,
) -> Result<(), String> {
    stop_server();
    if let Err(error) = start_server(app.clone()) {
        log_proxy_error!("Failed to restart LAN proxy listener: {error}");
        update_state(paths, |state| {
            state.local_proxy_listen_on_all_interfaces = previous_enabled;
            Ok(())
        })?;
        if let Err(error) = start_server(app.clone()) {
            log_proxy_error!("Failed to restore previous proxy listener: {error}");
        }
        return Err("暂时无法切换监听地址，请稍后重试。".to_string());
    }
    Ok(())
}

fn copy_local_proxy_lan_api_key_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: Option<String>,
) -> Result<(), String> {
    let paths = resolve_paths(&app).map_err(|_| "暂时无法读取 API Key。".to_string())?;
    let state = try_read_state(&paths).map_err(|_| "暂时无法读取 API Key。".to_string())?;
    let keys = lan_keys::configured_keys(&state);
    let key = keys
        .iter()
        .find(|key| id.as_deref().map(|id| key.id == id).unwrap_or(key.enabled))
        .ok_or_else(|| "这个 API Key 已不存在，请刷新后重试。".to_string())?;
    app.clipboard()
        .write_text(&key.api_key)
        .map_err(|_| "暂时无法复制 API Key，请稍后重试。".to_string())
}
