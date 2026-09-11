/// Locally stored LAN credentials. Secrets never cross the UI IPC boundary.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProxyLanApiKey {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) api_key: String,
    pub(crate) enabled: bool,
    pub(crate) quota_usd: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProxyLanApiKeySummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) key_preview: String,
    pub(crate) enabled: bool,
    pub(crate) quota_usd: Option<f64>,
    pub(crate) used_tokens: u64,
    pub(crate) used_cost_usd: f64,
    pub(crate) remaining_usd: Option<f64>,
    pub(crate) usage_incomplete: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveLocalProxyLanApiKey {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    pub(crate) api_key: Option<String>,
    pub(crate) enabled: bool,
    pub(crate) quota_usd: Option<f64>,
    #[serde(default)]
    pub(crate) acknowledge_usage: bool,
}
