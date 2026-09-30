//! Private GUI transport. External proxy lifecycle and speed never mutate this state.
use super::gui_speed::GuiRequestSpeed;
use super::*;
use crate::codex_gui::{account_selection, GuiState};
use std::sync::atomic::AtomicU8;

#[derive(Default)]
pub(crate) struct GuiProxyRuntime {
    listener: Mutex<Option<ProxyRuntime>>,
    speed: AtomicU8,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum GuiProxyError {
    #[error("Codex GUI 连接暂时不可用，请重试。")]
    Unavailable,
    #[error("当前账户暂不支持加速模式。")]
    FastModeUnavailable,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuiRequestSettings {
    speed: GuiRequestSpeed,
    fast_mode_enabled: bool,
    fast_mode_available: bool,
}

/// Called on the GUI preparation worker; binding never blocks the window thread.
pub(crate) fn ensure_started<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<String, GuiProxyError> {
    let state = app.state::<GuiState>();
    let mut listener = state
        .proxy
        .listener
        .lock()
        .map_err(|_| GuiProxyError::Unavailable)?;
    if listener.is_none() {
        *listener = Some(start_listener(app.clone())?);
    }
    let address = listener
        .as_ref()
        .and_then(|runtime| runtime.server.server_addr().to_ip())
        .ok_or(GuiProxyError::Unavailable)?;
    Ok(format!("http://{address}/codex-gui/v1"))
}

fn start_listener<R: Runtime>(app: tauri::AppHandle<R>) -> Result<ProxyRuntime, GuiProxyError> {
    let server =
        Arc::new(Server::http((LOCAL_PROXY_HOST, 0)).map_err(|_| GuiProxyError::Unavailable)?);
    let incoming = Arc::clone(&server);
    let handle = thread::Builder::new()
        .name("codex-gui-proxy".into())
        .spawn(move || {
            for request in incoming.incoming_requests() {
                let app = app.clone();
                if let Err(error) = thread::Builder::new()
                    .name("codex-gui-request".into())
                    .spawn(move || serve_request(app, request, RequestOrigin::Gui))
                {
                    log_proxy_error!("Could not start GUI request worker: {error}");
                }
            }
        })
        .map_err(|_| GuiProxyError::Unavailable)?;
    Ok(ProxyRuntime {
        server,
        handle: Some(handle),
    })
}

/// Stop only the GUI listener, on a worker during application shutdown.
pub(crate) fn shutdown<R: Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<GuiState>();
    let runtime = match state.proxy.listener.lock() {
        Ok(mut listener) => listener.take(),
        Err(_) => {
            log_proxy_error!("Could not lock GUI listener during shutdown");
            return;
        }
    };
    if let Some(runtime) = runtime {
        stop_proxy_runtime(runtime);
    }
}

pub(super) fn service_tier<R: Runtime>(app: &tauri::AppHandle<R>) -> ProxyServiceTier {
    speed(app).service_tier()
}

fn speed<R: Runtime>(app: &tauri::AppHandle<R>) -> GuiRequestSpeed {
    GuiRequestSpeed::from_stored(app.state::<GuiState>().proxy.speed.load(Ordering::Relaxed))
}

fn settings<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<GuiRequestSettings, GuiProxyError> {
    use account_selection::GuiAccountSelection;
    let selection = account_selection::read(app).map_err(|_| GuiProxyError::Unavailable)?;
    let available = match selection {
        GuiAccountSelection::Account(_) => true,
        GuiAccountSelection::Provider(id) => {
            let paths = resolve_paths(app).map_err(|_| GuiProxyError::Unavailable)?;
            providers::read_provider(&paths, &id)
                .map(|provider| provider.fast_mode_enabled)
                .unwrap_or(false)
        }
        GuiAccountSelection::None => false,
    };
    let speed = speed(app);
    Ok(GuiRequestSettings {
        speed,
        fast_mode_enabled: speed != GuiRequestSpeed::Normal,
        fast_mode_available: available,
    })
}

fn set_speed<R: Runtime>(
    app: &tauri::AppHandle<R>,
    speed: GuiRequestSpeed,
) -> Result<GuiRequestSettings, GuiProxyError> {
    let mut current = settings(app)?;
    if speed != GuiRequestSpeed::Normal && !current.fast_mode_available {
        return Err(GuiProxyError::FastModeUnavailable);
    }
    app.state::<GuiState>()
        .proxy
        .speed
        .store(speed as u8, Ordering::Relaxed);
    current.speed = speed;
    current.fast_mode_enabled = speed != GuiRequestSpeed::Normal;
    crate::codex_gui::web::publish(app, "codex-gui-request-settings-changed", &current);
    Ok(current)
}

#[tauri::command]
pub(crate) async fn codex_gui_request_settings<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<GuiRequestSettings, String> {
    tauri::async_runtime::spawn_blocking(move || settings(&app))
        .await
        .map_err(|_| GuiProxyError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_set_fast_mode<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<GuiRequestSettings, String> {
    let speed = if enabled {
        GuiRequestSpeed::Fast
    } else {
        GuiRequestSpeed::Normal
    };
    codex_gui_set_request_speed(app, speed).await
}

#[tauri::command]
pub(crate) async fn codex_gui_set_request_speed<R: Runtime>(
    app: tauri::AppHandle<R>,
    speed: GuiRequestSpeed,
) -> Result<GuiRequestSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_speed(&app, speed))
        .await
        .map_err(|_| GuiProxyError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
