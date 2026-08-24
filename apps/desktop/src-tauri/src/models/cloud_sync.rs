#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountFieldModifiedAt {
    #[serde(default)]
    pub(crate) auth: String,
    #[serde(default)]
    pub(crate) note: String,
    #[serde(default)]
    pub(crate) expires_at: String,
    #[serde(default)]
    pub(crate) private_details: String,
    #[serde(default)]
    pub(crate) usage: String,
    #[serde(default)]
    pub(crate) active: String,
    #[serde(default)]
    pub(crate) auto_switch_priority: String,
    #[serde(default)]
    pub(crate) auto_switch_threshold: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderFieldModifiedAt {
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) group: String,
    #[serde(default)]
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: String,
    #[serde(default)]
    pub(crate) model_reasoning_efforts: String,
    #[serde(default)]
    pub(crate) model_context_windows: String,
    #[serde(default)]
    pub(crate) model_api_formats: String,
    #[serde(default)]
    pub(crate) image_input_models: String,
    #[serde(default)]
    pub(crate) context_window: String,
    #[serde(default)]
    pub(crate) model_selection_controlled_by_codex: String,
    #[serde(default)]
    pub(crate) api_format: String,
    #[serde(default)]
    pub(crate) balance_platform: String,
    #[serde(default)]
    pub(crate) balance_query_url: String,
    #[serde(default)]
    pub(crate) balance_query_token: String,
    #[serde(default)]
    pub(crate) wallet_query_url: String,
    #[serde(default)]
    pub(crate) wallet_query_token: String,
    #[serde(default)]
    pub(crate) wallet_username: String,
    #[serde(default)]
    pub(crate) wallet_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAccountPayload {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) private_details: Option<AccountPrivateDetails>,
    pub(crate) plan: String,
    pub(crate) account_id: Option<String>,
    pub(crate) active: bool,
    #[serde(default)]
    pub(crate) auto_switch_priority: i32,
    #[serde(default)]
    pub(crate) auto_switch_threshold: f64,
    pub(crate) usage: UsageSummary,
    pub(crate) last_modified_at: String,
    #[serde(default)]
    pub(crate) field_modified_at: AccountFieldModifiedAt,
    pub(crate) auth: serde_json::Value,
    #[serde(default, skip_serializing)]
    pub(crate) official: bool,
    #[serde(default, skip_serializing)]
    pub(crate) metadata_editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeletedCloudAccount {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    pub(crate) plan: String,
    pub(crate) deleted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeletedCloudProvider {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) deleted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderSyncPayload {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) kind: ProviderKind,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) group: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: Vec<String>,
    #[serde(default)]
    pub(crate) model_reasoning_efforts: ModelReasoningEfforts,
    #[serde(default)]
    pub(crate) model_context_windows: ModelContextWindows,
    #[serde(default)]
    pub(crate) model_api_formats: ModelApiFormats,
    #[serde(default)]
    pub(crate) image_input_models: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) context_window: Option<u64>,
    #[serde(default)]
    pub(crate) model_selection_controlled_by_codex: bool,
    pub(crate) api_format: ProviderApiFormat,
    #[serde(default)]
    pub(crate) balance_platform: Option<ProviderBalancePlatform>,
    #[serde(default)]
    pub(crate) balance_query_url: Option<String>,
    #[serde(default)]
    pub(crate) balance_query_token: Option<String>,
    #[serde(default)]
    pub(crate) wallet_query_url: Option<String>,
    #[serde(default)]
    pub(crate) wallet_query_token: Option<String>,
    #[serde(default)]
    pub(crate) wallet_username: Option<String>,
    #[serde(default)]
    pub(crate) wallet_password: Option<String>,
    pub(crate) last_modified_at: String,
    #[serde(default)]
    pub(crate) field_modified_at: ProviderFieldModifiedAt,
}
