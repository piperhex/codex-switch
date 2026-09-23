use std::{io::Read, time::Duration};

use reqwest::{blocking::Client, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::{models::TitleSettings, storage::read_app_settings};

const SETTINGS_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_SETTINGS_BYTES: u64 = 64 * 1024;
const TITLE_UNAVAILABLE: &str = "暂时无法获取起名设置。";
const PRESETS_UNAVAILABLE: &str = "暂时无法获取目录预设。";

#[derive(Debug, thiserror::Error)]
enum SettingsError {
    #[error("Invalid cloud server address")]
    InvalidAddress,
    #[error("Could not read cloud server settings")]
    Configuration,
    #[error("Cloud settings request failed")]
    Request(#[from] reqwest::Error),
    #[error("Could not read cloud settings response")]
    Read(#[from] std::io::Error),
    #[error("Invalid cloud settings response")]
    InvalidResponse,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct CloudHomePreset {
    id: String,
    name: String,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HomePresetPlatform {
    Windows,
    Macos,
}

impl HomePresetPlatform {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Macos => "macos",
        }
    }
}

fn settings_url(base: &str, path: &str) -> Result<Url, SettingsError> {
    let mut url = Url::parse(base.trim()).map_err(|_| SettingsError::InvalidAddress)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(SettingsError::InvalidAddress);
    }
    url.set_path(&format!("{}{path}", url.path().trim_end_matches('/')));
    Ok(url)
}

fn request_settings<T: DeserializeOwned>(client: &Client, url: Url) -> Result<T, SettingsError> {
    let response = client
        .get(url)
        .timeout(SETTINGS_TIMEOUT)
        .header("Accept", "application/json")
        .header("Cache-Control", "no-cache, no-store")
        .send()?
        .error_for_status()?;
    let mut bytes = Vec::new();
    response
        .take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err(SettingsError::InvalidResponse);
    }
    serde_json::from_slice(&bytes).map_err(|_| SettingsError::InvalidResponse)
}

fn settings_client() -> Result<Client, SettingsError> {
    Ok(crate::system_proxy::apply(Client::builder())
        .timeout(SETTINGS_TIMEOUT)
        .build()?)
}

fn load_title_settings<R: Runtime>(app: &AppHandle<R>) -> Result<TitleSettings, SettingsError> {
    let settings = read_app_settings(app).map_err(|_| SettingsError::Configuration)?;
    let base = settings
        .cloud_base_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(crate::models::DEFAULT_CLOUD_BASE_URL);
    let mut title: TitleSettings = request_settings(
        &settings_client()?,
        settings_url(base, "/chat/title-settings")?,
    )?;
    title.model = title.model.trim().to_owned();
    if !title.is_valid() {
        return Err(SettingsError::InvalidResponse);
    }
    Ok(title)
}

fn load_home_presets(
    base: &str,
    platform: HomePresetPlatform,
) -> Result<Vec<CloudHomePreset>, SettingsError> {
    let mut url = settings_url(base, "/codex-home-presets")?;
    url.query_pairs_mut()
        .append_pair("platform", platform.as_str());
    request_settings(&settings_client()?, url)
}

/// Read public naming settings without credentials or WebView network access.
#[tauri::command]
pub(crate) async fn fetch_cloud_title_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<TitleSettings, String> {
    tauri::async_runtime::spawn_blocking(move || load_title_settings(&app))
        .await
        .map_err(|_| TITLE_UNAVAILABLE.to_string())?
        .map_err(|_| TITLE_UNAVAILABLE.to_string())
}

/// Only the fixed public preset endpoint is exposed to desktop and hosted callers.
#[tauri::command]
pub(crate) async fn fetch_cloud_home_presets(
    base_url: String,
    platform: HomePresetPlatform,
) -> Result<Vec<CloudHomePreset>, String> {
    tauri::async_runtime::spawn_blocking(move || load_home_presets(&base_url, platform))
        .await
        .map_err(|_| PRESETS_UNAVAILABLE.to_string())?
        .map_err(|_| PRESETS_UNAVAILABLE.to_string())
}

#[cfg(test)]
mod tests;
