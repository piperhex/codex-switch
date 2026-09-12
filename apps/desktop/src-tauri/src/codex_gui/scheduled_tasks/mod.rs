//! Persistent local tasks are driven by the host, independently of the open GUI page.
mod runtime;
mod schedule;
mod store;
#[cfg(test)]
mod tests;
mod types;

use std::sync::{atomic::AtomicBool, Mutex};
use tauri::{AppHandle, Manager};
use types::{Result, TaskError};
pub(crate) use types::{ScheduledTask, TaskRequest};

#[derive(Default)]
pub(crate) struct ScheduledTasksState {
    storage: Mutex<()>,
    started: AtomicBool,
}

/// Called once during app setup; no model work starts until a saved task becomes due.
pub(crate) fn start(app: &AppHandle) {
    runtime::start(app.clone());
}

async fn access<T, F>(app: AppHandle, operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Vec<ScheduledTask>) -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ScheduledTasksState>();
        let _guard = state.storage.lock().map_err(|_| TaskError::Storage)?;
        let root = crate::codex_home::gui_home(&app).map_err(|_| TaskError::Storage)?;
        let mut tasks = store::read(&root)?;
        let before = serde_json::to_vec(&tasks).map_err(|_| TaskError::Storage)?;
        let result = operation(&mut tasks)?;
        if before != serde_json::to_vec(&tasks).map_err(|_| TaskError::Storage)? {
            store::write(&root, &tasks)?;
        }
        Ok(result)
    })
    .await
    .map_err(|_| TaskError::Storage)?
}

#[tauri::command]
pub(crate) async fn codex_gui_scheduled_tasks(
    app: AppHandle,
    request: TaskRequest,
) -> std::result::Result<Vec<ScheduledTask>, String> {
    access(app, move |tasks| {
        store::apply(tasks, request, chrono::Utc::now().timestamp_millis())?;
        Ok(tasks.clone())
    })
    .await
    .map_err(|error| error.to_string())
}
