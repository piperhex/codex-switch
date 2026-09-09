use serde_json::{json, Value};
use tauri::{AppHandle, State};

use super::{
    connected,
    error::{GuiError, Result},
    protocol::{GuiEvent, GuiRequest},
    GuiState,
};
use crate::conversation_hub::{self, MutationReport, ThreadContext};

/// Deletes only from the built-in GUI home, including for authenticated LAN clients.
#[tauri::command]
pub(crate) async fn codex_gui_delete_thread(
    app: AppHandle,
    state: State<'_, GuiState>,
    thread_id: String,
) -> std::result::Result<MutationReport, String> {
    delete_thread(app, &state, thread_id)
        .await
        .map_err(|error| error.to_string())
}

async fn delete_thread(
    app: AppHandle,
    state: &GuiState,
    thread_id: String,
) -> Result<MutationReport> {
    let (method, params) = GuiRequest::Read {
        thread_id: thread_id.clone(),
    }
    .into_rpc()?;
    let client = connected(state).await?;
    ensure_idle(&client.request(method, params).await?)?;
    client
        .request("thread/unsubscribe", json!({ "threadId": thread_id }))
        .await?;
    let worker_app = app.clone();
    let id = thread_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let context = ThreadContext::new(
            worker_app,
            Some(crate::codex_home::GUI_CODEX_HOME_ID.into()),
        )?;
        conversation_hub::discard_codex_threads_blocking(context, vec![id])
    })
    .await
    .map_err(|_| GuiError::Delete)?;
    let report = result.map_err(|error| {
        eprintln!("Unable to move GUI conversation to trash: {error}");
        GuiError::Delete
    })?;
    super::web::publish(
        &app,
        "codex-gui-event",
        GuiEvent {
            method: "thread/deleted".into(),
            params: json!({ "threadId": thread_id }),
            id: None,
        },
    );
    Ok(report)
}

fn ensure_idle(response: &Value) -> Result<()> {
    let thread = response
        .get("thread")
        .filter(|thread| thread.is_object())
        .ok_or(GuiError::Rpc)?;
    let active = thread.pointer("/status/type").and_then(Value::as_str) == Some("active")
        || thread
            .get("turns")
            .and_then(Value::as_array)
            .is_some_and(|turns| {
                turns
                    .iter()
                    .any(|turn| turn.get("status").and_then(Value::as_str) == Some("inProgress"))
            });
    if active {
        return Err(GuiError::Busy);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletion_rejects_active_or_invalid_threads() {
        assert!(ensure_idle(&json!({})).is_err());
        assert!(ensure_idle(&json!({"thread": {"status": {"type": "active"}}})).is_err());
        assert!(ensure_idle(&json!({"thread": {"turns": [{"status": "inProgress"}]}})).is_err());
        assert!(ensure_idle(&json!({"thread": {"turns": [{"status": "completed"}]}})).is_ok());
    }
}
