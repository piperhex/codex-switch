//! Desktop file previews in independent WebViews with the existing file actions.
mod content;
#[cfg(all(test, windows))]
mod native_smoke;
mod range;
mod server;

use super::{
    file_actions::{self, FileTarget},
    GuiState,
};
use content::PreviewData;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};
use tokio::sync::Mutex;

const WINDOW_PREFIX: &str = "file-preview-";

#[derive(Debug, thiserror::Error)]
enum PreviewError {
    #[error("暂时无法读取此文件，请从文件菜单选择其他打开方式。")]
    Read,
    #[error("预览未能打开，请稍后重试。")]
    Open,
}
impl From<std::io::Error> for PreviewError {
    fn from(_: std::io::Error) -> Self {
        Self::Read
    }
}
type Result<T> = std::result::Result<T, PreviewError>;

struct PreviewSession {
    data: PreviewData,
    _server: server::PreviewServer,
}

#[derive(Default)]
pub(crate) struct PreviewWindows(Mutex<HashMap<String, PreviewSession>>);

/// Unsupported files return false so the clicked link can show its original menu.
#[tauri::command]
pub(crate) async fn codex_gui_open_file_preview(
    app: AppHandle,
    target: FileTarget,
) -> std::result::Result<bool, String> {
    let path = file_actions::resolve_target(&app.state::<GuiState>(), &target)
        .await
        .map_err(|error| error.to_string())?;
    let session =
        tauri::async_runtime::spawn_blocking(move || -> Result<Option<PreviewSession>> {
            let Some(mut data) = content::load(&path)? else {
                return Ok(None);
            };
            let server = server::PreviewServer::start(&path)?;
            data.url = server.url.clone();
            data.line = target.line;
            data.column = target.column;
            Ok(Some(PreviewSession {
                data,
                _server: server,
            }))
        })
        .await
        .map_err(|_| PreviewError::Open.to_string())?
        .map_err(|error| error.to_string())?;
    let Some(session) = session else {
        return Ok(false);
    };
    open_window(app, session)
        .await
        .map_err(|error| error.to_string())?;
    Ok(true)
}

async fn open_window(app: AppHandle, session: PreviewSession) -> Result<()> {
    let label = format!("{WINDOW_PREFIX}{}", uuid::Uuid::new_v4());
    let title = format!("{} — 文件预览", session.data.name);
    app.state::<PreviewWindows>()
        .0
        .lock()
        .await
        .insert(label.clone(), session);
    let result = crate::webview_windows::builder(
        &app,
        &label,
        WebviewUrl::App("index.html#file-preview".into()),
    )
    .title(title)
    .inner_size(1100.0, 780.0)
    .min_inner_size(520.0, 360.0)
    .center()
    .build();
    if result.is_err() {
        app.state::<PreviewWindows>().0.lock().await.remove(&label);
        return Err(PreviewError::Open);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn codex_gui_read_file_preview(
    window: WebviewWindow,
) -> std::result::Result<PreviewData, String> {
    window
        .state::<PreviewWindows>()
        .0
        .lock()
        .await
        .get(window.label())
        .map(|session| session.data.clone())
        .ok_or_else(|| PreviewError::Read.to_string())
}

/// Release file access and streaming workers when their owning preview closes.
pub(crate) fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if !window.label().starts_with(WINDOW_PREFIX) {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        if let Err(error) = window.destroy() {
            eprintln!("failed to close file preview: {error}");
        }
    }
    if matches!(event, tauri::WindowEvent::Destroyed) {
        let app = window.app_handle().clone();
        let label = window.label().to_owned();
        tauri::async_runtime::spawn(async move {
            app.state::<PreviewWindows>().0.lock().await.remove(&label);
        });
    }
}
