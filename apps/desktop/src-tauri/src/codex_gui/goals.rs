//! Goal mutations remain scoped to one conversation and use the engine's persisted goal lifecycle.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{GuiError, Result};
use super::protocol::thread_params;

const MAX_OBJECTIVE_BYTES: usize = 16_000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GoalStatus {
    Active,
    Paused,
}

pub(super) fn set_params(
    thread_id: String,
    objective: Option<String>,
    status: GoalStatus,
) -> Result<(&'static str, Value)> {
    let mut params = thread_params(thread_id)?;
    if let Some(objective) = objective {
        let objective = objective.trim();
        if objective.is_empty() || objective.len() > MAX_OBJECTIVE_BYTES || objective.contains('\0')
        {
            return Err(GuiError::InvalidRequest);
        }
        params["objective"] = json!(objective);
    }
    params["status"] = json!(status);
    Ok(("thread/goal/set", params))
}
