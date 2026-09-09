//! Keep sandbox scope and approval behavior aligned with the selected access mode.
use serde_json::{json, Value};

use super::protocol::AccessMode;

impl AccessMode {
    fn approval_policy(&self) -> &'static str {
        match self {
            Self::DangerFullAccess => "never",
            Self::ReadOnly | Self::WorkspaceWrite => "on-request",
        }
    }

    fn apply_approvals(&self, params: &mut Value) {
        params["approvalPolicy"] = json!(self.approval_policy());
        // Reset the reviewer explicitly when leaving automatic approval mode.
        params["approvalsReviewer"] = json!(match self {
            Self::WorkspaceWrite => "auto_review",
            Self::ReadOnly | Self::DangerFullAccess => "user",
        });
    }

    pub(super) fn apply_to_thread(&self, params: &mut Value) {
        self.apply_approvals(params);
        params["sandbox"] = json!(self);
    }

    pub(super) fn apply_to_turn(&self, params: &mut Value) {
        self.apply_approvals(params);
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
