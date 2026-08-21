use std::{
    io::Read,
    sync::{Arc, Mutex, OnceLock},
    thread::{self, JoinHandle},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::{
    models::AppSettings,
    storage::{read_app_settings, write_app_settings},
};

const WEB_SERVER_LOOPBACK_HOST: &str = "127.0.0.1";
const WEB_SERVER_ALL_INTERFACES_HOST: &str = "0.0.0.0";
const WEB_SERVER_THREAD_NAME: &str = "codex-switch-web-server";
const WEB_REQUEST_THREAD_NAME: &str = "codex-switch-web-request";
const WEB_CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'self'; img-src 'self' data: http: https:; ",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ",
    "font-src 'self' https://fonts.gstatic.com; ",
    "connect-src 'self' http: https: ws: wss:"
);
const WEB_INVOKE_PATH: &str = "/__codex_switch__/api/invoke";
const HOSTED_RUNTIME_MARKER: &str = r#"<meta name="codex-switch-runtime" content="hosted">"#;
const MAX_INVOKE_BODY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebInvokeRequest {
    command: String,
    #[serde(default)]
    args: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebInvokeResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

struct WebServerRuntime {
    configuration: WebServerConfiguration,
    server: Arc<Server>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct WebServerConfiguration {
    port: u16,
    listen_on_all_interfaces: bool,
}

fn runtime() -> &'static Mutex<Option<WebServerRuntime>> {
    static RUNTIME: OnceLock<Mutex<Option<WebServerRuntime>>> = OnceLock::new();
    RUNTIME.get_or_init(|| Mutex::new(None))
}

pub(crate) fn setup(app: &AppHandle, port_override: Option<u16>) -> Result<(), String> {
    let settings = read_app_settings(app)?;
    let port = port_override.or(settings.web_proxy_port);
    if let Some(port) = port {
        validate_port(port)?;
        start_server(
            app.clone(),
            WebServerConfiguration {
                port,
                listen_on_all_interfaces: settings.web_proxy_listen_on_all_interfaces,
            },
        )?;
    }
    Ok(())
}

pub(crate) fn restart_at_port(app: &AppHandle, port: u16) -> Result<(), String> {
    validate_port(port)?;
    let settings = read_app_settings(app)?;
    let configuration = WebServerConfiguration {
        port,
        listen_on_all_interfaces: settings.web_proxy_listen_on_all_interfaces,
    };
    let previous_configuration = running_configuration();
    if previous_configuration == Some(configuration) {
        return Ok(());
    }

    stop_server();
    if let Err(error) = start_server(app.clone(), configuration) {
        let restore_error = restore_server(app, previous_configuration);
        return Err(configuration_error(error, restore_error));
    }
    Ok(())
}

pub(crate) fn shutdown() {
    stop_server();
}

#[tauri::command]
pub(crate) async fn set_web_proxy_port(
    app: AppHandle,
    port: Option<u16>,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || set_web_proxy_port_blocking(&app, port))
        .await
        .map_err(|error| format!("Failed to update the web version settings: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_web_proxy_listen_on_all_interfaces(
    app: AppHandle,
    enabled: bool,
) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_web_proxy_listen_on_all_interfaces_blocking(&app, enabled)
    })
    .await
    .map_err(|error| format!("Failed to update the web version settings: {error}"))?
}

fn set_web_proxy_port_blocking(app: &AppHandle, port: Option<u16>) -> Result<AppSettings, String> {
    if let Some(port) = port {
        validate_port(port)?;
    }
    let settings = read_app_settings(app)?;
    let listen_on_all_interfaces = settings.web_proxy_listen_on_all_interfaces;
    update_web_server_configuration(app, settings, port, listen_on_all_interfaces)
}

fn set_web_proxy_listen_on_all_interfaces_blocking(
    app: &AppHandle,
    enabled: bool,
) -> Result<AppSettings, String> {
    let settings = read_app_settings(app)?;
    let port = settings.web_proxy_port;
    update_web_server_configuration(app, settings, port, enabled)
}

