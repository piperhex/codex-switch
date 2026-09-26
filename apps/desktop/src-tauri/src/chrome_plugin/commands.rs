use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use tauri_plugin_clipboard_manager::ClipboardExt;

use super::{
    config, discovery, extension, install, protocol::*, registration, BrowserError, Result,
    INSTALL_CHANGES,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChromePluginStatus {
    installed: bool,
    enabled: bool,
    needs_repair: bool,
    connected_browsers: usize,
    active_browsers: usize,
    version: &'static str,
    supported: bool,
    extension_directory: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ChromePluginAction {
    Install,
    EnsureInstalled,
    Enable,
    Disable,
    Remove,
    OpenStore,
    OpenFolder,
    OpenExtensions,
}

#[tauri::command]
pub(crate) async fn chrome_plugin_status(
    app: tauri::AppHandle,
    home_id: String,
) -> std::result::Result<ChromePluginStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crate::codex_home::resolve_selected(&app, Some(&home_id))
            .map_err(|_| BrowserError::Storage)?;
        status(&super::bridge_root()?, &home)
    })
    .await
    .map_err(|_| BrowserError::Storage.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn chrome_plugin_action(
    app: tauri::AppHandle,
    home_id: String,
    action: ChromePluginAction,
) -> std::result::Result<ChromePluginStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = INSTALL_CHANGES.lock().map_err(|_| BrowserError::Storage)?;
        let home = crate::codex_home::resolve_selected(&app, Some(&home_id))
            .map_err(|_| BrowserError::Storage)?;
        let root = super::bridge_root()?;
        let executable = std::env::current_exe().map_err(|_| BrowserError::Storage)?;
        match action {
            ChromePluginAction::Install => install::install(&root, &home, &executable)?,
            ChromePluginAction::EnsureInstalled => {
                install::ensure_installed(&root, &home, &executable)?;
            }
            ChromePluginAction::Enable => install::install(&root, &home, &executable)?,
            ChromePluginAction::Disable => install::disable(&root, &home, &executable)?,
            ChromePluginAction::Remove => install::remove(&root, &home)?,
            ChromePluginAction::OpenStore => registration::open_store()?,
            ChromePluginAction::OpenExtensions => {
                app.clipboard()
                    .write_text("chrome://extensions/")
                    .map_err(|_| BrowserError::Clipboard)?;
                registration::open_extensions()?;
            }
            ChromePluginAction::OpenFolder => {
                let path = extension::directory(&root);
                if !path.is_dir() {
                    return Err(BrowserError::Disabled);
                }
                tauri_plugin_opener::open_path(path, None::<&str>)
                    .map_err(|_| BrowserError::Storage)?;
            }
        }
        drop(guard);
        status(&root, &home)
    })
    .await
    .map_err(|_| BrowserError::Storage.to_string())?
    .map_err(|error| error.to_string())
}

fn status(root: &Path, home: &Path) -> Result<ChromePluginStatus> {
    let guard = INSTALL_CHANGES.lock().map_err(|_| BrowserError::Storage)?;
    let id = config::client_id(home);
    let record = match config::load(root, &id) {
        Ok(record) => Some(record),
        Err(BrowserError::Disabled) => None,
        Err(error) => return Err(error),
    };
    let mut connected_browsers = 0;
    let mut active_browsers = 0;
    let needs_repair = match record.as_ref() {
        Some(record) => {
            !install::configured(home, record.enabled)? || !extension::is_current(root)?
        }
        None => false,
    };
    let enabled = record.as_ref().is_some_and(|record| record.enabled) && !needs_repair;
    drop(guard);
    if let Some(record) = record.as_ref().filter(|_| enabled) {
        let request = BridgeRequest {
            client_id: id,
            token: record.token.clone(),
            request: BrowserRequest {
                operation: Operation::Status,
                args: json!({}),
            },
        };
        for (_, result) in discovery::connected(root, &request) {
            connected_browsers += 1;
            if result["paused"] != true {
                active_browsers += 1;
            }
        }
    }
    Ok(ChromePluginStatus {
        installed: record.is_some(),
        enabled,
        needs_repair,
        connected_browsers,
        active_browsers,
        version: super::PLUGIN_VERSION,
        supported: registration::supported(),
        extension_directory: extension::directory(root).to_string_lossy().into_owned(),
    })
}
