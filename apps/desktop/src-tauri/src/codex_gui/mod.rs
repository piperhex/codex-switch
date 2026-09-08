mod client;
mod error;
mod home;
mod platform;
mod protocol;
pub(crate) mod releases;
#[cfg(test)]
mod tests;
pub(crate) mod usage;

use std::{
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use client::Client;
use error::{GuiError, Result};
use protocol::{ApprovalReply, GuiEvent, GuiRequest, GuiResponse};

#[derive(Default)]
pub(crate) struct GuiState {
    client: Mutex<Option<Arc<Client>>>,
}

async fn home(app: AppHandle) -> Result<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || home::prepare(&app))
        .await
        .map_err(|_| GuiError::Startup)?
}

async fn connected(state: &GuiState) -> Result<Arc<Client>> {
    state
        .client
        .lock()
        .await
        .as_ref()
        .filter(|client| client.alive.load(Ordering::Acquire))
        .cloned()
        .ok_or(GuiError::Disconnected)
}

#[tauri::command]
pub(crate) async fn codex_gui_connect(
    app: AppHandle,
    state: State<'_, GuiState>,
) -> std::result::Result<Vec<GuiEvent>, String> {
    connect(app, &state)
        .await
        .map_err(|error| error.to_string())
}

async fn connect(app: AppHandle, state: &GuiState) -> Result<Vec<GuiEvent>> {
    let mut current = state.client.lock().await;
    if let Some(client) = current.as_ref() {
        if client.alive.load(Ordering::Acquire) && client.is_running().await {
            return Ok(client.pending_approvals().await);
        }
        client.stop().await;
    }
    let home = home(app.clone()).await?;
    let release_app = app.clone();
    let binary = tauri::async_runtime::spawn_blocking(move || releases::executable(&release_app))
        .await
        .map_err(|_| GuiError::Executable)??;
    *current = Some(Client::start(app, binary, home).await?);
    Ok(Vec::new())
}

#[tauri::command]
pub(crate) async fn codex_gui_request(
    state: State<'_, GuiState>,
    request: GuiRequest,
) -> std::result::Result<GuiResponse, String> {
    async {
        let client = connected(&state).await?;
        let (method, params) = tauri::async_runtime::spawn_blocking(move || request.into_rpc())
            .await
            .map_err(|_| GuiError::InvalidRequest)??;
        Ok(GuiResponse {
            data: client.request(method, params).await?,
        })
    }
    .await
    .map_err(|error: GuiError| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_respond(
    state: State<'_, GuiState>,
    reply: ApprovalReply,
) -> std::result::Result<(), String> {
    async { connected(&state).await?.respond(reply).await }
        .await
        .map_err(|error| error.to_string())
}

pub(crate) fn shutdown(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(client) = app.state::<GuiState>().client.lock().await.take() {
            client.stop().await;
        }
    });
}
