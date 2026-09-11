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
    .map_err(|_| "Unable to update local proxy settings".to_string())?
}

/// Read and copy the configured key on a worker thread.
#[tauri::command]
pub(crate) async fn copy_local_proxy_lan_api_key<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || copy_local_proxy_lan_api_key_blocking(app))
        .await
        .map_err(|_| "Unable to copy the local proxy API key".to_string())?
}

fn set_local_proxy_listen_on_all_interfaces_blocking<R: Runtime>(
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
        if let Err(restore_error) = write_state(&paths, &state) {
            log_proxy_error!("Failed to restore LAN listening setting: {restore_error}");
        }
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

fn copy_local_proxy_lan_api_key_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let state = try_read_state(&resolve_paths(&app)?)?;
    let api_key = configured_lan_api_key(&state)
        .ok_or_else(|| "Local network API key is not configured".to_string())?;
    app.clipboard()
        .write_text(api_key)
        .map_err(|error| format!("Failed to copy local network API key: {error}"))
}
