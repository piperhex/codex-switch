use crate::codex_usage_summary::{self, CodexUsageSummary};

#[tauri::command]
pub(crate) async fn codex_gui_usage_summary(
    app: tauri::AppHandle,
) -> Result<CodexUsageSummary, String> {
    tauri::async_runtime::spawn_blocking(move || codex_usage_summary::load_for_gui(&app))
        .await
        .map_err(|_| "暂时无法刷新用量，请稍后重试。".to_string())?
        .map_err(|_| "暂时无法刷新用量，请稍后重试。".to_string())
}
