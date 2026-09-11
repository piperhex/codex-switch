//! Model choices belong to a conversation; the draft has its own defaults.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const DIRECTORY: &str = "codex-gui-model-settings";
const CHANGED_EVENT: &str = "codex-gui-model-settings-changed";
const MAX_NAME_BYTES: usize = 200;

#[derive(Debug, thiserror::Error)]
pub(crate) enum ModelSettingsError {
    #[error("暂时无法保存或读取对话的模型设置，请稍后重试。")]
    Storage,
    #[error("模型设置无效，请重新选择。")]
    Invalid,
}
type Result<T> = std::result::Result<T, ModelSettingsError>;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Effort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

/// Only model and reasoning are shared; access permissions are not changed by synchronization.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ModelSelection {
    model: String,
    effort: Effort,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelSettingsSnapshot {
    thread_id: Option<String>,
    selection: Option<ModelSelection>,
    revision: u64,
}

/// Serializes complete file operations and their event publication on background workers.
#[derive(Default)]
pub(crate) struct ModelSettingsState(Mutex<()>);

fn settings_path(root: &Path, thread_id: Option<&str>) -> Result<PathBuf> {
    let name = match thread_id {
        None => "draft.json".to_owned(),
        Some(id)
            if !id.is_empty()
                && id.len() <= MAX_NAME_BYTES
                && id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') =>
        {
            format!("thread-{id}.json")
        }
        Some(_) => return Err(ModelSettingsError::Invalid),
    };
    Ok(root.join(DIRECTORY).join(name))
}

fn read(root: &Path, thread_id: Option<String>) -> Result<ModelSettingsSnapshot> {
    let path = settings_path(root, thread_id.as_deref())?;
    match fs::read(path) {
        Ok(bytes) => {
            let snapshot: ModelSettingsSnapshot =
                serde_json::from_slice(&bytes).map_err(|_| ModelSettingsError::Storage)?;
            if snapshot.thread_id != thread_id {
                return Err(ModelSettingsError::Storage);
            }
            Ok(snapshot)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ModelSettingsSnapshot {
            thread_id,
            selection: None,
            revision: 0,
        }),
        Err(_) => Err(ModelSettingsError::Storage),
    }
}

fn save(
    root: &Path,
    thread_id: Option<String>,
    selection: ModelSelection,
) -> Result<ModelSettingsSnapshot> {
    if selection.model.trim() != selection.model
        || selection.model.is_empty()
        || selection.model.len() > MAX_NAME_BYTES
        || selection.model.chars().any(char::is_control)
    {
        return Err(ModelSettingsError::Invalid);
    }
    let previous = read(root, thread_id.clone())?;
    if previous.selection.as_ref() == Some(&selection) {
        return Ok(previous);
    }
    let path = settings_path(root, thread_id.as_deref())?;
    let snapshot = ModelSettingsSnapshot {
        thread_id,
        selection: Some(selection),
        revision: previous
            .revision
            .checked_add(1)
            .ok_or(ModelSettingsError::Storage)?,
    };
    fs::create_dir_all(root.join(DIRECTORY)).map_err(|_| ModelSettingsError::Storage)?;
    let value = serde_json::to_value(&snapshot).map_err(|_| ModelSettingsError::Storage)?;
    crate::storage::write_json_atomic(&path, &value).map_err(|_| ModelSettingsError::Storage)?;
    Ok(snapshot)
}

async fn access(
    app: AppHandle,
    thread_id: Option<String>,
    selection: Option<ModelSelection>,
) -> Result<ModelSettingsSnapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ModelSettingsState>();
        let _guard = state.0.lock().map_err(|_| ModelSettingsError::Storage)?;
        let root = app
            .path()
            .app_data_dir()
            .map_err(|_| ModelSettingsError::Storage)?;
        let Some(selection) = selection else {
            return read(&root, thread_id);
        };
        let snapshot = save(&root, thread_id, selection)?;
        super::web::publish(&app, CHANGED_EVENT, &snapshot);
        Ok(snapshot)
    })
    .await
    .map_err(|_| ModelSettingsError::Storage)?
}

#[tauri::command]
pub(crate) async fn codex_gui_model_settings(
    app: AppHandle,
    thread_id: Option<String>,
) -> std::result::Result<ModelSettingsSnapshot, String> {
    access(app, thread_id, None)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_set_model_settings(
    app: AppHandle,
    thread_id: Option<String>,
    selection: ModelSelection,
) -> std::result::Result<ModelSettingsSnapshot, String> {
    access(app, thread_id, Some(selection))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "model_settings_tests.rs"]
mod tests;
