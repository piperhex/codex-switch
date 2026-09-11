//! Interactive shells are available only to the local main window, never to hosted web clients.
mod platform;
mod service;
#[cfg(test)]
mod tests;
mod types;

pub(crate) use service::TerminalState;
use std::sync::{atomic::Ordering, Arc};
use tauri::{ipc::Channel, AppHandle, Manager, Window};
use types::{OpenTerminal, TerminalError, TerminalEvent, TerminalInfo, TerminalRequest};

fn authorize(window: &Window) -> types::Result<()> {
    if window.label() != "main" {
        return Err(TerminalError::Access);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn codex_gui_terminal_open(
    app: AppHandle,
    window: Window,
    request: OpenTerminal,
    on_event: Channel<TerminalEvent>,
) -> std::result::Result<TerminalInfo, String> {
    authorize(&window).map_err(|error| error.to_string())?;
    let state = app.state::<Arc<TerminalState>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.open(request, Arc::new(move |event| on_event.send(event).is_ok()))
    })
    .await
    .map_err(|_| TerminalError::Start.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_terminal_command(
    app: AppHandle,
    window: Window,
    request: TerminalRequest,
) -> std::result::Result<(), String> {
    authorize(&window).map_err(|error| error.to_string())?;
    let state = app.state::<Arc<TerminalState>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.perform(request))
        .await
        .map_err(|_| TerminalError::Io.to_string())?
        .map_err(|error| error.to_string())
}

/// Defer the first exit until shells and their consoles have closed off the Windows UI thread.
pub(crate) fn defer_exit(app: &AppHandle, api: &tauri::ExitRequestApi) -> bool {
    let state = app.state::<Arc<TerminalState>>().inner().clone();
    if state.exiting.swap(true, Ordering::AcqRel) {
        return false;
    }
    api.prevent_exit();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.shutdown();
        app.exit(0);
    });
    true
}
