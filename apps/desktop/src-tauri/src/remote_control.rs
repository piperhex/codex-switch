use std::{
    io::ErrorKind,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    thread,
    time::{Duration, Instant},
};

use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use tauri::Runtime;
use tungstenite::{
    client, client_tls, connect, stream::MaybeTlsStream, Error as WebSocketError, Message,
    WebSocket,
};
use url::Url;

use crate::cloud::RemoteControlConfig;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ServerMessage {
    Authenticated {
        #[serde(rename = "deviceId")]
        _device_id: String,
    },
    SwitchAccount {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "accountId")]
        account_id: String,
    },
    SetOpenaiAuthAccount {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "accountId")]
        account_id: String,
    },
    SwitchProvider {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "providerId")]
        provider_id: String,
    },
    SwitchProviderGroup {
        #[serde(rename = "commandId")]
        command_id: String,
        group: String,
    },
    RestartCodex {
        #[serde(rename = "commandId")]
        command_id: String,
    },
}

pub(crate) fn start<R: Runtime>(app: tauri::AppHandle<R>) {
    thread::spawn(move || loop {
        match crate::cloud::remote_control_config(&app) {
            Ok(Some(config)) => {
                if let Err(error) = run_connection(&app, config) {
                    eprintln!("remote account control disconnected: {error}");
                }
            }
            Ok(None) => {}
            Err(error) => eprintln!("remote account control is unavailable: {error}"),
        }
        thread::sleep(Duration::from_secs(3));
    });
}

fn run_connection<R: Runtime>(
    app: &tauri::AppHandle<R>,
    config: RemoteControlConfig,
) -> Result<(), String> {
    let (mut socket, _) = connect_remote_websocket(&config.websocket_url)?;
    set_read_timeout(socket.get_mut(), Some(Duration::from_secs(2)))?;
    socket
        .send(Message::Text(
            json!({
                "type": "authenticate",
                "accessToken": config.access_token,
                "deviceId": config.device_id,
                "name": config.device_name,
                "platform": config.platform,
                "appVersion": config.app_version,
                "activeAccountId": config.active_account_id,
                "openaiAuthAccountId": config.openai_auth_account_id,
                "activeProviderId": config.active_provider_id,
                "activeProviderGroup": config.active_provider_group,
                "localProxyRunning": config.local_proxy_running,
                "capabilities": ["provider-switch", "provider-group-switch", "restart-codex"],
            })
            .to_string()
            .into(),
        ))
        .map_err(|error| format!("Could not authenticate WebSocket: {error}"))?;

    let mut last_ping = Instant::now();
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                let message = serde_json::from_str::<ServerMessage>(&text)
                    .map_err(|error| format!("Invalid remote control message: {error}"))?;
                match message {
                    ServerMessage::SwitchAccount {
                        command_id,
                        account_id,
                    } => handle_switch(app, &mut socket, command_id, account_id)?,
                    ServerMessage::SetOpenaiAuthAccount {
                        command_id,
                        account_id,
                    } => handle_openai_auth_switch(app, &mut socket, command_id, account_id)?,
                    ServerMessage::SwitchProvider {
                        command_id,
                        provider_id,
                    } => handle_provider_switch(app, &mut socket, command_id, provider_id)?,
                    ServerMessage::SwitchProviderGroup { command_id, group } => {
                        handle_provider_group_switch(app, &mut socket, command_id, group)?
                    }
                    ServerMessage::RestartCodex { command_id } => {
                        handle_codex_restart(app, &mut socket, command_id)?
                    }
                    ServerMessage::Authenticated { .. } => {}
                }
            }
            Ok(Message::Ping(payload)) => {
                socket
                    .send(Message::Pong(payload))
                    .map_err(|error| format!("Could not answer WebSocket ping: {error}"))?;
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(error.to_string()),
        }

        if last_ping.elapsed() >= Duration::from_secs(20) {
            socket
                .send(Message::Ping(Vec::new().into()))
                .map_err(|error| format!("Could not send WebSocket ping: {error}"))?;
            last_ping = Instant::now();
        }

        let next = crate::cloud::remote_control_config(app)?;
        if next.as_ref().is_none_or(|next| {
            next.websocket_url != config.websocket_url
                || next.access_token != config.access_token
                || next.active_account_id != config.active_account_id
                || next.openai_auth_account_id != config.openai_auth_account_id
                || next.active_provider_id != config.active_provider_id
                || next.active_provider_group != config.active_provider_group
                || next.local_proxy_running != config.local_proxy_running
        }) {
            let _ = socket.close(None);
            return Ok(());
        }
    }
}

