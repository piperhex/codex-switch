use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{BrowserError, Result};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BrowserRequest {
    pub(super) operation: Operation,
    #[serde(default)]
    pub(super) args: Value,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Operation {
    Status,
    Tabs,
    Open,
    Navigate,
    Back,
    Forward,
    Reload,
    Close,
    Focus,
    Snapshot,
    Frames,
    Click,
    Fill,
    Type,
    Key,
    Scroll,
    Select,
    Check,
    Drag,
    Screenshot,
    Wait,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BridgeRequest {
    pub(super) client_id: String,
    pub(super) token: String,
    pub(super) request: BrowserRequest,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowserReply {
    pub(super) result: Option<Value>,
    pub(super) error: Option<String>,
}

impl BrowserReply {
    pub(super) fn error(error: impl ToString) -> Self {
        Self {
            result: None,
            error: Some(error.to_string()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExtensionRequest {
    pub(super) id: String,
    pub(super) client_id: String,
    pub(super) request: BrowserRequest,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum ExtensionMessage {
    Ready {
        name: String,
    },
    Reply {
        id: String,
        #[serde(flatten)]
        reply: BrowserReply,
    },
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Endpoint {
    pub(super) id: String,
    pub(super) port: u16,
    pub(super) name: String,
}

impl BrowserRequest {
    pub(super) fn validate(&self) -> Result<()> {
        if !self.args.is_object() && !self.args.is_null() {
            return Err(BrowserError::InvalidRequest);
        }
        if serde_json::to_vec(&self.args)
            .map_err(|_| BrowserError::InvalidRequest)?
            .len()
            > 48 * 1024
        {
            return Err(BrowserError::InvalidRequest);
        }
        // Operation-specific validation also runs in the extension before using any browser API.
        Ok(())
    }
}
