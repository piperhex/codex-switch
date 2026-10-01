use std::{collections::BTreeMap, fs, io, path::Path, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::Runtime;

use super::{app_settings_path, read_app_settings, write_json_atomic};
use crate::models::AppSettings;

const CONTEXT_SETTINGS_FILENAME: &str = "model-context-settings.json";
static CONTEXT_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelContextSettings {
    global_context_window: u64,
    model_context_windows: BTreeMap<String, u64>,
}

/// Context preferences survive unrelated settings snapshots and proxy mode changes.
pub(crate) enum ModelContextWindowUpdate {
    Global(u64),
    Model {
        model: String,
        context_window: Option<u64>,
    },
}

/// Legacy settings remain the fallback until the first explicit context edit.
pub(super) fn apply_saved_context_settings(
    settings_path: &Path,
    settings: &mut AppSettings,
) -> Result<(), String> {
    let path = settings_path.with_file_name(CONTEXT_SETTINGS_FILENAME);
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Failed to read model context settings: {error}")),
    };
    let saved: ModelContextSettings = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Model context settings are invalid: {error}"))?;
    settings.gpt_5_6_sol_context_window = saved.global_context_window;
    settings.official_model_context_windows = saved.model_context_windows;
    Ok(())
}

/// Called by blocking command workers only; general settings writers never wait on this lock.
pub(crate) fn update_model_context_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    update: ModelContextWindowUpdate,
) -> Result<AppSettings, String> {
    let path = app_settings_path(app)?.with_file_name(CONTEXT_SETTINGS_FILENAME);
    let _guard = CONTEXT_WRITE_LOCK
        .lock()
        .map_err(|_| "Model context settings lock is poisoned".to_string())?;
    let mut settings = read_app_settings(app)?;
    apply_context_update(&mut settings, update);
    write_context_settings(&path, &settings)?;
    Ok(settings)
}

/// Runs during startup before background tasks can save legacy settings snapshots.
pub(super) fn migrate_legacy_context_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let path = app_settings_path(app)?.with_file_name(CONTEXT_SETTINGS_FILENAME);
    let _guard = CONTEXT_WRITE_LOCK
        .lock()
        .map_err(|_| "Model context settings lock is poisoned".to_string())?;
    if path.try_exists().map_err(|error| error.to_string())? {
        return Ok(());
    }
    write_context_settings(&path, &read_app_settings(app)?)
}

fn write_context_settings(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let saved = ModelContextSettings {
        global_context_window: settings.gpt_5_6_sol_context_window,
        model_context_windows: settings.official_model_context_windows.clone(),
    };
    // Background sync can hold old AppSettings across network requests. Keep these preferences
    // independently so those snapshots cannot undo an edit or restore a deleted model override.
    let value = serde_json::to_value(saved).map_err(|error| error.to_string())?;
    write_json_atomic(path, &value)
}

fn apply_context_update(settings: &mut AppSettings, update: ModelContextWindowUpdate) {
    match update {
        ModelContextWindowUpdate::Global(value) => settings.gpt_5_6_sol_context_window = value,
        ModelContextWindowUpdate::Model {
            model,
            context_window,
        } => match context_window {
            Some(value) => {
                settings.official_model_context_windows.insert(model, value);
            }
            None => {
                settings.official_model_context_windows.remove(&model);
            }
        },
    }
}
