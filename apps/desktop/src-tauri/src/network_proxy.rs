use tauri::{AppHandle, Runtime};

use crate::{
    models::{AppSettings, NetworkProxySettings},
    storage::{read_app_settings, write_app_settings},
};

#[tauri::command]
pub(crate) async fn set_network_proxy<R: Runtime + 'static>(
    app: AppHandle<R>,
    settings: NetworkProxySettings,
) -> Result<AppSettings, String> {
    let normalized = crate::system_proxy::normalize_settings(settings)?;
    tauri::async_runtime::spawn_blocking(move || save_network_proxy(&app, normalized))
        .await
        .map_err(|error| format!("Network proxy settings task failed: {error}"))?
}

fn save_network_proxy<R: Runtime>(
    app: &AppHandle<R>,
    network_proxy: NetworkProxySettings,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(app)?;
    settings.network_proxy = network_proxy;
    write_app_settings(app, &settings)?;
    crate::system_proxy::configure(&settings.network_proxy)?;
    Ok(settings)
}
