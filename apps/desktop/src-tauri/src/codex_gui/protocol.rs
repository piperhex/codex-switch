use std::{collections::HashMap, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{GuiError, Result};
use super::goals::{self, GoalStatus};
use super::prompt::{
    batch_params, send_params, AttachmentInput, PromptInput, SkillInput, TurnOptions,
};

const PAGE_SIZE: u32 = 50;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum GuiRequest {
    ImagePreview {
        thread_id: String,
        source: String,
    },
    Models {
        cursor: Option<String>,
    },
    Skills {
        cwd: Option<String>,
    },
    Plugins {
        cwd: Option<String>,
    },
    GoalGet {
        thread_id: String,
    },
    GoalSet {
        thread_id: String,
        objective: Option<String>,
        status: GoalStatus,
    },
    GoalClear {
        thread_id: String,
    },
    List {
        cursor: Option<String>,
        archived: bool,
        search: Option<String>,
    },
    Read {
        thread_id: String,
    },
    Compact {
        thread_id: String,
    },
    Start {
        cwd: Option<String>,
        model: Option<String>,
        access: AccessMode,
    },
    Resume {
        thread_id: String,
        access: AccessMode,
        cwd: Option<String>,
    },
    Send {
        thread_id: String,
        text: String,
        images: Vec<String>,
        #[serde(default)]
        skills: Vec<SkillInput>,
        #[serde(default)]
        attachments: Vec<AttachmentInput>,
        model: Option<String>,
        effort: Option<String>,
        cwd: Option<String>,
    },
    Interrupt {
        thread_id: String,
        turn_id: String,
    },
    Steer {
        thread_id: String,
        turn_id: String,
        text: String,
        images: Vec<String>,
        #[serde(default)]
        skills: Vec<SkillInput>,
        #[serde(default)]
        attachments: Vec<AttachmentInput>,
    },
    SendBatch {
        thread_id: String,
        messages: Vec<PromptInput>,
        model: Option<String>,
        effort: Option<String>,
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

pub(super) fn thread_params(thread_id: String) -> Result<Value> {
    id(&thread_id)?;
    Ok(json!({"threadId": thread_id}))
}

impl GuiRequest {
    // Only this closed set of methods is exposed to the WebView.
    pub(super) fn into_rpc(self) -> Result<(&'static str, Value)> {
        match self {
            // Image previews are served locally, never forwarded as an app-server operation.
            Self::ImagePreview { .. } => Err(GuiError::InvalidRequest),
            Self::Plugins { cwd } => {
                if let Some(cwd) = &cwd {
                    directory(cwd)?;
                }
                Ok((
                    "plugin/installed",
                    json!({"cwds": cwd.into_iter().collect::<Vec<_>>()}),
                ))
            }
            Self::GoalGet { thread_id } => Ok(("thread/goal/get", thread_params(thread_id)?)),
            Self::GoalClear { thread_id } => Ok(("thread/goal/clear", thread_params(thread_id)?)),
            Self::GoalSet {
                thread_id,
                objective,
                status,
            } => goals::set_params(thread_id, objective, status),
            Self::Skills { cwd } => {
                if let Some(cwd) = &cwd {
                    directory(cwd)?;
                }
                Ok((
                    "skills/list",
                    json!({"cwds": cwd.into_iter().collect::<Vec<_>>(), "forceReload": true}),
                ))
            }
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
                let cwd = cwd.ok_or(GuiError::Directory)?;
                directory(&cwd)?;
                Ok((
                    "thread/start",
                    json!({"cwd": cwd, "model": model,
                    "sandbox": access, "approvalPolicy": "on-request"}),
                ))
            }
            Self::Resume {
                thread_id,
                access,
                cwd,
            } => {
                let mut params = thread_params(thread_id)?;
                if let Some(cwd) = cwd {
                    directory(&cwd)?;
                    params["cwd"] = json!(cwd);
                }
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
                skills,
                attachments,
                model,
                effort,
                cwd,
            } => send_params(
                thread_id,
                PromptInput {
                    text,
                    images,
                    skills,
                    attachments,
                },
                TurnOptions { model, effort, cwd },
            ),
            Self::Interrupt { thread_id, turn_id } => {
                id(&turn_id)?;
                let mut params = thread_params(thread_id)?;
                params["turnId"] = json!(turn_id);
                Ok(("turn/interrupt", params))
            }
            Self::Steer {
                thread_id,
                turn_id,
                text,
                images,
                skills,
                attachments,
            } => {
                id(&turn_id)?;
                let (_, mut params) = send_params(
                    thread_id,
                    PromptInput {
                        text,
                        images,
                        skills,
                        attachments,
                    },
                    TurnOptions {
                        model: None,
                        effort: None,
                        cwd: None,
                    },
                )?;
                params["expectedTurnId"] = json!(turn_id);
                if let Some(object) = params.as_object_mut() {
                    object.remove("model");
                    object.remove("effort");
                }
                Ok(("turn/steer", params))
            }
            Self::SendBatch {
                thread_id,
                messages,
                model,
                effort,
            } => batch_params(
                thread_id,
                messages,
                TurnOptions {
                    model,
                    effort,
                    cwd: None,
                },
            ),
            Self::Rename { thread_id, name } => {
                if name.trim().is_empty() || name.len() > 500 {
                    return Err(GuiError::InvalidRequest);
                }
                let mut params = thread_params(thread_id)?;
                params["name"] = json!(name.trim());
                Ok(("thread/name/set", params))
            }
            Self::Compact { thread_id } => Ok(("thread/compact/start", thread_params(thread_id)?)),
            Self::Archive { thread_id } => Ok(("thread/archive", thread_params(thread_id)?)),
            Self::Unarchive { thread_id } => Ok(("thread/unarchive", thread_params(thread_id)?)),
        }
    }
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
