use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::storage::{read_state, resolve_paths, write_state};

const WEB_LAN_API_KEY_BYTES: usize = 32;
const WEB_LAN_API_KEY_PREFIX: &str = "csw_";
const AUTHORIZATION_BEARER_PREFIX: &str = "bearer ";

#[derive(Clone, Copy, PartialEq, Eq)]
enum WebRequestAccess {
    Loopback,
    Lan,
}

#[derive(Clone)]
struct WebRequestSecurity {
    lan_api_key: Option<Arc<str>>,
}

impl WebRequestSecurity {
    fn from_configuration(configuration: &WebServerConfiguration) -> Result<Self, String> {
        if configuration.listen_on_all_interfaces && configuration.lan_api_key.is_none() {
            return Err("LAN access requires an API key".to_string());
        }
        Ok(Self {
            lan_api_key: configuration.lan_api_key.as_deref().map(Arc::from),
        })
    }

    fn authorize(&self, request: &Request) -> Result<WebRequestAccess, StatusCode> {
        if request
            .remote_addr()
            .is_some_and(|address| address.ip().is_loopback())
        {
            return Ok(WebRequestAccess::Loopback);
        }
        if !same_origin_request(request) {
            return Err(StatusCode(403));
        }
        let expected = self.lan_api_key.as_deref().ok_or(StatusCode(401))?;
        request_has_valid_api_key(request, expected)
            .then_some(WebRequestAccess::Lan)
            .ok_or(StatusCode(401))
    }
}

impl WebRequestAccess {
    fn allows_command(self, command: &str) -> bool {
        self == Self::Loopback || LAN_COMMAND_ALLOWLIST.contains(&command)
    }
}

fn generate_web_lan_api_key() -> String {
    let mut bytes = [0_u8; WEB_LAN_API_KEY_BYTES];
    rand::rng().fill_bytes(&mut bytes);
    format!("{WEB_LAN_API_KEY_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes))
}

fn stored_web_lan_api_key(app: &AppHandle) -> Result<Option<String>, String> {
    let state = read_state(&resolve_paths(app)?);
    Ok(state
        .web_proxy_lan_api_key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty()))
}

fn write_web_lan_api_key(app: &AppHandle, api_key: Option<String>) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    let mut state = read_state(&paths);
    state.web_proxy_lan_api_key = api_key;
    write_state(&paths, &state)
}

fn configuration_for_settings(
    app: &AppHandle,
    port: u16,
    settings: &AppSettings,
) -> Result<WebServerConfiguration, String> {
    let lan_api_key = if settings.web_proxy_listen_on_all_interfaces {
        match stored_web_lan_api_key(app)? {
            Some(key) => Some(key),
            None => {
                let key = generate_web_lan_api_key();
                write_web_lan_api_key(app, Some(key.clone()))?;
                Some(key)
            }
        }
    } else {
        None
    };
    Ok(WebServerConfiguration {
        port,
        listen_on_all_interfaces: settings.web_proxy_listen_on_all_interfaces,
        lan_api_key,
    })
}

fn prepare_configuration(
    port: Option<u16>,
    listen_on_all_interfaces: bool,
    lan_api_key: Option<String>,
) -> Option<WebServerConfiguration> {
    port.map(|port| WebServerConfiguration {
        port,
        listen_on_all_interfaces,
        lan_api_key,
    })
}

#[tauri::command]
pub(crate) async fn copy_web_proxy_lan_api_key(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let key = stored_web_lan_api_key(&app)?
            .ok_or_else(|| "LAN access key is not available".to_string())?;
        app.clipboard()
            .write_text(key)
            .map_err(|error| format!("Could not copy the LAN access key: {error}"))
    })
    .await
    .map_err(|error| format!("Could not copy the LAN access key: {error}"))?
}

fn request_has_valid_api_key(request: &Request, expected: &str) -> bool {
    let header_key_matches = request_header(request, "X-API-Key")
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .is_some_and(|actual| constant_time_equal(expected, actual));
    let bearer_key_matches = request_header(request, "Authorization")
        .map(str::trim)
        .and_then(bearer_token)
        .is_some_and(|actual| constant_time_equal(expected, actual));
    header_key_matches || bearer_key_matches
}

fn bearer_token(value: &str) -> Option<&str> {
    let prefix = value.get(..AUTHORIZATION_BEARER_PREFIX.len())?;
    prefix
        .eq_ignore_ascii_case(AUTHORIZATION_BEARER_PREFIX)
        .then(|| value[AUTHORIZATION_BEARER_PREFIX.len()..].trim())
        .filter(|token| !token.is_empty())
}

fn constant_time_equal(expected: &str, actual: &str) -> bool {
    let expected = expected.as_bytes();
    let actual = actual.as_bytes();
    expected.len() == actual.len()
        && expected
            .iter()
            .zip(actual)
            .fold(0_u8, |difference, (left, right)| difference | (left ^ right))
            == 0
}

fn same_origin_request(request: &Request) -> bool {
    let Some(origin) = request_header(request, "Origin") else {
        return true;
    };
    let Some(host) = request_header(request, "Host") else {
        return false;
    };
    same_origin_values(Some(origin), Some(host))
}

fn same_origin_values(origin: Option<&str>, host: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return true;
    };
    let Some(host) = host else {
        return false;
    };
    url::Url::parse(origin).ok().is_some_and(|url| {
        url.scheme() == "http"
            && url.origin().ascii_serialization() == format!("http://{}", host.trim())
    })
}

fn request_header<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str())
}

const LAN_COMMAND_ALLOWLIST: &[&str] = &[
    "fetch_cloud_announcement",
    "fetch_cloud_currency_rates",
    "fetch_cloud_faqs",
    "fetch_cloud_notifications",
    "get_app_info",
    "get_app_settings",
    "get_cloud_auth_state",
    "get_codex_connection_status",
    "get_dream_skin_community_page",
    "get_dream_skin_market",
    "get_dream_skin_resources_status",
    "get_dream_skin_status",
    "get_local_proxy_status",
    "get_recent_proxy_session_latency",
    "list_account_token_usage",
    "list_accounts",
    "list_aggregate_apis",
    "list_daily_token_usage",
    "list_market_skills",
    "list_prompt_plugins",
    "list_official_plugins",
    "list_provider_token_usage",
    "list_providers",
    "list_proxy_session_requests",
    "get_proxy_conversation_attachment",
    "list_proxy_sessions",
    "list_token_usage_entries",
    "list_token_usage_entries_since",
    "query_provider_balance",
    "query_provider_usage",
];
