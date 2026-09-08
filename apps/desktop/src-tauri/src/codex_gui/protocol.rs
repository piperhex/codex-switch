use std::{collections::HashMap, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{GuiError, Result};

const MAX_PROMPT_BYTES: usize = 256_000;
const PAGE_SIZE: u32 = 50;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum GuiRequest {
    Models {
        cursor: Option<String>,
    },
    List {
        cursor: Option<String>,
        archived: bool,
        search: Option<String>,
    },
    Read {
        thread_id: String,
    },
    Start {
        cwd: String,
        model: Option<String>,
        access: AccessMode,
    },
    Resume {
        thread_id: String,
        access: AccessMode,
    },
    Send {
        thread_id: String,
        text: String,
        images: Vec<String>,
        model: Option<String>,
        effort: Option<String>,
    },
    Interrupt {
        thread_id: String,
        turn_id: String,
    },
    Rename {
        thread_id: String,
        name: String,
    },
    Archive {
        thread_id: String,
    },
    Unarchive {
        thread_id: String,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AccessMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

#[derive(Serialize)]
pub(crate) struct GuiResponse {
    pub(crate) data: Value,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuiEvent {
    pub(crate) method: String,
    pub(crate) params: Value,
    pub(crate) id: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalReply {
    pub(crate) id: Value,
    pub(crate) decision: Option<Decision>,
    pub(crate) answers: Option<HashMap<String, Answer>>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct Answer {
    pub(crate) answers: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Decision {
    Accept,
    Decline,
    Cancel,
}

pub(super) fn directory(value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || !path.is_dir() {
        return Err(GuiError::Directory);
    }
    path.canonicalize().map_err(|_| GuiError::Directory)
}

fn id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 200
        || value
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(GuiError::InvalidRequest);
    }
    Ok(())
}

fn thread_params(thread_id: String) -> Result<Value> {
    id(&thread_id)?;
    Ok(json!({"threadId": thread_id}))
}

impl GuiRequest {
    // Only this closed set of methods is exposed to the WebView.
    pub(super) fn into_rpc(self) -> Result<(&'static str, Value)> {
        match self {
            Self::Models { cursor } => {
                Ok(("model/list", json!({"limit": PAGE_SIZE, "cursor": cursor})))
            }
            Self::List {
                cursor,
                archived,
                search,
            } => Ok((
                "thread/list",
                json!({
                    "limit": PAGE_SIZE, "cursor": cursor, "archived": archived, "searchTerm": search,
                    "sortKey": "updated_at", "modelProviders": []
                }),
            )),
            Self::Start { cwd, model, access } => {
                directory(&cwd)?;
                Ok((
                    "thread/start",
                    json!({"cwd": cwd, "model": model,
                    "sandbox": access, "approvalPolicy": "on-request"}),
                ))
            }
            Self::Resume { thread_id, access } => {
                let mut params = thread_params(thread_id)?;
                params["sandbox"] = json!(access);
                params["approvalPolicy"] = json!("on-request");
                Ok(("thread/resume", params))
            }
            Self::Read { thread_id } => {
                let mut params = thread_params(thread_id)?;
                params["includeTurns"] = json!(true);
                Ok(("thread/read", params))
            }
            Self::Send {
                thread_id,
                text,
                images,
                model,
                effort,
            } => send_params(thread_id, (text, images), (model, effort)),
            Self::Interrupt { thread_id, turn_id } => {
                id(&turn_id)?;
                let mut params = thread_params(thread_id)?;
                params["turnId"] = json!(turn_id);
                Ok(("turn/interrupt", params))
            }
            Self::Rename { thread_id, name } => {
                if name.trim().is_empty() || name.len() > 500 {
                    return Err(GuiError::InvalidRequest);
                }
                let mut params = thread_params(thread_id)?;
                params["name"] = json!(name.trim());
                Ok(("thread/name/set", params))
            }
            Self::Archive { thread_id } => Ok(("thread/archive", thread_params(thread_id)?)),
            Self::Unarchive { thread_id } => Ok(("thread/unarchive", thread_params(thread_id)?)),
        }
    }
}

fn send_params(
    thread_id: String,
    input: (String, Vec<String>),
    options: (Option<String>, Option<String>),
) -> Result<(&'static str, Value)> {
    let (text, images) = input;
    if (text.trim().is_empty() && images.is_empty())
        || text.len() > MAX_PROMPT_BYTES
        || images.len() > 8
    {
        return Err(GuiError::InvalidRequest);
    }
    if options.1.as_ref().is_some_and(|value| {
        ![
            "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
        ]
        .contains(&value.as_str())
    }) {
        return Err(GuiError::InvalidRequest);
    }
    let mut params = thread_params(thread_id)?;
    let mut content = vec![json!({"type": "text", "text": text, "text_elements": []})];
    for image in images {
        let path = PathBuf::from(&image);
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if !path.is_absolute()
            || !path.is_file()
            || !["png", "jpg", "jpeg", "webp", "gif"].contains(&extension.as_str())
        {
            return Err(GuiError::InvalidRequest);
        }
        content.push(json!({"type": "localImage", "path": image}));
    }
    params["input"] = json!(content);
    params["model"] = json!(options.0);
    params["effort"] = json!(options.1);
    Ok(("turn/start", params))
}

pub(super) fn approval_response(event: &GuiEvent, reply: ApprovalReply) -> Result<Value> {
    match event.method.as_str() {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            let decision = reply.decision.ok_or(GuiError::InvalidRequest)?;
            if let Some(available) = event.params["availableDecisions"].as_array() {
                if !available.contains(&json!(decision)) {
                    return Err(GuiError::InvalidRequest);
                }
            }
            Ok(json!({"decision": decision}))
        }
        "item/tool/requestUserInput" => {
            Ok(json!({"answers": reply.answers.ok_or(GuiError::InvalidRequest)?}))
        }
        "item/permissions/requestApproval" => {
            let permissions = match reply.decision.ok_or(GuiError::InvalidRequest)? {
                Decision::Accept => event.params["permissions"].clone(),
                Decision::Decline | Decision::Cancel => json!({}),
            };
            // Grant only the exact server-requested scope, never a frontend-supplied permission profile.
            Ok(json!({"permissions": permissions, "scope": "turn"}))
        }
        _ => Err(GuiError::InvalidRequest),
    }
}
