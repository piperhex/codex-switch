use super::{
    authority::Address,
    network,
    service::{Event, SocketCommand, MAX_BYTES},
    State,
};
use serde::Deserialize;
use tauri::{ipc::Channel, AppHandle, Manager, Webview};

const UNAVAILABLE: &str = "暂时无法直连，正在尝试其他连接方式。";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    session_id: String,
    generation: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PathRequest {
    group_id: String,
    ipv6: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectRequest {
    group_id: String,
    address: Address,
    ipv6: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SocketRequest {
    group_id: String,
    socket_id: String,
    action: SocketAction,
}
#[derive(Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "kebab-case")]
enum SocketAction {
    Write(Vec<u8>),
    Ack,
    Close,
}

fn authorize(window: &Webview) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) async fn remote_tcp_open(
    app: AppHandle,
    window: Webview,
    request: OpenRequest,
    events: Channel<Event>,
) -> Result<String, String> {
    authorize(&window)?;
    app.state::<State>()
        .open(request.session_id, request.generation, events)
        .await
        .map_err(|_| UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) async fn remote_tcp_listen(
    app: AppHandle,
    window: Webview,
    request: PathRequest,
) -> Result<u16, String> {
    authorize(&window)?;
    let group = app
        .state::<State>()
        .group(&request.group_id)
        .await
        .map_err(|_| UNAVAILABLE)?;
    network::listen(group, request.ipv6)
        .await
        .map_err(|_| UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) async fn remote_tcp_unlisten(
    app: AppHandle,
    window: Webview,
    request: PathRequest,
) -> Result<(), String> {
    authorize(&window)?;
    let group = app
        .state::<State>()
        .group(&request.group_id)
        .await
        .map_err(|_| UNAVAILABLE)?;
    if let Some((_, cancel)) = group.listeners.lock().await.remove(&request.ipv6) {
        cancel.send_replace(true);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn remote_tcp_connect(
    app: AppHandle,
    window: Webview,
    request: ConnectRequest,
) -> Result<String, String> {
    authorize(&window)?;
    app.state::<State>()
        .connect(&request.group_id, request.address, request.ipv6)
        .await
        .map_err(|_| UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) async fn remote_tcp_socket(
    app: AppHandle,
    window: Webview,
    request: SocketRequest,
) -> Result<(), String> {
    authorize(&window)?;
    let group = app
        .state::<State>()
        .group(&request.group_id)
        .await
        .map_err(|_| UNAVAILABLE)?;
    let command = match request.action {
        SocketAction::Write(data) if !data.is_empty() && data.len() <= MAX_BYTES => {
            return group
                .write(&request.socket_id, data)
                .await
                .map_err(|_| UNAVAILABLE.into());
        }
        SocketAction::Ack => SocketCommand::Ack,
        SocketAction::Close => SocketCommand::Close,
        _ => return Err(UNAVAILABLE.into()),
    };
    group
        .send(&request.socket_id, command)
        .await
        .map_err(|_| UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) async fn remote_tcp_close(
    app: AppHandle,
    window: Webview,
    group_id: String,
) -> Result<(), String> {
    authorize(&window)?;
    app.state::<State>().stop(&group_id).await;
    Ok(())
}
