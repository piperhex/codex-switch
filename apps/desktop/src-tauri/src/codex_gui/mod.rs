mod access;
#[cfg(test)]
mod attachment_tests;
mod client;
pub(crate) mod deletion;
mod error;
mod goals;
mod home;
mod icons;
mod identity;
mod image_preview;
mod images;
mod message_edit;
mod platform;
pub(crate) mod plugin_client;
mod prompt;
mod protocol;
pub(crate) mod releases;
#[cfg(test)]
mod tests;
pub(crate) mod usage;
pub(crate) mod web;
mod workspaces;

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

async fn prepare_paths(app: AppHandle) -> Result<(PathBuf, PathBuf)> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok((home::prepare(&app)?, workspaces::prepare_root(&app)?))
    })
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
    let (home, projectless_root) = prepare_paths(app.clone()).await?;
    let release_app = app.clone();
    let binary = tauri::async_runtime::spawn_blocking(move || releases::executable(&release_app))
        .await
        .map_err(|_| GuiError::Executable)??;
    *current = Some(Client::start(app, binary, home, projectless_root).await?);
    Ok(Vec::new())
}

#[tauri::command]
pub(crate) async fn codex_gui_request(
    state: State<'_, GuiState>,
    request: GuiRequest,
) -> std::result::Result<GuiResponse, String> {
    async {
        let client = connected(&state).await?;
        if let GuiRequest::EditMessage(edit) = request {
            return message_edit::submit(&client, edit).await;
        }
        if let GuiRequest::ImagePreview { thread_id, source } = request {
            return image_preview::preview(&client, thread_id, source).await;
        }
        let projectless_root = client.projectless_root.clone();
        let response_root = projectless_root.clone();
        let (method, params) = tauri::async_runtime::spawn_blocking(move || {
            let mut request = request;
            workspaces::prepare_request(&mut request, &projectless_root)?;
            request.into_rpc()
        })
        .await
        .map_err(|_| GuiError::InvalidRequest)??;
        let mut data = icons::resolve(method, client.request(method, params).await?).await?;
        workspaces::hide_project_paths(&mut data, &response_root);
        Ok(GuiResponse { data })
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
