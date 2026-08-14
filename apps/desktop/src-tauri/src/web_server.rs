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

const WEB_SERVER_HOST: &str = "127.0.0.1";
const WEB_SERVER_THREAD_NAME: &str = "codex-switch-web-server";
const WEB_REQUEST_THREAD_NAME: &str = "codex-switch-web-request";
const WEB_CONTENT_SECURITY_POLICY: &str = "default-src 'self'; img-src 'self' data: http: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' http: https: ws: wss:";
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
    port: u16,
    server: Arc<Server>,
    handle: Option<JoinHandle<()>>,
}

fn runtime() -> &'static Mutex<Option<WebServerRuntime>> {
    static RUNTIME: OnceLock<Mutex<Option<WebServerRuntime>>> = OnceLock::new();
    RUNTIME.get_or_init(|| Mutex::new(None))
}

pub(crate) fn setup(app: &AppHandle, port_override: Option<u16>) -> Result<(), String> {
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

pub(crate) fn restart_at_port(app: &AppHandle, port: u16) -> Result<(), String> {
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
pub(crate) fn set_web_proxy_port(app: AppHandle, port: Option<u16>) -> Result<AppSettings, String> {
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

fn restore_server(app: &AppHandle, port: Option<u16>) -> Option<String> {
    port.and_then(|port| start_server(app.clone(), port).err())
}

fn running_port() -> Option<u16> {
    runtime()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|runtime| runtime.port))
}

fn start_server(app: AppHandle, port: u16) -> Result<(), String> {
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

fn handle_request(app: AppHandle, request: Request) {
    if request.url().split('?').next() == Some(WEB_INVOKE_PATH) {
        handle_invoke_request(app, request);
        return;
    }

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

    let bytes = if is_index {
        inject_hosted_runtime_marker(asset.bytes.as_ref())
    } else {
        asset.bytes
    };
    let mut response = Response::from_data(bytes).with_status_code(StatusCode(200));
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

fn handle_invoke_request(app: AppHandle, mut request: Request) {
    if request.method() != &Method::Post {
        respond_text(request, StatusCode(405), "Method not allowed");
        return;
    }
    if !request.headers().iter().any(|header| {
        header.field.equiv("Content-Type") && header.value.as_str().starts_with("application/json")
    }) {
        respond_text(
            request,
            StatusCode(415),
            "Expected an application/json request",
        );
        return;
    }
    if request
        .body_length()
        .is_some_and(|length| length > MAX_INVOKE_BODY_BYTES)
    {
        respond_text(request, StatusCode(413), "Request body is too large");
        return;
    }

    let mut body = String::new();
    let read_result = request
        .as_reader()
        .take((MAX_INVOKE_BODY_BYTES + 1) as u64)
        .read_to_string(&mut body);
    if read_result.is_err() || body.len() > MAX_INVOKE_BODY_BYTES {
        respond_text(request, StatusCode(400), "Could not read the request body");
        return;
    }
    let invocation = match serde_json::from_str::<WebInvokeRequest>(&body) {
        Ok(invocation) => invocation,
        Err(error) => {
            respond_text(
                request,
                StatusCode(400),
                &format!("Invalid invoke request: {error}"),
            );
            return;
        }
    };
    let response = match dispatch_command(app, &invocation.command, invocation.args) {
        Ok(result) => WebInvokeResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => WebInvokeResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };
    respond_json(request, StatusCode(200), &response);
}

fn dispatch_command(app: AppHandle, command: &str, args: Value) -> Result<Value, String> {
    match command {
        "get_app_info" => serialize(crate::commands::get_app_info(app)),
        "list_accounts" => serialize(crate::commands::list_accounts(app)),
        "get_app_settings" => serialize(crate::floating_bubble::get_app_settings(app)),
        "set_web_proxy_port" => serialize(set_web_proxy_port(app, argument(&args, "port")?)),
        "list_providers" => serialize(crate::providers::list_providers(app)),
        "save_provider" => serialize(crate::providers::save_provider(
            app,
            argument(&args, "provider")?,
        )),
        "fetch_relay_models" => serialize(block_on(crate::provider_models::fetch_relay_models(
            argument(&args, "baseUrl")?,
            argument(&args, "apiKey")?,
        ))),
        "fetch_deepseek_models" => serialize(block_on(crate::providers::fetch_deepseek_models(
            app,
            argument(&args, "baseUrl")?,
            argument(&args, "apiKey")?,
            argument(&args, "providerId")?,
        ))),
        "query_provider_balance" => serialize(block_on(crate::providers::query_provider_balance(
            app,
            argument(&args, "id")?,
        ))),
        "query_provider_usage" => serialize(block_on(crate::providers::query_provider_usage(
            app,
            argument(&args, "id")?,
        ))),
        "switch_provider" => serialize(block_on(crate::providers::switch_provider(
            app,
            argument(&args, "id")?,
        ))),
        "switch_provider_model" => serialize(crate::providers::switch_provider_model(
            app,
            argument(&args, "id")?,
            argument(&args, "model")?,
        )),
        "set_provider_model_control" => serialize(crate::providers::set_provider_model_control(
            app,
            argument(&args, "id")?,
            argument(&args, "controlledByCodex")?,
        )),
        "set_provider_auto_switch_enabled" => {
            serialize(crate::providers::set_provider_auto_switch_enabled(
                app,
                argument(&args, "id")?,
                argument(&args, "enabled")?,
            ))
        }
        "disable_provider" => serialize(crate::providers::disable_provider(app)),
        "delete_provider" => serialize(crate::providers::delete_provider(
            app,
            argument(&args, "id")?,
        )),
        "get_local_proxy_status" => {
            serialize(block_on(crate::local_proxy::get_local_proxy_status(app)))
        }
        "list_proxy_sessions" => serialize(block_on(crate::local_proxy::list_proxy_sessions(app))),
        "list_proxy_session_requests" => serialize(block_on(
            crate::local_proxy::list_proxy_session_requests(argument(&args, "sessionId")?),
        )),
        "get_recent_proxy_session_latency" => serialize(block_on(
            crate::local_proxy::get_recent_proxy_session_latency(),
        )),
        "list_token_usage_entries" => {
            serialize(block_on(crate::local_proxy::list_token_usage_entries(app)))
        }
        "list_daily_token_usage" => serialize(block_on(
            crate::local_proxy::list_daily_token_usage(app, argument(&args, "startTs")?),
        )),
        "list_account_token_usage" => serialize(block_on(
            crate::local_proxy::list_account_token_usage(app, argument(&args, "startTs")?),
        )),
        "list_provider_token_usage" => serialize(block_on(
            crate::local_proxy::list_provider_token_usage(app, argument(&args, "startTs")?),
        )),
        "start_local_proxy" => serialize(block_on(crate::local_proxy::start_local_proxy(app))),
        "stop_local_proxy" => serialize(block_on(crate::local_proxy::stop_local_proxy(app))),
        "restore_non_proxy_conversations" => serialize(block_on(
            crate::commands::restore_non_proxy_conversations(app),
        )),
        "browse_codex_threads" => {
            serialize(crate::conversation_hub::browse_codex_threads_blocking(
                app,
                argument(&args, "titleQuery")?,
                argument(&args, "contentQuery")?,
            ))
        }
        "measure_codex_thread_tokens" => serialize(
            crate::conversation_hub::measure_codex_thread_tokens_blocking(
                app,
                argument(&args, "sessionIds")?,
            ),
        ),
        "discard_codex_threads" => {
            serialize(crate::conversation_hub::discard_codex_threads_blocking(
                app,
                argument(&args, "sessionIds")?,
            ))
        }
        "browse_codex_thread_bin" => serialize(
            crate::conversation_hub::browse_codex_thread_bin_blocking(app),
        ),
        "recover_codex_threads" => {
            serialize(crate::conversation_hub::recover_codex_threads_blocking(
                app,
                argument(&args, "sessionIds")?,
            ))
        }
        "purge_codex_threads" => serialize(crate::conversation_hub::purge_codex_threads_blocking(
            app,
            argument(&args, "sessionIds")?,
        )),
        "empty_codex_thread_bin" => serialize(
            crate::conversation_hub::empty_codex_thread_bin_blocking(app),
        ),
        "inspect_codex_thread_export" => serialize(
            crate::conversation_hub::inspect_codex_thread_export_blocking(
                app,
                argument(&args, "sessionIds")?,
            ),
        ),
        "pack_codex_threads" => serialize(crate::conversation_hub::pack_codex_threads_blocking(
            app,
            argument(&args, "sessionIds")?,
            argument(&args, "exportPath")?,
        )),
        "inspect_codex_thread_import" => serialize(
            crate::conversation_hub::inspect_codex_thread_import_blocking(
                app,
                argument(&args, "importPath")?,
            ),
        ),
        "unpack_codex_threads" => {
            serialize(crate::conversation_hub::unpack_codex_threads_blocking(
                app,
                argument(&args, "importPath")?,
                argument(&args, "sessionIds")?,
            ))
        }
        "reconcile_codex_thread_visibility" => serialize(
            crate::conversation_hub::reconcile_codex_thread_visibility_blocking(
                app,
                argument(&args, "mode")?,
                argument(&args, "sessionIds")?,
                argument(&args, "dryRun")?,
            ),
        ),
        "rebuild_codex_thread_index" => {
            serialize(crate::conversation_hub::rebuild_codex_thread_index_blocking(app))
        }
        "open_codex_thread_file" => {
            serialize(crate::conversation_hub::open_codex_thread_file_blocking(
                app,
                argument(&args, "sessionId")?,
                argument(&args, "folderOnly")?,
            ))
        }
        "set_auto_switch_on_quota_exhaustion" => {
            serialize(crate::local_proxy::set_auto_switch_on_quota_exhaustion(
                app,
                argument(&args, "enabled")?,
            ))
        }
        "set_concurrent_account_routing_enabled" => {
            serialize(crate::local_proxy::set_concurrent_account_routing_enabled(
                app,
                argument(&args, "enabled")?,
            ))
        }
        "set_auto_disable_unreachable_accounts" => {
            serialize(crate::local_proxy::set_auto_disable_unreachable_accounts(
                app,
                argument(&args, "enabled")?,
            ))
        }
        "set_custom_auto_switch_priority_enabled" => {
            serialize(crate::local_proxy::set_custom_auto_switch_priority_enabled(
                app,
                argument(&args, "enabled")?,
            ))
        }
        "set_image_generation_account" => serialize(
            crate::local_proxy::set_image_generation_account(app, argument(&args, "accountId")?),
        ),
        "set_local_proxy_openai_auth_account" => serialize(block_on(
            crate::local_proxy::set_local_proxy_openai_auth_account(
                app,
                argument(&args, "accountId")?,
            ),
        )),
        "set_local_proxy_listen_on_all_interfaces" => serialize(
            crate::local_proxy::set_local_proxy_listen_on_all_interfaces(
                app,
                argument(&args, "enabled")?,
                argument(&args, "apiKey")?,
            ),
        ),
        "copy_local_proxy_lan_api_key" => {
            serialize(crate::local_proxy::copy_local_proxy_lan_api_key(app))
        }
        "set_floating_bubble" => serialize(block_on(crate::floating_bubble::set_floating_bubble(
            app,
            argument(&args, "enabled")?,
        ))),
        "set_privacy_mode" => serialize(crate::floating_bubble::set_privacy_mode(
            app,
            argument(&args, "enabled")?,
        )),
        "set_hide_account_notes" => serialize(crate::floating_bubble::set_hide_account_notes(
            app,
            argument(&args, "enabled")?,
        )),
        "set_show_usage_network_errors" => serialize(
            crate::floating_bubble::set_show_usage_network_errors(app, argument(&args, "enabled")?),
        ),
        "set_token_usage_preferences" => {
            serialize(crate::floating_bubble::set_token_usage_preferences(
                app,
                argument(&args, "weeks")?,
                argument(&args, "refreshSeconds")?,
            ))
        }
        "set_auto_disable_status_codes" => serialize(
            crate::commands::set_auto_disable_status_codes(app, argument(&args, "statusCodes")?),
        ),
        "set_bubble_reset_display" => serialize(crate::floating_bubble::set_bubble_reset_display(
            app,
            argument(&args, "display")?,
        )),
        "set_bubble_style" => serialize(crate::floating_bubble::set_bubble_style(
            app,
            argument(&args, "style")?,
        )),
        "set_theme_color" => serialize(crate::floating_bubble::set_theme_color(
            app,
            argument(&args, "color")?,
        )),
        "set_app_language" => serialize(crate::floating_bubble::set_app_language(
            app,
            argument(&args, "language")?,
        )),
        "get_cloud_auth_state" => serialize(block_on(crate::cloud::get_cloud_auth_state(app))),
        "get_saved_cloud_login" => serialize(block_on(crate::cloud::get_saved_cloud_login(app))),
        "set_cloud_base_url" => serialize(block_on(crate::cloud::set_cloud_base_url(
            app,
            argument(&args, "baseUrl")?,
        ))),
        "cloud_login" => serialize(block_on(crate::cloud::cloud_login(
            app,
            argument(&args, "email")?,
            argument(&args, "password")?,
            argument(&args, "rememberPassword")?,
        ))),
        "fetch_cloud_announcement" => {
            serialize(block_on(crate::cloud::fetch_cloud_announcement(app)))
        }
        "fetch_cloud_notifications" => {
            serialize(block_on(crate::cloud::fetch_cloud_notifications(app)))
        }
        "fetch_cloud_faqs" => serialize(block_on(crate::cloud::fetch_cloud_faqs(app))),
        "cloud_request_registration_code" => serialize(block_on(
            crate::cloud::cloud_request_registration_code(app, argument(&args, "email")?),
        )),
        "cloud_register" => serialize(block_on(crate::cloud::cloud_register(
            app,
            argument(&args, "email")?,
            argument(&args, "password")?,
            argument(&args, "verificationCode")?,
            argument(&args, "rememberPassword")?,
        ))),
        "cloud_change_password" => serialize(block_on(crate::cloud::cloud_change_password(
            app,
            argument(&args, "currentPassword")?,
            argument(&args, "newPassword")?,
        ))),
        "cloud_logout" => serialize(block_on(crate::cloud::cloud_logout(app))),
        "cloud_sync_accounts" => serialize(block_on(crate::cloud::cloud_sync_accounts(app))),
        "cloud_push_accounts" => serialize(block_on(crate::cloud::cloud_push_accounts(app))),
        "cloud_push_account" => serialize(block_on(crate::cloud::cloud_push_account(
            app,
            argument(&args, "id")?,
        ))),
        "cloud_push_providers" => serialize(block_on(crate::cloud::cloud_push_providers(app))),
        "cloud_push_provider" => serialize(block_on(crate::cloud::cloud_push_provider(
            app,
            argument(&args, "id")?,
        ))),
        "cloud_delete_account" => serialize(block_on(crate::cloud::cloud_delete_account(
            app,
            argument(&args, "id")?,
        ))),
        "cloud_list_deleted_accounts" => {
            serialize(block_on(crate::cloud::cloud_list_deleted_accounts(app)))
        }
        "cloud_restore_deleted_account" => serialize(block_on(
            crate::cloud::cloud_restore_deleted_account(app, argument(&args, "id")?),
        )),
        "cloud_delete_provider" => serialize(block_on(crate::cloud::cloud_delete_provider(
            app,
            argument(&args, "id")?,
        ))),
        "list_market_skills" => serialize(block_on(crate::skills_market::list_market_skills(app))),
        "install_market_skill" => serialize(block_on(crate::skills_market::install_market_skill(
            app,
            argument(&args, "skill")?,
        ))),
        "list_official_plugins" => {
            serialize(block_on(crate::official_plugins::list_official_plugins()))
        }
        "install_official_plugin" => serialize(block_on(
            crate::official_plugins::install_official_plugin(argument(&args, "pluginId")?),
        )),
        "remove_official_plugin" => serialize(block_on(
            crate::official_plugins::remove_official_plugin(argument(&args, "pluginId")?),
        )),
        "switch_account_and_restart_chatgpt" => serialize(block_on(
            crate::commands::switch_account_and_restart_chatgpt(app, argument(&args, "id")?),
        )),
        "deactivate_account_and_restart_chatgpt" => serialize(block_on(
            crate::commands::deactivate_account_and_restart_chatgpt(app),
        )),
        "set_account_auto_switch_enabled" => {
            serialize(crate::commands::set_account_auto_switch_enabled(
                app,
                argument(&args, "id")?,
                argument(&args, "enabled")?,
            ))
        }
        "set_account_auto_switch_priority" => {
            serialize(crate::commands::set_account_auto_switch_priority(
                app,
                argument(&args, "id")?,
                argument(&args, "priority")?,
            ))
        }
        "refresh_usage" => serialize(block_on(crate::commands::refresh_usage(
            app,
            argument(&args, "id")?,
        ))),
        "consume_account_quota" => serialize(block_on(crate::commands::consume_account_quota(
            app,
            argument(&args, "id")?,
        ))),
        "delete_account" => serialize(crate::commands::delete_account(app, argument(&args, "id")?)),
        "update_account_note" => serialize(crate::commands::update_account_note(
            app,
            argument(&args, "id")?,
            argument(&args, "note")?,
            argument(&args, "expiresAt")?,
        )),
        "fetch_reset_credits" => serialize(block_on(crate::commands::fetch_reset_credits(
            app,
            argument(&args, "id")?,
        ))),
        "consume_reset_credit" => serialize(block_on(crate::commands::consume_reset_credit(
            app,
            argument(&args, "id")?,
        ))),
        "restart_chatgpt" => serialize(block_on(crate::commands::restart_chatgpt(app))),
        "launch_chatgpt" => serialize(block_on(crate::commands::launch_chatgpt(app))),
        "open_managed_folder" => serialize(crate::commands::open_managed_folder(
            app,
            argument(&args, "target")?,
        )),
        "get_dream_skin_status" => serialize(Ok(crate::dream_skin::get_dream_skin_status())),
        "get_dream_skin_resources_status" => {
            serialize(Ok(crate::dream_skin::get_dream_skin_resources_status()))
        }
        "retry_dream_skin_resources" => {
            serialize(Ok(crate::dream_skin::retry_dream_skin_resources()))
        }
        "install_dream_skin" => serialize(block_on(crate::dream_skin::install_dream_skin(app))),
        "apply_dream_skin_theme" => serialize(block_on(crate::dream_skin::apply_dream_skin_theme(
            app,
            argument(&args, "themeId")?,
        ))),
        "save_dream_skin_theme" => serialize(block_on(crate::dream_skin::save_dream_skin_theme(
            app,
            argument(&args, "name")?,
        ))),
        "set_dream_skin_appearance" => serialize(block_on(
            crate::dream_skin::set_dream_skin_appearance(app, argument(&args, "appearance")?),
        )),
        "set_dream_skin_paused" => serialize(block_on(crate::dream_skin::set_dream_skin_paused(
            app,
            argument(&args, "paused")?,
        ))),
        "reapply_dream_skin" => serialize(block_on(crate::dream_skin::reapply_dream_skin(app))),
        "verify_dream_skin" => serialize(block_on(crate::dream_skin::verify_dream_skin(app))),
        "restore_dream_skin" => serialize(block_on(crate::dream_skin::restore_dream_skin(app))),
        "open_dream_skin_folder" => serialize(crate::dream_skin::open_dream_skin_folder(app)),
        "get_dream_skin_theme_preview" => serialize(
            crate::dream_skin::get_dream_skin_theme_preview(argument(&args, "themeId")?),
        ),
        "get_dream_skin_market" => serialize(block_on(crate::dream_skin::get_dream_skin_market())),
        "install_dream_skin_market_theme" => serialize(block_on(
            crate::dream_skin::install_dream_skin_market_theme(argument(&args, "themeId")?),
        )),
        "get_dream_skin_community_page" => {
            serialize(block_on(crate::dream_skin::get_dream_skin_community_page(
                argument(&args, "offset")?,
                argument(&args, "limit")?,
            )))
        }
        "install_dream_skin_community_theme" => serialize(block_on(
            crate::dream_skin::install_dream_skin_community_theme(argument(&args, "versionId")?),
        )),
        _ => Err(format!(
            "Command is not available in the web version: {command}"
        )),
    }
}

fn argument<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|error| format!("Invalid argument {name}: {error}"))
}

fn serialize<T: Serialize>(result: Result<T, String>) -> Result<Value, String> {
    result.and_then(|value| {
        serde_json::to_value(value)
            .map_err(|error| format!("Could not serialize web command result: {error}"))
    })
}

fn block_on<T>(future: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    tauri::async_runtime::block_on(future)
}

fn inject_hosted_runtime_marker(bytes: &[u8]) -> Vec<u8> {
    let Ok(html) = std::str::from_utf8(bytes) else {
        return bytes.to_vec();
    };
    if html.contains(HOSTED_RUNTIME_MARKER) {
        return bytes.to_vec();
    }
    if let Some(index) = html.find("<head>") {
        let insert_at = index + "<head>".len();
        let mut output = String::with_capacity(html.len() + HOSTED_RUNTIME_MARKER.len());
        output.push_str(&html[..insert_at]);
        output.push_str(HOSTED_RUNTIME_MARKER);
        output.push_str(&html[insert_at..]);
        return output.into_bytes();
    }
    bytes.to_vec()
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

fn respond_json<T: Serialize>(request: Request, status: StatusCode, value: &T) {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| {
        serde_json::to_vec(&json!({
            "ok": false,
            "error": "Could not serialize the response"
        }))
        .expect("static JSON response must serialize")
    });
    let response = Response::from_data(body)
        .with_status_code(status)
        .with_header(header("Content-Type", "application/json; charset=utf-8"))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("X-Content-Type-Options", "nosniff"));
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

    #[test]
    fn hosted_index_includes_the_runtime_marker_once() {
        let source = b"<!doctype html><html><head></head><body></body></html>";
        let injected = inject_hosted_runtime_marker(source);
        let injected_again = inject_hosted_runtime_marker(&injected);
        let html = String::from_utf8(injected_again).unwrap();

        assert_eq!(html.matches(HOSTED_RUNTIME_MARKER).count(), 1);
    }
}