fn connect_remote_websocket(
    websocket_url: &str,
) -> Result<
    (
        WebSocket<MaybeTlsStream<TcpStream>>,
        tungstenite::handshake::client::Response,
    ),
    String,
> {
    let target = Url::parse(websocket_url)
        .map_err(|error| format!("Invalid remote control WebSocket URL: {error}"))?;
    let proxy_target = proxy_lookup_url(&target)?;
    let Some(proxy_url) = crate::system_proxy::proxy_for_target(&proxy_target) else {
        return connect(websocket_url)
            .map_err(|error| format!("WebSocket connection failed: {error}"));
    };
    if proxy_url.scheme() != "http" {
        return Err(
            "Remote control requires an HTTP system proxy; HTTPS proxy endpoints are not supported"
                .to_string(),
        );
    }
    let stream = connect_http_proxy_tunnel(&target, &proxy_url)?;
    let result = if target.scheme() == "wss" {
        client_tls(websocket_url, stream)
    } else {
        client(websocket_url, MaybeTlsStream::Plain(stream))
    };
    result.map_err(|error| format!("WebSocket handshake failed: {error}"))
}

fn proxy_lookup_url(target: &Url) -> Result<Url, String> {
    let mut lookup = target.clone();
    let scheme = match target.scheme() {
        "ws" => "http",
        "wss" => "https",
        _ => return Err("Remote control URL must use ws:// or wss://".to_string()),
    };
    lookup
        .set_scheme(scheme)
        .map_err(|_| "Could not prepare the WebSocket proxy lookup URL".to_string())?;
    Ok(lookup)
}

fn connect_http_proxy_tunnel(target: &Url, proxy: &Url) -> Result<TcpStream, String> {
    let proxy_host = proxy
        .host_str()
        .ok_or_else(|| "The configured WebSocket proxy has no host".to_string())?;
    let proxy_port = proxy
        .port_or_known_default()
        .ok_or_else(|| "The configured WebSocket proxy has no port".to_string())?;
    let target_host = target
        .host_str()
        .ok_or_else(|| "The remote control URL has no host".to_string())?;
    let target_port = target
        .port_or_known_default()
        .ok_or_else(|| "The remote control URL has no port".to_string())?;
    let target_authority = format_authority(target_host, target_port);
    let proxy_address = (proxy_host, proxy_port)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve the WebSocket proxy: {error}"))?
        .next()
        .ok_or_else(|| "Could not resolve the WebSocket proxy".to_string())?;
    let mut stream = TcpStream::connect_timeout(&proxy_address, Duration::from_secs(10))
        .map_err(|error| format!("Could not connect to the WebSocket proxy: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| format!("Could not configure the WebSocket proxy timeout: {error}"))?;
    let mut request = format!(
        "CONNECT {target_authority} HTTP/1.1\r\nHost: {target_authority}\r\nConnection: keep-alive\r\n"
    );
    if !proxy.username().is_empty() || proxy.password().is_some() {
        let username = percent_decode(proxy.username());
        let password = percent_decode(proxy.password().unwrap_or_default());
        let credentials =
            base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"));
        request.push_str(&format!("Proxy-Authorization: Basic {credentials}\r\n"));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Could not establish the WebSocket proxy tunnel: {error}"))?;
    let status = read_proxy_connect_status(&mut stream)?;
    if status != 200 {
        return Err(format!(
            "WebSocket proxy rejected CONNECT with HTTP {status}"
        ));
    }
    Ok(stream)
}

fn read_proxy_connect_status(stream: &mut TcpStream) -> Result<u16, String> {
    const MAX_PROXY_HEADER_BYTES: usize = 16 * 1024;
    let mut response = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    while response.len() < MAX_PROXY_HEADER_BYTES {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("Could not read the WebSocket proxy response: {error}"))?;
        if read == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "The WebSocket proxy returned an incomplete CONNECT response".to_string())?;
    let status_header = String::from_utf8_lossy(&response[..header_end]);
    let status_line = status_header
        .lines()
        .next()
        .ok_or_else(|| "The WebSocket proxy returned an invalid CONNECT response".to_string())?;
    status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "The WebSocket proxy returned an invalid HTTP status".to_string())
}

fn format_authority(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn percent_decode(value: &str) -> String {
    url::form_urlencoded::parse(value.as_bytes())
        .map(|(key, _)| key)
        .next()
        .map(|value| value.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn handle_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    account_id: String,
) -> Result<(), String> {
    let result =
        crate::commands::switch_account_and_restart_chatgpt_blocking(app.clone(), account_id);
    send_command_result(socket, command_id, result, "account switch")
}

fn handle_openai_auth_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    account_id: String,
) -> Result<(), String> {
    let result = crate::local_proxy::set_local_proxy_openai_auth_account_blocking(
        app.clone(),
        Some(account_id),
    )
    .map(|_| ());
    send_command_result(socket, command_id, result, "OpenAI login account switch")
}

fn handle_provider_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    provider_id: String,
) -> Result<(), String> {
    let result = crate::providers::switch_provider_blocking(app.clone(), provider_id);
    send_command_result(socket, command_id, result, "Provider switch")
}

fn handle_provider_group_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    group: String,
) -> Result<(), String> {
    let result = crate::providers::switch_provider_group_blocking(app.clone(), group);
    send_command_result(socket, command_id, result, "Provider group switch")
}

