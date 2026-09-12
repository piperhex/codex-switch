mod access;
pub(crate) mod account_selection;
#[cfg(test)]
mod attachment_tests;
mod attachment_uploads;
pub(crate) mod auto_switch_policy;
pub(crate) mod auto_switch_settings;
mod client;
pub(crate) mod clipboard;
mod computer_use_setup;
pub(crate) mod deletion;
mod error;
pub(crate) mod file_actions;
pub(crate) mod git;
mod goals;
mod home;
mod icons;
mod identity;
mod image_download;
mod image_preview;
mod image_thumbnail;
mod images;
mod message_edit;
pub(crate) mod model_settings;
mod platform;
pub(crate) mod plugin_client;
mod project_directories;
mod project_files;
mod prompt;
mod protocol;
pub(crate) mod releases;
#[cfg(test)]
mod tests;
mod text_preview;
pub(crate) mod undo;
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
    reuse_existing: Option<bool>,
) -> std::result::Result<Vec<GuiEvent>, String> {
    connect(app, &state, reuse_existing.unwrap_or(false), true)
        .await
        .map_err(|error| error.to_string())
}

/// Browser connections do not opt the host into desktop control installation.
pub(crate) async fn connect_web(
    app: AppHandle,
    state: State<'_, GuiState>,
    reuse_existing: Option<bool>,
) -> std::result::Result<Vec<GuiEvent>, String> {
    connect(app, &state, reuse_existing.unwrap_or(false), false)
        .await
        .map_err(|error| error.to_string())
}

async fn connect(
    app: AppHandle,
    state: &GuiState,
    reuse_existing: bool,
    setup_computer_use: bool,
) -> Result<Vec<GuiEvent>> {
    let mut current = state.client.lock().await;
    if let Some(client) = current.as_ref() {
        // A phone reconnect or transport switch must preserve idle, already loaded threads.
        if client.alive.load(Ordering::Acquire) && (reuse_existing || client.is_running().await) {
            return Ok(client.pending_approvals().await);
        }
        client.stop().await;
    }
    let (home, projectless_root) = prepare_paths(app.clone()).await?;
    let release_app = app.clone();
    let binary = tauri::async_runtime::spawn_blocking(move || releases::executable(&release_app))
        .await
        .map_err(|_| GuiError::Executable)??;
    if setup_computer_use {
        computer_use_setup::prepare(app.clone(), home.clone()).await;
    }
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
        if let GuiRequest::TextPreview { thread_id, path } = request {
            return text_preview::preview(&client, thread_id, path).await;
        }
        if let GuiRequest::ProjectFiles(options) = request {
            return project_files::list(&client, options).await;
        }
        if let GuiRequest::ProjectDirectories { directory } = request {
            return project_directories::list(directory).await;
        }
        if let GuiRequest::EditMessage(edit) = request {
            return message_edit::submit(&client, edit).await;
        }
        if let GuiRequest::ImagePreview {
            thread_id,
            source,
            variant,
        } = request
        {
            return image_preview::preview(&client, thread_id, source, variant).await;
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
