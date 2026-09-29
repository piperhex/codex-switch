//! GUI prompt rules have their own storage and never change the external proxy's rules.
use crate::models::SystemPromptRule;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "codex-gui-system-prompts.json";
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, thiserror::Error)]
pub(crate) enum SettingsError {
    #[error("暂时无法读取或保存系统提示词，请重试。")]
    Storage,
    #[error("提示词规则无效，请检查内容和规则数量后重试。")]
    InvalidRules,
}

/// A complete snapshot is saved and applied atomically to each GUI request.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuiSystemPromptSettings {
    pub(crate) filter_enabled: bool,
    pub(crate) filter_rules: Vec<SystemPromptRule>,
    pub(crate) injection_enabled: bool,
    pub(crate) injection_prompts: Vec<SystemPromptRule>,
}

fn normalize(
    mut settings: GuiSystemPromptSettings,
) -> Result<GuiSystemPromptSettings, SettingsError> {
    settings.filter_rules = super::normalize_system_prompt_filter_rules(settings.filter_rules)
        .map_err(|_| SettingsError::InvalidRules)?;
    settings.injection_prompts =
        super::normalize_system_prompt_injection_prompts(settings.injection_prompts)
            .map_err(|_| SettingsError::InvalidRules)?;
    Ok(settings)
}

fn load(path: &Path) -> Result<GuiSystemPromptSettings, SettingsError> {
    match fs::read(path) {
        Ok(bytes) => normalize(serde_json::from_slice(&bytes).map_err(|_| SettingsError::Storage)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(GuiSystemPromptSettings::default())
        }
        Err(_) => Err(SettingsError::Storage),
    }
}

fn access_path(
    path: &Path,
    settings: Option<GuiSystemPromptSettings>,
) -> Result<GuiSystemPromptSettings, SettingsError> {
    let _guard = SETTINGS_LOCK.lock().map_err(|_| SettingsError::Storage)?;
    let current = load(path)?;
    let Some(settings) = settings else {
        return Ok(current);
    };
    let settings = normalize(settings)?;
    let value = serde_json::to_value(&settings).map_err(|_| SettingsError::Storage)?;
    crate::storage::write_json_atomic(path, &value).map_err(|_| SettingsError::Storage)?;
    Ok(settings)
}

fn access<R: Runtime>(
    app: &AppHandle<R>,
    settings: Option<GuiSystemPromptSettings>,
) -> Result<GuiSystemPromptSettings, SettingsError> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| SettingsError::Storage)?;
    access_path(&root.join(FILE_NAME), settings)
}

fn apply_settings(body: Vec<u8>, settings: &GuiSystemPromptSettings) -> Vec<u8> {
    if !settings.filter_enabled && !settings.injection_enabled {
        return body;
    }
    let Ok(mut value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    if settings.filter_enabled {
        value = super::remove_matching_system_prompts(value, &settings.filter_rules);
    }
    if settings.injection_enabled {
        value = super::inject_system_prompt_value_with_prompts(value, &settings.injection_prompts);
    }
    serde_json::to_vec(&value).unwrap_or(body)
}

/// Runs on the proxy request worker. Retries reuse this snapshot without injecting twice.
pub(super) fn apply<R: Runtime>(
    app: &AppHandle<R>,
    body: Vec<u8>,
) -> Result<Vec<u8>, SettingsError> {
    let settings = access(app, None)?;
    Ok(apply_settings(body, &settings))
}

#[tauri::command]
pub(crate) async fn codex_gui_system_prompt_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GuiSystemPromptSettings, String> {
    tauri::async_runtime::spawn_blocking(move || access(&app, None))
        .await
        .map_err(|_| SettingsError::Storage.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_set_system_prompt_settings<R: Runtime>(
    app: AppHandle<R>,
    settings: GuiSystemPromptSettings,
) -> Result<GuiSystemPromptSettings, String> {
    tauri::async_runtime::spawn_blocking(move || access(&app, Some(settings)))
        .await
        .map_err(|_| SettingsError::Storage.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "gui_system_prompts_tests.rs"]
mod tests;
