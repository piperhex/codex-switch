use super::{install, state, RemoteError, Result, INSTALL_CHANGES};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginStatus {
    installed: bool,
    enabled: bool,
    needs_repair: bool,
    version: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PluginAction {
    Install,
    Enable,
    Disable,
    Remove,
}

fn status(root: &std::path::Path, home: &std::path::Path) -> Result<PluginStatus> {
    let record = state::read(root, &state::home_id(home))?;
    let needs_repair = match &record {
        Some(record) => !install::configured(home, record.enabled)?,
        None => false,
    };
    Ok(PluginStatus {
        installed: record.is_some(),
        enabled: record.is_some_and(|record| record.enabled) && !needs_repair,
        needs_repair,
        version: super::VERSION,
    })
}

#[tauri::command]
pub(crate) async fn remote_command_status(
    app: tauri::AppHandle,
    home_id: String,
) -> std::result::Result<PluginStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = INSTALL_CHANGES.lock().map_err(|_| RemoteError::Storage)?;
        let home = crate::codex_home::resolve_selected(&app, Some(&home_id))
            .map_err(|_| RemoteError::Storage)?;
        status(&super::root()?, &home)
    })
    .await
    .map_err(|_| RemoteError::Storage.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn remote_command_action(
    app: tauri::AppHandle,
    home_id: String,
    action: PluginAction,
) -> std::result::Result<PluginStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = INSTALL_CHANGES.lock().map_err(|_| RemoteError::Storage)?;
        let home = crate::codex_home::resolve_selected(&app, Some(&home_id))
            .map_err(|_| RemoteError::Storage)?;
        let root = super::root()?;
        match action {
            PluginAction::Install | PluginAction::Enable => install::install(&root, &home)?,
            PluginAction::Disable => install::disable(&root, &home, false)?,
            PluginAction::Remove => install::disable(&root, &home, true)?,
        }
        status(&root, &home)
    })
    .await
    .map_err(|_| RemoteError::Storage.to_string())?
    .map_err(|error| error.to_string())
}
