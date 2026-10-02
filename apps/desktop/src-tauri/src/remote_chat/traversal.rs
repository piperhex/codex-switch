//! Authenticated chat access to the shared traversal engine. No caller-supplied destinations or keys.
use std::{collections::HashMap, sync::Arc, time::Duration};

use csw_chat_connectivity::{Config, Connection, Event};
use serde::Deserialize;
use tauri::{ipc::Channel, AppHandle, Manager, Webview};
use tokio::sync::Mutex;

const UNAVAILABLE: &str = "暂时无法直连，正在尝试其他连接方式。";
const MAX_CONNECTIONS: usize = 8;

#[derive(Default)]
pub(crate) struct State(Mutex<HashMap<String, Arc<Connection>>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaRequest {
    id: String,
    view_id: String,
    action: MediaAction,
}
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum MediaAction {
    Open,
    Status,
    Close,
}

/// Uses an existing authenticated native handle, never caller-provided destinations or credentials.
#[tauri::command]
pub(crate) async fn remote_native_media(
    app: AppHandle,
    window: Webview,
    request: MediaRequest,
) -> Result<serde_json::Value, String> {
    authorize(&window)?;
    let connection = app
        .state::<State>()
        .0
        .lock()
        .await
        .get(&request.id)
        .cloned()
        .ok_or(UNAVAILABLE)?;
    let result = match request.action {
        MediaAction::Open => serde_json::to_value(
            connection
                .open_media(&request.view_id)
                .await
                .map_err(|_| UNAVAILABLE)?,
        ),
        MediaAction::Status => serde_json::to_value(
            connection
                .media_status(&request.view_id)
                .await
                .map_err(|_| UNAVAILABLE)?,
        ),
        MediaAction::Close => {
            connection.close_media(&request.view_id).await;
            Ok(serde_json::Value::Null)
        }
    };
    result.map_err(|_| UNAVAILABLE.into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    session_id: String,
}

#[derive(Deserialize)]
pub(crate) struct SendRequest {
    id: String,
    text: String,
}

async fn authorization(app: &AppHandle, session: String) -> Result<Config, String> {
    let state = app.state::<super::tcp::State>();
    let host = state.authority.clone();
    let client = state.client_authority.clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.native_config(&session)
            .or_else(|_| client.native_config(&session))
    })
    .await
    .map_err(|_| UNAVAILABLE.to_string())?
    .map_err(|_| UNAVAILABLE.to_string())
}

fn authorize(window: &Webview) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) async fn remote_native_path_open(
    app: AppHandle,
    window: Webview,
    request: OpenRequest,
    events: Channel<Event>,
) -> Result<String, String> {
    authorize(&window)?;
    let config = authorization(&app, request.session_id.clone()).await?;
    let state = app.state::<State>();
    let mut connections = state.0.lock().await;
    if connections.len() >= MAX_CONNECTIONS {
        return Err(UNAVAILABLE.into());
    }
    let connection = Connection::start(config).map_err(|_| UNAVAILABLE)?;
    let id = uuid::Uuid::new_v4().to_string();
    connections.insert(id.clone(), connection.clone());
    drop(connections);
    tauri::async_runtime::spawn(forward(
        app,
        id.clone(),
        request.session_id,
        (connection, events),
    ));
    Ok(id)
}

async fn forward(
    app: AppHandle,
    id: String,
    session: String,
    output: (Arc<Connection>, Channel<Event>),
) {
    let (connection, events) = output;
    let mut timer = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = timer.tick() => match authorization(&app, session.clone()).await {
                Ok(config) => if connection.renew(config.expires_at).is_err() { break; },
                Err(_) => break,
            },
            event = connection.receive() => {
                let Some(event) = event else { break; };
                let closed = matches!(event, Event::Closed);
                if events.send(event).is_err() || closed { break; }
            }
        }
    }
    connection.close();
    app.state::<State>().0.lock().await.remove(&id);
    // A disposed WebView has no receiver; its connection was still released above.
    if let Err(error) = events.send(Event::Closed) {
        eprintln!("Chat path receiver closed: {error}");
    }
}

#[tauri::command]
pub(crate) async fn remote_native_path_send(
    app: AppHandle,
    window: Webview,
    request: SendRequest,
) -> Result<(), String> {
    authorize(&window)?;
    let connection = app
        .state::<State>()
        .0
        .lock()
        .await
        .get(&request.id)
        .cloned()
        .ok_or(UNAVAILABLE)?;
    connection
        .send(request.text)
        .await
        .map_err(|_| UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) async fn remote_native_path_close(
    app: AppHandle,
    window: Webview,
    id: String,
) -> Result<(), String> {
    authorize(&window)?;
    if let Some(connection) = app.state::<State>().0.lock().await.remove(&id) {
        connection.close();
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn remote_chat_local_addresses(window: Webview) -> Result<Vec<String>, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(csw_chat_connectivity::local_addresses)
        .await
        .map_err(|_| UNAVAILABLE.to_string())?
        .map_err(|_| UNAVAILABLE.to_string())
}
