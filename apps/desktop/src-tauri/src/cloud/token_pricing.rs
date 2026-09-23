use super::*;
use crate::codex_usage_cost_rates::RemoteCostPresetDocument;
use std::io::Read;

const MAX_PRESET_BYTES: u64 = 2 * 1024 * 1024;
static STARTUP_PRESETS: OnceLock<Result<RemoteCostPresetDocument, String>> = OnceLock::new();

fn request_presets<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<RemoteCostPresetDocument, String> {
    let unavailable = || "暂时无法获取模型计价预设。".to_string();
    let settings = read_app_settings(app).map_err(|_| unavailable())?;
    let response = api_client()
        .map_err(|_| unavailable())?
        .get(endpoint(&settings, "/token-cost-presets").map_err(|_| unavailable())?)
        .timeout(Duration::from_secs(10))
        .header("Accept", "application/json")
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|_| unavailable())?;
    let mut bytes = Vec::new();
    response
        .take(MAX_PRESET_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    if bytes.len() as u64 > MAX_PRESET_BYTES {
        return Err(unavailable());
    }
    let document: RemoteCostPresetDocument =
        serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
    if !document.is_valid() {
        return Err(unavailable());
    }
    Ok(document)
}

/// Fetch at most once per application process; blocking I/O never runs on the UI thread.
#[tauri::command]
pub(crate) async fn fetch_cloud_token_cost_presets<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<RemoteCostPresetDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        STARTUP_PRESETS
            .get_or_init(|| request_presets(&app))
            .clone()
    })
    .await
    .map_err(|_| "暂时无法获取模型计价预设。".to_string())?
}
