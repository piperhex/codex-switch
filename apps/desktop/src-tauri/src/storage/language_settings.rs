use std::{fs, path::Path};

use tauri::Runtime;

use super::{app_settings_path, write_json_atomic};
use crate::models::AppSettings;

const LANGUAGE_FILENAME: &str = "interface-language.json";

/// Keep the legacy value until a language is explicitly saved. An unreadable UI preference
/// must not prevent account, proxy or background operations from reading their settings.
pub(super) fn apply_saved_language(settings_path: &Path, settings: &mut AppSettings) {
    let saved = fs::read(settings_path.with_file_name(LANGUAGE_FILENAME))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<String>(&bytes).ok());
    if let Some(language) = saved.filter(|value| matches!(value.as_str(), "zh" | "en" | "ru")) {
        settings.language = Some(language);
    }
}

/// Save only the interface preference; never write a stale snapshot of business settings.
/// This function is called by a blocking worker and uses atomic file replacement.
pub(crate) fn save_app_language<R: Runtime>(
    app: &tauri::AppHandle<R>,
    language: &str,
) -> Result<(), String> {
    if !matches!(language, "zh" | "en" | "ru") {
        return Err("Unsupported interface language".to_string());
    }
    let path = app_settings_path(app)?.with_file_name(LANGUAGE_FILENAME);
    write_json_atomic(&path, &serde_json::Value::String(language.to_string()))
}
