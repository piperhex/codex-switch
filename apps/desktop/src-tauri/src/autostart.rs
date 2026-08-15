use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;
#[cfg(windows)]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

use crate::{
    models::AppSettings,
    storage::{read_app_settings, write_app_settings},
};

const UPDATE_ERROR: &str = "Unable to update the startup setting.";
#[cfg(windows)]
const WINDOWS_RUN_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";

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
    if enabled {
        return app.autolaunch().enable().map_err(|error| error.to_string());
    }
    disable_preference(app)
}

#[cfg(windows)]
fn disable_preference<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let run_key =
        match current_user.open_subkey_with_flags(WINDOWS_RUN_KEY, winreg::enums::KEY_SET_VALUE) {
            Ok(key) => key,
            Err(error) => return ignore_missing_registry_value(error),
        };
    match run_key.delete_value(&app.package_info().name) {
        Ok(()) => Ok(()),
        Err(error) => ignore_missing_registry_value(error),
    }
}

#[cfg(windows)]
fn ignore_missing_registry_value(error: std::io::Error) -> Result<(), String> {
    if error.kind() == std::io::ErrorKind::NotFound {
        return Ok(());
    }
    Err(error.to_string())
}

#[cfg(not(windows))]
fn disable_preference<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.autolaunch()
        .disable()
        .map_err(|error| error.to_string())
}

#[cfg(all(test, windows))]
mod tests {
    use super::ignore_missing_registry_value;
    use std::io::{Error, ErrorKind};

    #[test]
    fn missing_registry_value_is_already_disabled() {
        let result = ignore_missing_registry_value(Error::from(ErrorKind::NotFound));

        assert_eq!(result, Ok(()));
    }

    #[test]
    fn other_registry_errors_are_preserved() {
        let result = ignore_missing_registry_value(Error::from(ErrorKind::PermissionDenied));

        assert!(result.is_err());
    }
}
