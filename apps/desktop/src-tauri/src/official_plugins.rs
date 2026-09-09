use crate::codex_gui::plugin_client::{PluginClient, PluginError, Result};
use serde::Serialize;
use serde_json::json;

mod catalog;
mod icons;
pub(crate) use icons::local_icon;

// Separate CLI processes must not race when updating the same home configuration.
static PLUGIN_CHANGES: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfficialPluginItem {
    id: String,
    name: String,
    title: String,
    description: String,
    version: String,
    category: String,
    developer: String,
    brand_color: Option<String>,
    icon_url: Option<String>,
    installed: bool,
    enabled: bool,
}

#[tauri::command]
pub(crate) async fn list_official_plugins(
    app: tauri::AppHandle,
    home_id: String,
) -> std::result::Result<Vec<OfficialPluginItem>, String> {
    async {
        let mut client = PluginClient::start(app, home_id).await?;
        let catalog = catalog::load(&mut client).await?;
        tauri::async_runtime::spawn_blocking(move || catalog.items())
            .await
            .map_err(|_| PluginError::Catalog)
    }
    .await
    .map_err(|error: PluginError| error.to_string())
}

#[tauri::command]
pub(crate) async fn install_official_plugin(
    app: tauri::AppHandle,
    plugin_id: String,
    home_id: String,
) -> std::result::Result<(), String> {
    change(app, home_id, plugin_id, Action::Install)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn remove_official_plugin(
    app: tauri::AppHandle,
    plugin_id: String,
    home_id: String,
) -> std::result::Result<(), String> {
    change(app, home_id, plugin_id, Action::Remove)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn set_official_plugin_enabled(
    app: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
    home_id: String,
) -> std::result::Result<(), String> {
    change(app, home_id, plugin_id, Action::SetEnabled(enabled))
        .await
        .map_err(|error| error.to_string())
}

enum Action {
    Install,
    Remove,
    SetEnabled(bool),
}

async fn change(
    app: tauri::AppHandle,
    home_id: String,
    plugin_id: String,
    action: Action,
) -> Result<()> {
    let _guard = PLUGIN_CHANGES.lock().await;
    let mut client = PluginClient::start(app, home_id).await?;
    let catalog = catalog::load(&mut client).await?;
    let (marketplace, plugin) = catalog.find(&plugin_id)?;
    let (method, params) = match action {
        Action::Install => (
            "plugin/install",
            catalog::install_params(marketplace, plugin),
        ),
        Action::Remove if plugin.installed => ("plugin/uninstall", json!({"pluginId": plugin_id})),
        Action::SetEnabled(enabled) if plugin.installed => (
            "config/value/write",
            json!({
                "keyPath": format!("plugins.{}.enabled", json!(plugin_id)),
                "value": enabled, "mergeStrategy": "replace"
            }),
        ),
        _ => return Err(PluginError::Selection),
    };
    client.request(method, params).await?;
    Ok(())
}
