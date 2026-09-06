use super::{
    document,
    error::ConfigError,
    models::{ConfigDiagnostic, ConfigDocument, PatchConfigRequest, SaveConfigRequest},
    persistence,
};

#[tauri::command]
pub(crate) async fn read_codex_config_document() -> Result<ConfigDocument, String> {
    run_blocking(|| persistence::with_current_config(persistence::read)).await
}

#[tauri::command]
pub(crate) async fn validate_codex_config_document(
    content: String,
) -> Result<Option<ConfigDiagnostic>, String> {
    run_blocking(move || {
        Ok(document::parse(&content)
            .err()
            .map(|error| error.diagnostic()))
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_codex_config_document(
    request: SaveConfigRequest,
) -> Result<ConfigDocument, String> {
    run_blocking(move || persistence::with_current_config(|path| persistence::save(path, request)))
        .await
}

#[tauri::command]
pub(crate) async fn patch_codex_config_document(
    request: PatchConfigRequest,
) -> Result<ConfigDocument, String> {
    run_blocking(move || persistence::with_current_config(|path| persistence::patch(path, request)))
        .await
}

async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, ConfigError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| ConfigError::Busy.to_string())?
        .map_err(|error| error.to_string())
}
