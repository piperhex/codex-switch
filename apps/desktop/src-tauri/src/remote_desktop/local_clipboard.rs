//! Viewer clipboard access uses the same bounded content and file validation as the host.
use super::clipboard::{ClipboardError, Content};

#[tauri::command]
pub(crate) async fn remote_desktop_read_local_clipboard() -> Result<Content, String> {
    tauri::async_runtime::spawn_blocking(super::clipboard_platform::read_local)
        .await
        .map_err(|_| ClipboardError::Access.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn remote_desktop_write_local_clipboard(content: Content) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || super::clipboard_platform::write_local(content))
        .await
        .map_err(|_| ClipboardError::Access.to_string())?
        .map_err(|error| error.to_string())
}
