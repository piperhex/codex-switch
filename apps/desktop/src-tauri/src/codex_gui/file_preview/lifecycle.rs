//! A renderer reload does not unmount React; release its previews on the native side too.
use super::PreviewSessions;
use std::sync::atomic::Ordering;
use tauri::{webview::PageLoadPayload, Manager, Webview};

fn clear_files(app: &tauri::AppHandle, owner: String) {
    let generation = app
        .state::<PreviewSessions>()
        .generation
        .fetch_add(1, Ordering::AcqRel);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<PreviewSessions>()
            .sessions
            .lock()
            .await
            .retain(|_, session| session.owner != owner || session.generation > generation);
    });
}

pub(crate) fn handle_page_load(webview: &Webview, payload: &PageLoadPayload<'_>) {
    if webview.label() != "main"
        || !matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
    {
        return;
    }
    clear_files(webview.app_handle(), webview.label().to_owned());
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        for (label, view) in app.webviews() {
            if label.starts_with(super::website::LABEL_PREFIX) {
                if let Err(error) = view.close() {
                    eprintln!("website preview cleanup failed: {error}");
                }
            }
        }
    });
}

pub(crate) fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
        clear_files(window.app_handle(), window.label().to_owned());
    }
}
