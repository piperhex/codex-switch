use std::{
    sync::{Arc, Mutex, OnceLock},
    thread::{self, JoinHandle},
};

use tauri::{AppHandle, Runtime};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::{
    models::AppSettings,
    storage::{read_app_settings, write_app_settings},
};

const WEB_SERVER_HOST: &str = "127.0.0.1";
const WEB_SERVER_THREAD_NAME: &str = "codex-switch-web-server";
const WEB_REQUEST_THREAD_NAME: &str = "codex-switch-web-request";
const WEB_CONTENT_SECURITY_POLICY: &str = "default-src 'self'; img-src 'self' data: http: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' http: https: ws: wss:";

struct WebServerRuntime {
    port: u16,
    server: Arc<Server>,
    handle: Option<JoinHandle<()>>,
}

fn runtime() -> &'static Mutex<Option<WebServerRuntime>> {
    static RUNTIME: OnceLock<Mutex<Option<WebServerRuntime>>> = OnceLock::new();
    RUNTIME.get_or_init(|| Mutex::new(None))
}

pub(crate) fn setup<R: Runtime>(
    app: &AppHandle<R>,
    port_override: Option<u16>,
) -> Result<(), String> {
    let port = match port_override {
        Some(port) => Some(port),
        None => read_app_settings(app)?.web_proxy_port,
    };
    if let Some(port) = port {
        validate_port(port)?;
        start_server(app.clone(), port)?;
    }
    Ok(())
}

pub(crate) fn restart_at_port<R: Runtime>(app: &AppHandle<R>, port: u16) -> Result<(), String> {
    validate_port(port)?;
    let previous_port = running_port();
    if previous_port == Some(port) {
        return Ok(());
    }

    stop_server();
    if let Err(error) = start_server(app.clone(), port) {
        let restore_error = restore_server(app, previous_port);
        return Err(configuration_error(error, restore_error));
    }
    Ok(())
}

pub(crate) fn shutdown() {
    stop_server();
}

#[tauri::command]
pub(crate) fn set_web_proxy_port<R: Runtime>(
    app: AppHandle<R>,
    port: Option<u16>,
) -> Result<AppSettings, String> {
    if let Some(port) = port {
        validate_port(port)?;
    }

    let mut settings = read_app_settings(&app)?;
    let previous_saved_port = settings.web_proxy_port;
    let previous_running_port = running_port();
    if previous_saved_port == port && previous_running_port == port {
        return Ok(settings);
    }

    stop_server();
    if let Some(port) = port {
        if let Err(error) = start_server(app.clone(), port) {
            let restore_error = restore_server(&app, previous_running_port);
            return Err(configuration_error(error, restore_error));
        }
    }

    settings.web_proxy_port = port;
    if let Err(error) = write_app_settings(&app, &settings) {
        stop_server();
        let restore_error = restore_server(&app, previous_running_port);
        return Err(configuration_error(
            format!("Failed to save the web version port: {error}"),
            restore_error,
        ));
    }
    Ok(settings)
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

fn restore_server<R: Runtime>(app: &AppHandle<R>, port: Option<u16>) -> Option<String> {
    port.and_then(|port| start_server(app.clone(), port).err())
}

fn running_port() -> Option<u16> {
    runtime()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|runtime| runtime.port))
}

fn start_server<R: Runtime>(app: AppHandle<R>, port: u16) -> Result<(), String> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| "Web server runtime lock is poisoned".to_string())?;
    if let Some(runtime) = guard.as_ref() {
        if runtime.port == port {
            return Ok(());
        }
        return Err(format!(
            "The web version is already listening on port {}",
            runtime.port
        ));
    }

    let bind_address = format!("{WEB_SERVER_HOST}:{port}");
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
        port,
        server,
        handle: Some(handle),
    });
    Ok(())
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

fn handle_request<R: Runtime>(app: AppHandle<R>, request: Request) {
    if !matches!(request.method(), Method::Get | Method::Head) {
        respond_text(request, StatusCode(405), "Method not allowed");
        return;
    }

    let Some(path) = asset_path(request.url()) else {
        respond_text(request, StatusCode(400), "Invalid asset path");
        return;
    };
    let is_index = path == "index.html" || !path.contains('.');
    let asset = app.asset_resolver().get(path.clone()).or_else(|| {
        (!path.contains('.'))
            .then(|| app.asset_resolver().get("index.html".into()))
            .flatten()
    });
    let Some(asset) = asset else {
        respond_text(request, StatusCode(404), "Not found");
        return;
    };

    let mut response = Response::from_data(asset.bytes).with_status_code(StatusCode(200));
    response.add_header(header("Content-Type", &asset.mime_type));
    response.add_header(header(
        "Content-Security-Policy",
        WEB_CONTENT_SECURITY_POLICY,
    ));
    response.add_header(header("X-Content-Type-Options", "nosniff"));
    response.add_header(header("X-Frame-Options", "DENY"));
    response.add_header(header("Referrer-Policy", "no-referrer"));
    response.add_header(header(
        "Cache-Control",
        if is_index {
            "no-cache"
        } else {
            "public, max-age=31536000, immutable"
        },
    ));
    let _ = request.respond(response);
}

fn asset_path(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?.trim_start_matches('/');
    if path.is_empty() {
        return Some("index.html".to_string());
    }
    if path.contains('\\')
        || path
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return None;
    }
    Some(path.to_string())
}

fn respond_text(request: Request, status: StatusCode, message: &str) {
    let response = Response::from_string(message)
        .with_status_code(status)
        .with_header(header("Content-Type", "text/plain; charset=utf-8"))
        .with_header(header("Cache-Control", "no-store"));
    let _ = request.respond(response);
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes())
        .expect("static web server headers must be valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_paths_default_to_the_index_and_strip_queries() {
        assert_eq!(asset_path("/"), Some("index.html".to_string()));
        assert_eq!(
            asset_path("/assets/index.js?v=1"),
            Some("assets/index.js".to_string())
        );
    }

    #[test]
    fn asset_paths_reject_traversal_and_backslashes() {
        assert_eq!(asset_path("/../settings.json"), None);
        assert_eq!(asset_path("/assets\\index.js"), None);
        assert_eq!(asset_path("/assets//index.js"), None);
    }

    #[test]
    fn port_zero_is_invalid_and_the_default_is_disabled() {
        assert!(validate_port(0).is_err());
        assert!(validate_port(1).is_ok());
        assert!(AppSettings::default().web_proxy_port.is_none());
    }
}
