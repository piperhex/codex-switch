//! Bridges authenticated device commands to the main window's shared updater.
use std::{collections::HashMap, sync::mpsc, time::Instant};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener, Runtime};

const REQUEST_EVENT: &str = "remote-app-update-request";
const RESULT_EVENT: &str = "remote-app-update-result";
const REQUEST_LIFETIME_SECONDS: u64 = 40;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum UpdateAction {
    Status,
    Check,
    Install,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRequest {
    command_id: String,
    action: UpdateAction,
    version: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum UpdatePhase {
    Idle,
    Checking,
    Available,
    Downloading,
    Installing,
    Error,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    current_version: String,
    latest_version: Option<String>,
    notes: Option<String>,
    phase: UpdatePhase,
    progress: Option<f64>,
    error: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResult {
    command_id: String,
    data: Option<UpdateStatus>,
    error: Option<String>,
}

pub(super) struct UpdateBridge<R: Runtime> {
    app: tauri::AppHandle<R>,
    listener: tauri::EventId,
    receiver: mpsc::Receiver<UpdateResult>,
    pending: HashMap<String, Instant>,
}

impl<R: Runtime> UpdateBridge<R> {
    pub(super) fn new(app: &tauri::AppHandle<R>) -> Self {
        let (sender, receiver) = mpsc::sync_channel(16);
        let listener = app.listen(RESULT_EVENT, move |event| {
            if let Ok(result) = serde_json::from_str::<UpdateResult>(event.payload()) {
                if sender.try_send(result).is_err() {
                    eprintln!("remote update reply queue is unavailable");
                }
            }
        });
        Self {
            app: app.clone(),
            listener,
            receiver,
            pending: HashMap::new(),
        }
    }

    pub(super) fn request(
        &mut self,
        command_id: String,
        action: UpdateAction,
        version: Option<String>,
    ) -> Result<(), String> {
        if !valid_request(&command_id, &action, version.as_deref()) {
            return Err("Invalid remote update request".into());
        }
        self.prune();
        if self.pending.len() >= 16 {
            return Err("Too many remote update requests".into());
        }
        self.pending.insert(command_id.clone(), Instant::now());
        self.app
            .emit_to(
                "main",
                REQUEST_EVENT,
                UpdateRequest {
                    command_id,
                    action,
                    version,
                },
            )
            .map_err(|error| error.to_string())
    }

    pub(super) fn responses(&mut self) -> Vec<serde_json::Value> {
        self.prune();
        self.receiver
            .try_iter()
            .filter_map(|reply| {
                self.pending.remove(&reply.command_id)?;
                Some(serde_json::json!({
                    "type": "app-update-result", "commandId": reply.command_id,
                    "data": reply.data, "error": reply.error,
                }))
            })
            .collect()
    }

    fn prune(&mut self) {
        self.pending
            .retain(|_, started| started.elapsed().as_secs() < REQUEST_LIFETIME_SECONDS);
    }
}

fn valid_request(id: &str, action: &UpdateAction, version: Option<&str>) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && match action {
            UpdateAction::Install => {
                version.is_some_and(|value| !value.is_empty() && value.len() <= 80)
            }
            _ => true,
        }
}

impl<R: Runtime> Drop for UpdateBridge<R> {
    fn drop(&mut self) {
        self.app.unlisten(self.listener);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_requires_a_bounded_version() {
        assert!(valid_request("request", &UpdateAction::Status, None));
        assert!(valid_request(
            "request",
            &UpdateAction::Install,
            Some("1.6.0")
        ));
        assert!(!valid_request("request", &UpdateAction::Install, None));
        assert!(!valid_request("request", &UpdateAction::Install, Some("")));
        assert!(!valid_request("", &UpdateAction::Check, None));
        assert!(serde_json::from_str::<UpdateAction>(r#""execute""#).is_err());
    }
}