fn handle_codex_restart<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
) -> Result<(), String> {
    let result = crate::commands::restart_chatgpt_blocking(app.clone());
    send_command_result(socket, command_id, result, "Codex restart")
}

fn send_command_result(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    result: Result<(), String>,
    context: &str,
) -> Result<(), String> {
    let response = match result {
        Ok(()) => json!({
            "type": "switch-result",
            "commandId": command_id,
            "success": true,
        }),
        Err(error) => json!({
            "type": "switch-result",
            "commandId": command_id,
            "success": false,
            "error": error,
        }),
    };
    socket
        .send(Message::Text(response.to_string().into()))
        .map_err(|error| format!("Could not send {context} result: {error}"))
}

fn set_read_timeout(
    stream: &mut MaybeTlsStream<TcpStream>,
    timeout: Option<Duration>,
) -> Result<(), String> {
    match stream {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(timeout),
        MaybeTlsStream::Rustls(stream) => stream.sock.set_read_timeout(timeout),
        _ => Ok(()),
    }
    .map_err(|error| format!("Could not configure WebSocket timeout: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{format_authority, proxy_lookup_url, ServerMessage};

    #[test]
    fn formats_websocket_proxy_authorities() {
        assert_eq!(format_authority("example.com", 443), "example.com:443");
        assert_eq!(format_authority("2001:db8::1", 443), "[2001:db8::1]:443");
    }

    #[test]
    fn maps_websocket_urls_to_http_proxy_lookup_urls() {
        let secure = proxy_lookup_url(&url::Url::parse("wss://example.com/socket").unwrap())
            .expect("secure websocket URL should map");
        assert_eq!(secure.as_str(), "https://example.com/socket");

        let plain = proxy_lookup_url(&url::Url::parse("ws://example.com/socket").unwrap())
            .expect("plain websocket URL should map");
        assert_eq!(plain.as_str(), "http://example.com/socket");
    }

    #[test]
    fn parses_provider_switch_and_restart_commands() {
        let provider = serde_json::from_str::<ServerMessage>(
            r#"{"type":"switch-provider","commandId":"command-1","providerId":"provider-1"}"#,
        )
        .expect("provider command should deserialize");
        assert!(matches!(
            provider,
            ServerMessage::SwitchProvider {
                command_id,
                provider_id,
            } if command_id == "command-1" && provider_id == "provider-1"
        ));

        let group = serde_json::from_str::<ServerMessage>(
            r#"{"type":"switch-provider-group","commandId":"command-g","group":"Work"}"#,
        )
        .expect("Provider group command should deserialize");
        assert!(matches!(
            group,
            ServerMessage::SwitchProviderGroup { command_id, group }
                if command_id == "command-g" && group == "Work"
        ));

        let restart = serde_json::from_str::<ServerMessage>(
            r#"{"type":"restart-codex","commandId":"command-2"}"#,
        )
        .expect("restart command should deserialize");
        assert!(matches!(
            restart,
            ServerMessage::RestartCodex { command_id } if command_id == "command-2"
        ));
    }
}
