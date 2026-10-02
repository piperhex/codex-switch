use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

use tauri::Runtime;

use crate::{models::AppSettings, storage};

const PREFERENCE_FILENAME: &str = "non-proxy-enhancements.json";
const SAVE_ERROR: &str = "暂时无法保存 ChatGPT 增强功能设置，请重试。";
static NON_PROXY_ENHANCEMENTS: AtomicBool = AtomicBool::new(true);

/// Keep this preference separate so stale settings snapshots cannot re-enable it.
pub(crate) fn read_preference(settings_path: &Path) -> Result<bool, String> {
    match fs::read(settings_path.with_file_name(PREFERENCE_FILENAME)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "无法读取 ChatGPT 增强功能设置，请重新保存设置。".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(_) => Err("暂时无法读取 ChatGPT 增强功能设置，请重试。".to_string()),
    }
}

fn save_preference(settings_path: &Path, enabled: bool) -> Result<(), String> {
    storage::write_json_atomic(
        &settings_path.with_file_name(PREFERENCE_FILENAME),
        &serde_json::Value::Bool(enabled),
    )
    .map_err(|_| SAVE_ERROR.to_string())
}

pub(crate) fn setup<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let enabled = read_preference(&storage::app_settings_path(app)?)?;
    NON_PROXY_ENHANCEMENTS.store(enabled, Ordering::Release);
    Ok(())
}

fn enhancements_enabled(non_proxy_enabled: bool, proxy_running: bool) -> bool {
    proxy_running || non_proxy_enabled
}

/// The monitor reads a cached preference without disk I/O or waiting for a lock.
pub(crate) fn enabled_for(proxy_running: bool) -> bool {
    enhancements_enabled(
        NON_PROXY_ENHANCEMENTS.load(Ordering::Acquire),
        proxy_running,
    )
}

#[tauri::command]
pub(crate) async fn set_non_proxy_enhancements<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _switch = crate::commands::account_switch_lock()
            .lock()
            .map_err(|_| SAVE_ERROR.to_string())?;
        save_preference(&storage::app_settings_path(&app)?, enabled)?;
        NON_PROXY_ENHANCEMENTS.store(enabled, Ordering::Release);
        storage::read_app_settings(&app)
    })
    .await
    .map_err(|_| SAVE_ERROR.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_mode_always_keeps_enhancements() {
        assert!(enhancements_enabled(true, false));
        assert!(!enhancements_enabled(false, false));
        assert!(enhancements_enabled(false, true));
        assert!(enhancements_enabled(true, true));
    }

    #[test]
    fn preference_defaults_on_and_survives_unrelated_settings_writes() {
        let root = std::env::temp_dir().join(format!("csw-integration-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("settings.json");
        assert!(read_preference(&path).unwrap());
        save_preference(&path, false).unwrap();
        storage::write_json_atomic(&path, &serde_json::json!({"closeToTray": false})).unwrap();
        assert!(!read_preference(&path).unwrap());
        save_preference(&path, true).unwrap();
        assert!(read_preference(&path).unwrap());
        fs::write(root.join(PREFERENCE_FILENAME), b"invalid").unwrap();
        assert!(read_preference(&path).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
