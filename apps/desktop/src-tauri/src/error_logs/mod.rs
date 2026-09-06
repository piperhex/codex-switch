//! Persist bounded, sanitized proxy errors and user notifications off the UI thread.

mod database;
mod models;
mod sanitize;
#[cfg(test)]
mod tests;
mod worker;

use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

pub(crate) use models::{ErrorLogPage, ErrorLogSource};
use models::{ListQuery, LogError};
use worker::LogService;

const DATABASE_FILENAME: &str = "error-logs.sqlite";
static SERVICE: OnceLock<LogService> = OnceLock::new();

/// Starts the log worker before proxy traffic resumes; SQLite is opened only by that worker.
pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if SERVICE.get().is_some() {
        return Ok(());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| LogError::Unavailable.to_string())?
        .join(DATABASE_FILENAME);
    let service = LogService::start(path).map_err(|error| error.to_string())?;
    SERVICE
        .set(service)
        .map_err(|_| LogError::Unavailable.to_string())
}

/// Accepts display-safe summaries only; request bodies, authentication and headers must never be passed here.
pub(crate) fn record_proxy_error(message: &str, status_code: Option<u16>) {
    if let Some(service) = SERVICE.get() {
        service.record_proxy(message, status_code);
    }
}

fn service() -> Result<&'static LogService, LogError> {
    SERVICE.get().ok_or(LogError::Unavailable)
}

#[tauri::command]
pub(crate) async fn list_error_logs(
    limit: Option<u32>,
    before_id: Option<i64>,
    source: Option<ErrorLogSource>,
) -> Result<ErrorLogPage, String> {
    let query = ListQuery::new(limit, before_id, source).map_err(|error| error.to_string())?;
    background(move || service()?.list(query)).await
}

#[tauri::command]
pub(crate) async fn clear_error_logs() -> Result<(), String> {
    background(|| service()?.clear()).await
}

#[tauri::command]
pub(crate) async fn record_toast_log(message: String) -> Result<(), String> {
    background(move || service()?.record_toast(&message)).await
}

async fn background<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, LogError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| LogError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
