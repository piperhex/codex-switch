use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Complete editable source and its safe, optional representation for form controls.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigDocument {
    pub(crate) content: String,
    pub(crate) revision: String,
    pub(crate) values: Option<Value>,
    pub(crate) error: Option<ConfigDiagnostic>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigDiagnostic {
    pub(crate) message: String,
    pub(crate) line: Option<usize>,
    pub(crate) column: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveConfigRequest {
    pub(crate) content: String,
    pub(crate) expected_revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PatchConfigRequest {
    pub(crate) path: Vec<String>,
    pub(crate) value: Value,
    pub(crate) expected_revision: String,
}
