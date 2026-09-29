use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewWindow};
use tokio::sync::Mutex;

mod placement;
mod snapshot;
#[cfg(windows)]
mod windows;

pub(crate) const LABEL: &str = "quick-menu";
const REFRESH_EVENT: &str = "quick-menu-refresh";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MenuSnapshot {
    revision: u64,
    entries: Vec<snapshot::MenuEntry>,
}

#[derive(Default)]
struct MenuSession {
    snapshot: MenuSnapshot,
    anchor: PhysicalPosition<f64>,
    open: bool,
}

#[derive(Default)]
pub(crate) struct QuickMenuState(Mutex<MenuSession>);

/// Opens on the async runtime: WebView creation must never block the Windows UI thread.
pub(crate) async fn show<R: Runtime>(
    app: &AppHandle<R>,
    anchor: PhysicalPosition<f64>,
) -> Result<(), String> {
    let state = app.state::<QuickMenuState>();
    let mut session = state.0.lock().await;
    let read_app = app.clone();
    let entries = tauri::async_runtime::spawn_blocking(move || snapshot::read(&read_app))
        .await
        .map_err(|error| error.to_string())??;
    session.snapshot.revision += 1;
    session.snapshot.entries = entries;
    session.anchor = anchor;
    session.open = true;
    if let Some(window) = app.get_webview_window(LABEL) {
        window
            .emit(REFRESH_EVENT, ())
            .map_err(|error| error.to_string())?;
    } else {
        create_window(app)?;
    }
    Ok(())
}

fn create_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let builder = crate::webview_windows::builder(
        app,
        LABEL,
        tauri::WebviewUrl::App("quick-menu.html#quick-menu".into()),
    )
    .title("Remote AI")
    .inner_size(360.0, 620.0)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false);
    #[cfg(windows)]
    let builder = builder.effects(
        tauri::window::EffectsBuilder::new()
            .effect(tauri::window::Effect::Acrylic)
            .color(tauri::window::Color(235, 241, 246, 125))
            .build(),
    );
    let window = builder.build().map_err(|error| error.to_string())?;
    #[cfg(windows)]
    windows::round_corners(&window).map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_caller<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("此操作仅适用于快捷菜单".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn quick_menu_snapshot<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<MenuSnapshot, String> {
    validate_caller(&window)?;
    let state = window.state::<QuickMenuState>();
    let session = state.0.lock().await;
    Ok(session.snapshot.clone())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresentRequest {
    revision: u64,
    height: f64,
}

#[tauri::command]
pub(crate) async fn quick_menu_present<R: Runtime>(
    window: WebviewWindow<R>,
    request: PresentRequest,
) -> Result<(), String> {
    validate_caller(&window)?;
    let state = window.state::<QuickMenuState>();
    let session = state.0.lock().await;
    if !session.open || session.snapshot.revision != request.revision {
        return Ok(());
    }
    placement::present(&window, session.anchor, request.height).map_err(|error| {
        eprintln!("failed to position quick menu: {error}");
        "无法显示菜单，请重试".into()
    })
}

#[tauri::command]
pub(crate) async fn quick_menu_dismiss<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    validate_caller(&window)?;
    dismiss(window.app_handle()).await
}

async fn dismiss<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<QuickMenuState>();
    let mut session = state.0.lock().await;
    session.open = false;
    if let Some(window) = app.get_webview_window(LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Deserialize)]
pub(crate) struct ActionRequest {
    revision: u64,
    id: String,
}

#[tauri::command]
pub(crate) async fn quick_menu_activate<R: Runtime>(
    window: WebviewWindow<R>,
    request: ActionRequest,
) -> Result<(), String> {
    validate_caller(&window)?;
    let state = window.state::<QuickMenuState>();
    let mut session = state.0.lock().await;
    if !session.open
        || session.snapshot.revision != request.revision
        || !session
            .snapshot
            .entries
            .iter()
            .any(|entry| entry.allows(&request.id))
    {
        return Err("菜单已更新，请重新打开后再试".into());
    }
    session.open = false;
    window.hide().map_err(|error| error.to_string())?;
    drop(session);
    super::handle_menu_event(
        window.app_handle(),
        tauri::menu::MenuEvent {
            id: request.id.into(),
        },
    );
    Ok(())
}

pub(crate) fn handle_window_event<R: Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if window.label() != LABEL {
        return;
    }
    match event {
        tauri::WindowEvent::Focused(false) => {
            // Creating or hiding a WebView also emits blur; only dismiss an open popup.
            if !window.is_visible().unwrap_or(false) {
                return;
            }
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = dismiss(&app).await {
                    eprintln!("failed to dismiss quick menu: {error}");
                }
            });
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Err(error) = window.destroy() {
                eprintln!("failed to close quick menu: {error}");
            }
        }
        _ => {}
    }
}
