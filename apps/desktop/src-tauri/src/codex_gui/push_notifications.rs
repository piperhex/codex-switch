//! Content-free alerts originate in the app-server reader, independently of the main WebView.
use super::{
    protocol::GuiEvent,
    push_outbox::{self as outbox, OutboxError, Result},
};
use crate::cloud::PushIdentity;
use serde::Serialize;
use std::sync::{mpsc, OnceLock};
use std::time::Duration;
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Notice {
    pub thread_id: String,
    pub event_id: String,
    pub kind: String,
}

static WAKE: OnceLock<mpsc::SyncSender<()>> = OnceLock::new();
const RETRY_POLL: Duration = Duration::from_secs(5);

fn notice(event: &GuiEvent, session: &str) -> Option<Notice> {
    let thread_id = event.params.get("threadId")?.as_str()?.to_owned();
    let (event_id, kind) = if event.method == "turn/completed" {
        let turn = event.params.get("turn")?;
        let kind = match turn.get("status")?.as_str()? {
            "completed" => "completed",
            "failed" => "failed",
            _ => return None,
        };
        (turn.get("id")?.as_str()?.to_owned(), kind)
    } else if event.method.ends_with("/requestApproval")
        || event.method == "item/tool/requestUserInput"
    {
        let id = event.id.as_ref()?;
        let id = id
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| id.to_string());
        // Engine request IDs may be reused after a restart, even in the same thread.
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(format!("{session}:{id}"));
        (format!("request-{digest:x}"), "attention")
    } else if event.method == "item/completed" {
        let item = event.params.get("item")?;
        if item.get("delivery")?.as_str()? != "async"
            || item.get("questions")?.as_array()?.is_empty()
        {
            return None;
        }
        (
            format!("question-{}", item.get("id")?.as_str()?),
            "attention",
        )
    } else {
        return None;
    };
    Some(Notice {
        thread_id,
        event_id,
        kind: kind.into(),
    })
}

/// Share the same ID with live clients so local and remote alerts deduplicate.
pub(super) fn identify(event: &mut GuiEvent, session: &str) {
    if let Some(notice) = notice(event, session) {
        event.params["notificationEventId"] = notice.event_id.into();
    }
}

/// Persist on a blocking worker before publishing the corresponding GUI event.
pub(super) async fn receive(app: &tauri::AppHandle, event: &GuiEvent, session: &str) {
    let Some(notice) = notice(event, session) else {
        return;
    };
    let handle = app.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || persist(&handle, &notice)).await;
    match saved {
        Ok(Ok(())) => wake(),
        _ => {
            eprintln!("chat notification could not be saved");
            super::web::publish(
                app,
                "codex-gui-event",
                GuiEvent {
                    method: "chat/notifications/error".into(),
                    id: None,
                    params: serde_json::json!({}),
                },
            );
        }
    }
}

fn persist(app: &tauri::AppHandle, notice: &Notice) -> Result<()> {
    let Some(identity) = crate::cloud::push_identity(app).map_err(|_| OutboxError::Storage)? else {
        return Ok(());
    };
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| OutboxError::Storage)?;
    outbox::insert(&outbox::open(&root)?, &identity, notice)
}

fn wake() {
    if let Some(sender) = WAKE.get() {
        match sender.try_send(()) {
            Ok(()) | Err(mpsc::TrySendError::Full(())) => {} // Wake-ups coalesce; events are already on disk.
            Err(mpsc::TrySendError::Disconnected(())) => {
                eprintln!("chat notification worker stopped")
            }
        }
    }
}

/// Start at application startup so old events retry even before the next AI task.
pub(crate) fn start(app: &tauri::AppHandle) {
    WAKE.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel(1);
        let app = app.clone();
        std::thread::spawn(move || run(app, receiver));
        sender
    });
}

fn run(app: tauri::AppHandle, receiver: mpsc::Receiver<()>) {
    loop {
        if drain(&app).is_err() {
            eprintln!("chat notifications pending; will retry");
        }
        if matches!(
            receiver.recv_timeout(RETRY_POLL),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ) {
            break;
        }
    }
}

fn drain(app: &tauri::AppHandle) -> Result<()> {
    let Some(identity) = crate::cloud::push_identity(app).map_err(|_| OutboxError::Delivery)?
    else {
        return Ok(());
    };
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| OutboxError::Storage)?;
    let connection = outbox::open(&root)?;
    let entries = outbox::due(&connection, &identity, chrono::Utc::now().timestamp())?;
    if entries.is_empty() {
        return Ok(());
    }
    let client = crate::system_proxy::apply(reqwest::blocking::Client::builder())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| OutboxError::Delivery)?;
    for entry in entries {
        let delivered = match crate::cloud::push_access_token(app, &identity) {
            Ok(Some(token)) => send(&client, &identity, &token, &entry.notice).is_ok(),
            Ok(None) => return Ok(()),
            Err(_) => false,
        };
        if delivered {
            outbox::acknowledge(&connection, entry.id)?;
        } else {
            outbox::retry(&connection, &entry, chrono::Utc::now().timestamp())?;
        }
    }
    Ok(())
}

fn send(
    client: &reqwest::blocking::Client,
    identity: &PushIdentity,
    token: &str,
    notice: &Notice,
) -> Result<()> {
    let mut payload = serde_json::to_value(notice).map_err(|_| OutboxError::Delivery)?;
    payload["deviceId"] = identity.device_id.clone().into();
    let result = client
        .post(format!("{}/chat-push/events", identity.base_url))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .map_err(|_| OutboxError::Delivery)?;
    // Only the queue's commit acknowledgement permits deletion; a proxy/login page does not.
    if result.status() != reqwest::StatusCode::NO_CONTENT {
        return Err(OutboxError::Delivery);
    }
    Ok(())
}

#[cfg(test)]
#[path = "push_notifications_tests.rs"]
mod tests;
