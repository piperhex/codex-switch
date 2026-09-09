//! Keep sandbox scope and approval behavior aligned with the selected access mode.
use serde_json::{json, Value};

use super::protocol::AccessMode;

impl AccessMode {
    pub(super) fn approval_policy(&self) -> &'static str {
        match self {
            Self::DangerFullAccess => "never",
            Self::ReadOnly | Self::WorkspaceWrite => "on-request",
        }
    }

    pub(super) fn apply_to_turn(&self, params: &mut Value) {
        params["approvalPolicy"] = json!(self.approval_policy());
        params["sandboxPolicy"] = match self {
            Self::DangerFullAccess => json!({"type": "dangerFullAccess"}),
            Self::ReadOnly => json!({"type": "readOnly", "networkAccess": false}),
            Self::WorkspaceWrite => json!({
                "type": "workspaceWrite", "writableRoots": [], "networkAccess": false,
                "excludeTmpdirEnvVar": false, "excludeSlashTmp": false,
            }),
        };
    }
}
