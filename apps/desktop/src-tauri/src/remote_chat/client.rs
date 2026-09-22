use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use serde::Deserialize;
use tauri::{ipc::Channel, AppHandle, Manager, WebviewWindow};
use tokio::sync::{mpsc, watch, Mutex};

use super::{bridge::Batch, config::Config, protocol::Outgoing, AckRequest, ClientRequest};

const UNAVAILABLE: &str = "连接暂时不可用，请重新选择电脑。";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    pub(super) client_id: String,
    pub(super) device_id: String,
    pub(super) identity: crate::cloud::GuiCloudIdentity,
    pub(super) public_key: String,
    pub(super) resume: Option<ResumeRequest>,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResumeRequest {
    pub(super) session_id: String,
    resume_token: String,
}

impl OpenRequest {
    pub(super) fn matches(&self, config: &Config) -> bool {
        let expected_url = format!(
            "{}/device-chat",
            self.identity.base_url.trim_end_matches('/')
        )
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
        config.websocket_url == expected_url
            && config.device_id != self.device_id
            && serde_json::to_string(&self.identity.user_id)
                .is_ok_and(|owner| owner == config.owner)
    }

    pub(super) fn validate(&self) -> bool {
        uuid::Uuid::parse_str(&self.client_id).is_ok()
            && !self.device_id.is_empty()
            && self.device_id.len() <= 160
            && self.public_key.len() == 64
            && self.public_key.bytes().all(|b| b.is_ascii_hexdigit())
            && self.resume.as_ref().is_none_or(|resume| {
                !resume.session_id.is_empty()
                    && resume.session_id.len() <= 160
                    && !resume.resume_token.is_empty()
                    && resume.resume_token.len() <= 512
            })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSendRequest {
    client_id: String,
    message: Outgoing,
}

pub(super) enum ClientCommand {
    Send(Outgoing),
    Ack(u64),
}

struct ConnectionHandle {
    client_id: String,
    cancelled: Arc<AtomicBool>,
    commands: mpsc::Sender<ClientCommand>,
}

struct ClientState {
    connection: Mutex<Option<ConnectionHandle>>,
    configs: watch::Receiver<Option<Config>>,
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("请在主窗口选择电脑。".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn gui_remote_open(
    app: AppHandle,
    window: WebviewWindow,
    request: OpenRequest,
    events: Channel<Batch>,
) -> Result<(), String> {
    require_main(&window)?;
    if !request.validate() {
        return Err(UNAVAILABLE.into());
    }
    let state = app.try_state::<ClientState>().ok_or(UNAVAILABLE)?;
    let (commands, receiver) = mpsc::channel(super::protocol::COMMAND_LIMIT);
    let cancelled = Arc::new(AtomicBool::new(false));
    let handle = ConnectionHandle {
        client_id: request.client_id.clone(),
        cancelled: cancelled.clone(),
        commands,
    };
    if let Some(previous) = state.connection.lock().await.replace(handle) {
        previous.cancelled.store(true, Ordering::Release);
    }
    let configs = state.configs.clone();
    std::thread::spawn(move || {
        super::client_runtime::run(request, events, receiver, (configs, cancelled))
    });
    Ok(())
}

async fn submit(app: AppHandle, client_id: String, command: ClientCommand) -> Result<(), String> {
    let state = app.try_state::<ClientState>().ok_or(UNAVAILABLE)?;
    let sender = state
        .connection
        .lock()
        .await
        .as_ref()
        .filter(|connection| connection.client_id == client_id)
        .map(|connection| connection.commands.clone());
    if let Some(sender) = sender {
        sender.send(command).await.map_err(|_| UNAVAILABLE)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn gui_remote_send(
    app: AppHandle,
    window: WebviewWindow,
    request: RemoteSendRequest,
) -> Result<(), String> {
    require_main(&window)?;
    request.message.validate().map_err(|_| UNAVAILABLE)?;
    submit(app, request.client_id, ClientCommand::Send(request.message)).await
}

#[tauri::command]
pub(crate) async fn gui_remote_ack(
    app: AppHandle,
    window: WebviewWindow,
    request: AckRequest,
) -> Result<(), String> {
    require_main(&window)?;
    submit(app, request.client_id, ClientCommand::Ack(request.sequence)).await
}

#[tauri::command]
pub(crate) async fn gui_remote_close(
    app: AppHandle,
    window: WebviewWindow,
    request: ClientRequest,
) -> Result<(), String> {
    require_main(&window)?;
    let state = app.try_state::<ClientState>().ok_or(UNAVAILABLE)?;
    let mut connection = state.connection.lock().await;
    if connection
        .as_ref()
        .is_some_and(|connection| connection.client_id == request.client_id)
    {
        if let Some(previous) = connection.take() {
            previous.cancelled.store(true, Ordering::Release);
        }
    }
    Ok(())
}

pub(super) fn start<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    configs: watch::Receiver<Option<Config>>,
) {
    app.manage(ClientState {
        connection: Mutex::new(None),
        configs,
    });
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
