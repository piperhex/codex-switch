//! Private GUI transport. External proxy lifecycle and speed never mutate this state.
use super::*;
use crate::codex_gui::{account_selection, GuiState};

#[derive(Default)]
pub(crate) struct GuiProxyRuntime {
    listener: Mutex<Option<ProxyRuntime>>,
    fast_mode: AtomicBool,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum GuiProxyError {
    #[error("Codex GUI 连接暂时不可用，请重试。")]
    Unavailable,
    #[error("当前账户暂不支持快速模式。")]
    FastModeUnavailable,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuiRequestSettings {
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
    let state = read_state(&resolve_paths(&app).map_err(|_| GuiProxyError::Unavailable)?);
    set_system_prompt_filter_runtime_config(
        state.system_prompt_filter_enabled,
        state.system_prompt_filter_rules,
    );
    set_system_prompt_injection_runtime_config(
        state.system_prompt_injection_enabled,
        state.system_prompt_injection_prompts,
    );
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
    if app
        .state::<GuiState>()
        .proxy
        .fast_mode
        .load(Ordering::Relaxed)
    {
        ProxyServiceTier::Priority
    } else {
        ProxyServiceTier::Default
    }
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
    Ok(GuiRequestSettings {
        fast_mode_enabled: service_tier(app) == ProxyServiceTier::Priority,
        fast_mode_available: available,
    })
}

fn set_fast_mode<R: Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
) -> Result<GuiRequestSettings, GuiProxyError> {
    let mut current = settings(app)?;
    if enabled && !current.fast_mode_available {
        return Err(GuiProxyError::FastModeUnavailable);
    }
    app.state::<GuiState>()
        .proxy
        .fast_mode
        .store(enabled, Ordering::Relaxed);
    current.fast_mode_enabled = enabled;
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
    tauri::async_runtime::spawn_blocking(move || set_fast_mode(&app, enabled))
        .await
        .map_err(|_| GuiProxyError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
