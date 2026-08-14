use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    models::AppSettings,
    storage::{read_app_settings, write_app_settings},
};

const UPDATE_ERROR: &str = "Unable to update the startup setting.";

pub(crate) fn restore_preference<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let settings = read_app_settings(app)?;
    apply_preference(app, settings.launch_at_startup)
}

#[tauri::command]
pub(crate) async fn set_launch_at_startup(
    app: AppHandle,
    enabled: bool,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || update_preference(&app, enabled))
        .await
        .map_err(|_| UPDATE_ERROR.to_string())?
}

fn update_preference<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(app).map_err(|_| UPDATE_ERROR.to_string())?;
    let previous = settings.launch_at_startup;
    apply_preference(app, enabled).map_err(|_| UPDATE_ERROR.to_string())?;
    settings.launch_at_startup = enabled;

    if write_app_settings(app, &settings).is_ok() {
        return Ok(settings);
    }

    let rollback = apply_preference(app, previous);
    if rollback.is_err() {
        return Err(
            "Unable to save the startup setting or restore its previous state.".to_string(),
        );
    }
    Err(UPDATE_ERROR.to_string())
}

fn apply_preference<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|error| error.to_string())
}
