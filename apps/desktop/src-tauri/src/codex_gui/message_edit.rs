//! Replace the latest user message within its existing conversation.
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    client::Client,
    error::{GuiError, Result},
    protocol::{id, thread_params, AccessMode, GuiRequest, GuiResponse},
    workspaces,
};

#[cfg(test)]
#[path = "message_edit_tests.rs"]
mod tests;

const MAX_EDIT_BYTES: usize = 256_000;
// Keep the continue button's hidden instruction aligned with the message list.
const CONTINUE_MESSAGE: &str = "请继续完成刚才中断的任务。";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditRequest {
    thread_id: String,
    turn_id: String,
    item_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access: AccessMode,
    cwd: Option<String>,
}

fn validate(edit: &EditRequest) -> Result<()> {
    id(&edit.thread_id)?;
    id(&edit.turn_id)?;
    id(&edit.item_id)?;
    if edit.text.trim().is_empty() || edit.text.len() > MAX_EDIT_BYTES {
        return Err(GuiError::InvalidRequest);
    }
    Ok(())
}

fn latest_message(turns: &[Value]) -> Option<(&Value, &Value)> {
    turns.iter().enumerate().rev().find_map(|(index, turn)| {
        let mut users = turn["items"]
            .as_array()?
            .iter()
            .filter(|item| item["type"] == "userMessage");
        let first = users.next()?;
        let hidden = index > 0
            && turns[index - 1]["status"] == "interrupted"
            && first["content"].as_array().is_some_and(|parts| {
                parts.len() == 1
                    && parts[0]["type"] == "text"
                    && parts[0]["text"] == CONTINUE_MESSAGE
            });
        users
            .next_back()
            .or(if hidden { None } else { Some(first) })
            .map(|item| (turn, item))
    })
}

fn edited_input(thread: &Value, edit: &EditRequest) -> Result<Vec<Value>> {
    let turns = thread["turns"].as_array().ok_or(GuiError::InvalidRequest)?;
    if thread["status"]["type"] == "active"
        || turns.iter().any(|turn| turn["status"] == "inProgress")
    {
        return Err(GuiError::InvalidRequest);
    }
    let (turn, item) = latest_message(turns).ok_or(GuiError::InvalidRequest)?;
    if turn["id"] != edit.turn_id || item["id"] != edit.item_id {
        return Err(GuiError::InvalidRequest);
    }
    let mut input = Vec::new();
    // Steering messages share a server turn. Replay its earlier user inputs in order.
    for message in turn["items"].as_array().ok_or(GuiError::InvalidRequest)? {
        if message["type"] != "userMessage" {
            continue;
        }
        let content = message["content"]
            .as_array()
            .ok_or(GuiError::InvalidRequest)?;
        if message["id"] == edit.item_id {
            input.push(json!({"type": "text", "text": edit.text, "text_elements": []}));
            input.extend(
                content
                    .iter()
                    .filter(|part| part["type"] != "text")
                    .cloned(),
            );
            break;
        }
        input.extend(content.iter().cloned());
    }
    Ok(input)
}

async fn prepare(client: &Client, edit: &EditRequest) -> Result<Value> {
    let mut request = GuiRequest::Send {
        thread_id: edit.thread_id.clone(),
        text: edit.text.clone(),
        images: vec![],
        skills: vec![],
        attachments: vec![],
        model: edit.model.clone(),
        effort: edit.effort.clone(),
        access: None,
        cwd: edit.cwd.clone(),
    };
    let root = client.projectless_root.clone();
    let mut params = tauri::async_runtime::spawn_blocking(move || {
        workspaces::prepare_request(&mut request, &root)?;
        request.into_rpc().map(|(_, params)| params)
    })
    .await
    .map_err(|_| GuiError::InvalidRequest)??;
    edit.access.apply_to_turn(&mut params);
    Ok(params)
}

fn rollback_params(thread: &Value, edit: &EditRequest) -> Result<Value> {
    let turns = thread["turns"].as_array().ok_or(GuiError::InvalidRequest)?;
    let index = turns
        .iter()
        .position(|turn| turn["id"] == edit.turn_id)
        .ok_or(GuiError::InvalidRequest)?;
    Ok(json!({"threadId": edit.thread_id, "numTurns": turns.len() - index}))
}

fn rewind_request(thread: &Value, edit: &EditRequest) -> Result<(&'static str, Value)> {
    if thread["historyMode"] == "paginated" {
        return Ok((
            "thread/revert",
            json!({"threadId": edit.thread_id, "beforeTurnId": edit.turn_id}),
        ));
    }
    Ok(("thread/rollback", rollback_params(thread, edit)?))
}

pub(super) async fn submit(client: &Client, edit: EditRequest) -> Result<GuiResponse> {
    validate(&edit)?;
    let params = prepare(client, &edit).await?;
    let mut data = replace_message(&edit, params, |method, params| {
        client.request(method, params)
    })
    .await?;
    workspaces::hide_project_paths(&mut data, &client.projectless_root);
    Ok(GuiResponse { data })
}

async fn replace_message<F, Fut>(
    edit: &EditRequest,
    mut params: Value,
    mut request: F,
) -> Result<Value>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    // Read-only history loads do not activate the session required by rollback.
    let mut resume = thread_params(edit.thread_id.clone())?;
    edit.access.apply_to_thread(&mut resume);
    if let Some(cwd) = params.get("cwd") {
        resume["cwd"] = cwd.clone();
    }
    let source = request("thread/resume", resume).await?;
    // Attachments come from the server's stored message, never arbitrary frontend content.
    params["input"] = json!(edited_input(&source["thread"], edit)?);
    let (method, rewind) = rewind_request(&source["thread"], edit)?;
    let mut data = request(method, rewind).await?;
    // Paginated revert returns metadata only. The validated prefix remains unchanged.
    if method == "thread/revert" {
        data["thread"]["turns"] = json!(source["thread"]["turns"]
            .as_array()
            .ok_or(GuiError::Rpc)?
            .iter()
            .take_while(|turn| turn["id"] != edit.turn_id)
            .collect::<Vec<_>>());
    }
    match request("turn/start", params).await {
        Ok(response) => data["turn"] = response["turn"].clone(),
        Err(error) => {
            // Rollback already succeeded. Return its history so the UI can reconcile it
            // and retain the edited input as a draft instead of retrying a stale target.
            data["error"] = json!(error.to_string());
        }
    }
    Ok(data)
}
