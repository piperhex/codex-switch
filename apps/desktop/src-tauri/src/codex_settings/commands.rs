use super::{
    document,
    error::ConfigError,
    models::{ConfigDiagnostic, ConfigDocument, PatchConfigRequest, SaveConfigRequest},
    persistence,
};

#[tauri::command]
pub(crate) async fn read_codex_config_document<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    home_id: Option<String>,
) -> Result<ConfigDocument, String> {
    run_blocking(move || {
        let home = selected_home(&app, home_id)?;
        persistence::with_current_config(&home, persistence::read)
    })
    .await
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
pub(crate) async fn save_codex_config_document<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    home_id: Option<String>,
    request: SaveConfigRequest,
) -> Result<ConfigDocument, String> {
    run_blocking(move || {
        let home = selected_home(&app, home_id)?;
        persistence::with_current_config(&home, |path| persistence::save(path, request))
    })
    .await
}

#[tauri::command]
pub(crate) async fn patch_codex_config_document<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    home_id: Option<String>,
    request: PatchConfigRequest,
) -> Result<ConfigDocument, String> {
    run_blocking(move || {
        let home = selected_home(&app, home_id)?;
        persistence::with_current_config(&home, |path| persistence::patch(path, request))
    })
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

fn selected_home<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    home_id: Option<String>,
) -> Result<std::path::PathBuf, ConfigError> {
    crate::codex_home::resolve_selected(app, home_id.as_deref())
        .map_err(|_| ConfigError::HomeUnavailable)
}
