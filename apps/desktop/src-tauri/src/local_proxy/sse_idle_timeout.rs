use crate::{models::SseIdleTimeoutSettings, storage};
use std::{cell::Cell, time::Duration};
use tauri::Runtime;

thread_local! {
    static REQUEST_TIMEOUT: Cell<Option<Duration>> = Cell::new(SseIdleTimeoutSettings::default().duration());
}

/// Scoped to the synchronous proxy request worker. Transport preparation copies
/// the value, so returned stream readers never depend on thread-local state.
pub(super) struct RequestScope(Option<Duration>);

impl RequestScope {
    pub(super) fn enter(settings: SseIdleTimeoutSettings) -> Self {
        Self(REQUEST_TIMEOUT.replace(settings.duration()))
    }
}

impl Drop for RequestScope {
    fn drop(&mut self) {
        REQUEST_TIMEOUT.set(self.0);
    }
}

pub(super) fn current() -> Option<Duration> {
    REQUEST_TIMEOUT.get()
}

#[tauri::command]
pub(crate) async fn set_sse_idle_timeout<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    settings: SseIdleTimeoutSettings,
) -> Result<SseIdleTimeoutSettings, String> {
    settings.validate().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut saved = storage::read_app_settings(&app)?;
        saved.sse_idle_timeout = settings;
        storage::write_app_settings(&app, &saved)
            .map_err(|_| "Could not save the waiting time. Please try again.".to_string())?;
        Ok(settings)
    })
    .await
    .map_err(|_| "Could not save the waiting time. Please try again.".to_string())?
}