fn update_web_server_configuration(
    app: &AppHandle,
    mut settings: AppSettings,
    port: Option<u16>,
    listen_on_all_interfaces: bool,
) -> Result<AppSettings, String> {
    let desired_configuration = port.map(|port| WebServerConfiguration {
        port,
        listen_on_all_interfaces,
    });
    let previous_configuration = running_configuration();
    let saved_configuration_matches = settings.web_proxy_port == port
        && settings.web_proxy_listen_on_all_interfaces == listen_on_all_interfaces;
    if saved_configuration_matches && previous_configuration == desired_configuration {
        return Ok(settings);
    }

    apply_server_configuration(app, desired_configuration, previous_configuration)?;
    settings.web_proxy_port = port;
    settings.web_proxy_listen_on_all_interfaces = listen_on_all_interfaces;
    if let Err(error) = write_app_settings(app, &settings) {
        stop_server();
        let restore_error = restore_server(app, previous_configuration);
        return Err(configuration_error(
            format!("Failed to save the web version settings: {error}"),
            restore_error,
        ));
    }
    Ok(settings)
}

fn apply_server_configuration(
    app: &AppHandle,
    desired: Option<WebServerConfiguration>,
    previous: Option<WebServerConfiguration>,
) -> Result<(), String> {
    stop_server();
    if let Some(configuration) = desired {
        if let Err(error) = start_server(app.clone(), configuration) {
            let restore_error = restore_server(app, previous);
            return Err(configuration_error(error, restore_error));
        }
    }
    Ok(())
}

fn validate_port(port: u16) -> Result<(), String> {
    if port == 0 {
        return Err("Web version listening port must be between 1 and 65535".to_string());
    }
    Ok(())
}

fn configuration_error(error: String, restore_error: Option<String>) -> String {
    match restore_error {
        Some(restore_error) => {
            format!("{error}. The previous web server could not be restored: {restore_error}")
        }
        None => error,
    }
}

fn restore_server(
    app: &AppHandle,
    configuration: Option<WebServerConfiguration>,
) -> Option<String> {
    configuration.and_then(|configuration| start_server(app.clone(), configuration).err())
}

fn running_configuration() -> Option<WebServerConfiguration> {
    runtime()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|runtime| runtime.configuration))
}

fn start_server(app: AppHandle, configuration: WebServerConfiguration) -> Result<(), String> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| "Web server runtime lock is poisoned".to_string())?;
    if let Some(runtime) = guard.as_ref() {
        if runtime.configuration == configuration {
            return Ok(());
        }
        return Err(format!(
            "The web version is already listening on port {}",
            runtime.configuration.port
        ));
    }

    let host = web_server_host(configuration.listen_on_all_interfaces);
    let bind_address = format!("{host}:{}", configuration.port);
    let server =
        Arc::new(Server::http(&bind_address).map_err(|error| {
            format!("Failed to start the web version at {bind_address}: {error}")
        })?);
    let server_for_thread = server.clone();
    let handle = thread::Builder::new()
        .name(WEB_SERVER_THREAD_NAME.to_string())
        .spawn(move || {
            for request in server_for_thread.incoming_requests() {
                let request_app = app.clone();
                let _ = thread::Builder::new()
                    .name(WEB_REQUEST_THREAD_NAME.to_string())
                    .spawn(move || handle_request(request_app, request));
            }
        })
        .map_err(|error| format!("Failed to spawn the web version server: {error}"))?;

    *guard = Some(WebServerRuntime {
        configuration,
        server,
        handle: Some(handle),
    });
    Ok(())
}

fn web_server_host(listen_on_all_interfaces: bool) -> &'static str {
    if listen_on_all_interfaces {
        WEB_SERVER_ALL_INTERFACES_HOST
    } else {
        WEB_SERVER_LOOPBACK_HOST
    }
}

fn stop_server() {
    let running = runtime().lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut running) = running {
        running.server.unblock();
        if let Some(handle) = running.handle.take() {
            let _ = handle.join();
        }
    }
}

include!("requests.rs");
include!("dispatch_primary.rs");
include!("dispatch_extended.rs");
include!("dispatch_helpers.rs");
include!("responses.rs");
include!("tests.rs");
