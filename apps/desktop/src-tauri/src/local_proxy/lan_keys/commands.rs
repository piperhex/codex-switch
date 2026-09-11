use super::*;

#[tauri::command]
pub(crate) async fn list_local_proxy_lan_api_keys<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<LocalProxyLanApiKeySummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = storage::resolve_paths(&app).map_err(|_| LanKeyError::Unavailable)?;
        list_summaries(&paths)
    })
    .await
    .map_err(|_| LanKeyError::Unavailable.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn save_local_proxy_lan_api_key<R: Runtime>(
    app: tauri::AppHandle<R>,
    key: SaveLocalProxyLanApiKey,
) -> Result<Vec<LocalProxyLanApiKeySummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths =
            storage::resolve_paths(&app).map_err(|_| LanKeyError::Unavailable.to_string())?;
        let acknowledge_id = key.id.clone().filter(|_| key.acknowledge_usage);
        mutate_keys(&paths, |state| save_key(state, key)).map_err(|error| error.to_string())?;
        if let Some(id) = acknowledge_id {
            ledger::acknowledge_usage(&paths, &id).map_err(|error| error.to_string())?;
        }
        notify_changed(&app);
        list_summaries(&paths).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| LanKeyError::Unavailable.to_string())?
}

#[tauri::command]
pub(crate) async fn delete_local_proxy_lan_api_key<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<Vec<LocalProxyLanApiKeySummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths =
            storage::resolve_paths(&app).map_err(|_| LanKeyError::Unavailable.to_string())?;
        mutate_keys(&paths, |state| delete_key(state, &id)).map_err(|error| error.to_string())?;
        notify_changed(&app);
        list_summaries(&paths).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| LanKeyError::Unavailable.to_string())?
}

fn delete_key(state: &mut ManagerStateFile, id: &str) -> Result<(), LanKeyError> {
    migrate_legacy_key(state);
    let count = state.local_proxy_lan_api_keys.len();
    state.local_proxy_lan_api_keys.retain(|key| key.id != id);
    if count == state.local_proxy_lan_api_keys.len() {
        return Err(LanKeyError::NotFound);
    }
    validate_active_key(state)
}

fn notify_changed<R: Runtime>(app: &tauri::AppHandle<R>) {
    for event in ["local-proxy-lan-keys-updated", "providers-changed"] {
        if let Err(error) = app.emit(event, ()) {
            eprintln!("Failed to notify LAN key settings update: {error}");
        }
    }
}
