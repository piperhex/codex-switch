use serde::{Deserialize, Serialize};

pub(crate) const DEFAULT_CLOUD_BASE_URL: &str = "https://codex.onepiper.cloud";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountSummary {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    pub(crate) plan: String,
    pub(crate) account_id: Option<String>,
    pub(crate) active: bool,
    pub(crate) auto_switch_enabled: bool,
    pub(crate) auto_switch_priority: i32,
    pub(crate) local_proxy_compatible: bool,
    pub(crate) direct_switch_compatible: bool,
    pub(crate) agent_identity: bool,
    pub(crate) official: bool,
    pub(crate) metadata_editable: bool,
    pub(crate) usage: UsageSummary,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSummary {
    pub(crate) primary: Option<UsageWindow>,
    pub(crate) secondary: Option<UsageWindow>,
    pub(crate) api_expires_at: Option<String>,
    pub(crate) plan: Option<String>,
    pub(crate) fetched_at: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageWindow {
    pub(crate) used_percent: f64,
    pub(crate) remaining_percent: f64,
    pub(crate) resets_at: Option<i64>,
    pub(crate) window_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetCredit {
    pub(crate) issued_at: Option<String>,
    pub(crate) expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetCreditsSummary {
    pub(crate) credits: Vec<ResetCredit>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct ManagerStateFile {
    pub(crate) active_account_id: Option<String>,
    pub(crate) active_provider_id: Option<String>,
    #[serde(default)]
    pub(crate) auto_switch_provider_id: Option<String>,
    /// Last known executable used by the local ChatGPT/Codex desktop app. This is
    /// intentionally only a local launch hint; it is never synced with accounts.
    #[serde(default)]
    pub(crate) local_codex_path: Option<String>,
    #[serde(default)]
    pub(crate) local_proxy_enabled: bool,
    #[serde(default)]
    pub(crate) auto_switch_on_quota_exhaustion: bool,
    #[serde(default)]
    pub(crate) concurrent_account_routing_enabled: bool,
    #[serde(default)]
    pub(crate) custom_auto_switch_priority_enabled: bool,
    #[serde(default)]
    pub(crate) auto_disable_unreachable_accounts: bool,
    #[serde(default)]
    pub(crate) local_proxy_listen_on_all_interfaces: bool,
    #[serde(default)]
    pub(crate) local_proxy_lan_api_key: Option<String>,
    #[serde(default)]
    pub(crate) image_generation_account_id: Option<String>,
    #[serde(default)]
    pub(crate) local_proxy_openai_auth_account_id: Option<String>,
    #[serde(default)]
    pub(crate) disabled_account_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppInfo {
    pub(crate) codex_home: String,
    pub(crate) auth_path: String,
    pub(crate) config_path: String,
    pub(crate) account_store: String,
    pub(crate) provider_store: String,
    pub(crate) version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderApiFormat {
    OpenaiResponses,
    OpenaiChat,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderKind {
    #[default]
    Custom,
    #[serde(rename = "openai")]
    OpenAi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderBalancePlatform {
    NewApi,
    Sub2Api,
    DeepSeek,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderProfile {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) kind: ProviderKind,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: Vec<String>,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderSummary {
    pub(crate) id: String,
    pub(crate) kind: ProviderKind,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) models: Vec<String>,
    pub(crate) context_window: Option<u64>,
    pub(crate) model_selection_controlled_by_codex: bool,
    pub(crate) api_format: ProviderApiFormat,
    pub(crate) active: bool,
    pub(crate) auto_switch_enabled: bool,
    pub(crate) has_api_key: bool,
    pub(crate) supports_direct_switch: bool,
    pub(crate) balance_platform: Option<ProviderBalancePlatform>,
    pub(crate) balance_query_url: Option<String>,
    pub(crate) balance_query_uses_api_key: bool,
    pub(crate) has_balance_query_token: bool,
    pub(crate) wallet_query_url: Option<String>,
    pub(crate) has_wallet_query_token: bool,
    pub(crate) wallet_username: Option<String>,
    pub(crate) has_wallet_login_credentials: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderBalance {
    pub(crate) api_amount: Option<f64>,
    pub(crate) api_unit: String,
    pub(crate) api_unlimited: bool,
    pub(crate) wallet_amount: Option<f64>,
    pub(crate) wallet_unit: String,
    pub(crate) wallet_error: Option<String>,
    pub(crate) balance_items: Vec<ProviderBalanceItem>,
    pub(crate) queried_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderBalanceItem {
    pub(crate) amount: f64,
    pub(crate) unit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProxyStatus {
    pub(crate) running: bool,
    pub(crate) address: String,
    pub(crate) port: u16,
    pub(crate) base_url: String,
    pub(crate) auto_switch_on_quota_exhaustion: bool,
    pub(crate) concurrent_account_routing_enabled: bool,
    pub(crate) custom_auto_switch_priority_enabled: bool,
    pub(crate) auto_disable_unreachable_accounts: bool,
    pub(crate) listen_on_all_interfaces: bool,
    pub(crate) has_lan_api_key: bool,
    pub(crate) image_generation_account_id: Option<String>,
    pub(crate) openai_auth_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxySessionSummary {
    pub(crate) id: String,
    pub(crate) title: Option<String>,
    pub(crate) client: String,
    pub(crate) remote_address: Option<String>,
    pub(crate) connected_at: u64,
    pub(crate) last_seen_at: u64,
    pub(crate) active_requests: u64,
    pub(crate) request_count: u64,
    pub(crate) provider: Option<String>,
    pub(crate) concurrent_routed: bool,
    pub(crate) account_id: Option<String>,
    pub(crate) account_email: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) context_tokens: Option<u64>,
    pub(crate) model_context_window: Option<u64>,
    pub(crate) total_tokens: u64,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) cached_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxySessionRequestSummary {
    pub(crate) id: u64,
    pub(crate) started_at: u64,
    pub(crate) model: Option<String>,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) first_response_time_ms: Option<u64>,
    pub(crate) response_time_ms: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
    pub(crate) input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) reasoning_tokens: Option<u64>,
    pub(crate) cached_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxySessionLatencySummary {
    pub(crate) total_first_response_time_ms: u64,
    pub(crate) request_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenUsageEntry {
    pub(crate) id: String,
    pub(crate) ts: u64,
    pub(crate) provider: String,
    #[serde(default)]
    pub(crate) provider_id: Option<String>,
    pub(crate) account_id: Option<String>,
    pub(crate) account_email: Option<String>,
    pub(crate) model: String,
    pub(crate) duration_ms: Option<u64>,
    pub(crate) input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) reasoning_tokens: Option<u64>,
    pub(crate) cached_tokens: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
    #[serde(default)]
    pub(crate) model_context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountTokenUsageTotals {
    pub(crate) account_id: Option<String>,
    pub(crate) account_email: Option<String>,
    pub(crate) total_tokens: u64,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) cached_tokens: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderTokenUsageTotals {
    pub(crate) provider: String,
    pub(crate) provider_id: Option<String>,
    pub(crate) today_tokens: u64,
    pub(crate) total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DailyTokenUsage {
    pub(crate) date: String,
    pub(crate) total_tokens: u64,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) cached_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    #[serde(default = "default_floating_bubble_enabled")]
    pub(crate) floating_bubble_enabled: bool,
    #[serde(default)]
    pub(crate) theme_color: Option<String>,
    #[serde(default)]
    pub(crate) language: Option<String>,
    #[serde(default = "default_privacy_mode")]
    pub(crate) privacy_mode: bool,
    #[serde(default)]
    pub(crate) hide_account_notes: bool,
    #[serde(default)]
    pub(crate) bubble_reset_display: BubbleResetDisplay,
    #[serde(default)]
    pub(crate) bubble_style: BubbleStyle,
    #[serde(default)]
    pub(crate) bubble_x: Option<f64>,
    #[serde(default)]
    pub(crate) bubble_y: Option<f64>,
    #[serde(default = "default_cloud_base_url")]
    pub(crate) cloud_base_url: Option<String>,
    #[serde(default)]
    pub(crate) cloud_user_email: Option<String>,
    #[serde(default)]
    pub(crate) cloud_user_id: Option<String>,
    #[serde(default)]
    pub(crate) cloud_last_sync_at: Option<String>,
    #[serde(default)]
    pub(crate) cloud_session_expired: bool,
    #[serde(default = "default_token_usage_weeks")]
    pub(crate) token_usage_weeks: u16,
    #[serde(default = "default_token_usage_refresh_seconds")]
    pub(crate) token_usage_refresh_seconds: u64,
    #[serde(default = "default_auto_disable_status_codes")]
    pub(crate) auto_disable_status_codes: Vec<u16>,
    #[serde(default)]
    pub(crate) show_usage_network_errors: bool,
    #[serde(default)]
    pub(crate) web_proxy_port: Option<u16>,
    #[serde(default)]
    pub(crate) last_started_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BubbleResetDisplay {
    Countdown,
    ResetAt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BubbleStyle {
    Classic,
    Glass,
}

impl Default for BubbleStyle {
    fn default() -> Self {
        Self::Classic
    }
}

impl Default for BubbleResetDisplay {
    fn default() -> Self {
        Self::Countdown
    }
}

fn default_privacy_mode() -> bool {
    true
}

fn default_floating_bubble_enabled() -> bool {
    true
}

fn default_cloud_base_url() -> Option<String> {
    Some(DEFAULT_CLOUD_BASE_URL.to_string())
}

pub(crate) const MIN_TOKEN_USAGE_WEEKS: u16 = 1;
pub(crate) const MAX_TOKEN_USAGE_WEEKS: u16 = 52;
pub(crate) const MIN_TOKEN_USAGE_REFRESH_SECONDS: u64 = 1;
pub(crate) const MAX_TOKEN_USAGE_REFRESH_SECONDS: u64 = 3_600;

fn default_token_usage_weeks() -> u16 {
    20
}

fn default_token_usage_refresh_seconds() -> u64 {
    60
}

fn default_auto_disable_status_codes() -> Vec<u16> {
    vec![401, 402, 403]
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            floating_bubble_enabled: default_floating_bubble_enabled(),
            theme_color: None,
            language: None,
            privacy_mode: default_privacy_mode(),
            hide_account_notes: false,
            bubble_reset_display: BubbleResetDisplay::default(),
            bubble_style: BubbleStyle::default(),
            bubble_x: None,
            bubble_y: None,
            cloud_base_url: default_cloud_base_url(),
            cloud_user_email: None,
            cloud_user_id: None,
            cloud_last_sync_at: None,
            cloud_session_expired: false,
            token_usage_weeks: default_token_usage_weeks(),
            token_usage_refresh_seconds: default_token_usage_refresh_seconds(),
            auto_disable_status_codes: default_auto_disable_status_codes(),
            show_usage_network_errors: false,
            web_proxy_port: None,
            last_started_version: None,
        }
    }
}

#[derive(Serialize, Clone)]
pub(crate) struct LoginStatus {
    pub(crate) ok: bool,
    pub(crate) message: String,
    #[serde(rename = "accountId")]
    pub(crate) account_id: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct LoginStart {
    pub(crate) url: String,
    pub(crate) embedded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAuthState {
    pub(crate) enabled: bool,
    pub(crate) base_url: Option<String>,
    pub(crate) authenticated: bool,
    pub(crate) user_email: Option<String>,
    pub(crate) user_id: Option<String>,
    pub(crate) last_sync_at: Option<String>,
    pub(crate) session_expired: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudSyncResult {
    pub(crate) uploaded: usize,
    pub(crate) downloaded: usize,
}

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
    pub(crate) usage: String,
    #[serde(default)]
    pub(crate) active: String,
    #[serde(default)]
    pub(crate) auto_switch_priority: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderFieldModifiedAt {
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: String,
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
    pub(crate) plan: String,
    pub(crate) account_id: Option<String>,
    pub(crate) active: bool,
    #[serde(default)]
    pub(crate) auto_switch_priority: i32,
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
pub(crate) struct ProviderSyncPayload {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) kind: ProviderKind,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: Vec<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_state_defaults_local_proxy_to_disabled() {
        let state: ManagerStateFile =
            serde_json::from_str(r#"{"active_account_id":"account-1"}"#).unwrap();

        assert_eq!(state.active_account_id.as_deref(), Some("account-1"));
        assert!(state.auto_switch_provider_id.is_none());
        assert!(!state.local_proxy_enabled);
        assert!(!state.auto_switch_on_quota_exhaustion);
        assert!(!state.concurrent_account_routing_enabled);
        assert!(!state.custom_auto_switch_priority_enabled);
        assert!(!state.auto_disable_unreachable_accounts);
        assert!(!state.local_proxy_listen_on_all_interfaces);
        assert!(state.local_proxy_lan_api_key.is_none());
        assert!(state.image_generation_account_id.is_none());
        assert!(state.disabled_account_ids.is_empty());
    }

    #[test]
    fn app_settings_default_to_the_hosted_cloud_server() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_disabled: AppSettings =
            serde_json::from_str(r#"{"cloudBaseUrl":null}"#).unwrap();

        assert_eq!(
            defaults.cloud_base_url.as_deref(),
            Some(DEFAULT_CLOUD_BASE_URL)
        );
        assert_eq!(
            migrated.cloud_base_url.as_deref(),
            Some(DEFAULT_CLOUD_BASE_URL)
        );
        assert!(explicitly_disabled.cloud_base_url.is_none());
    }

    #[test]
    fn app_settings_enable_the_floating_bubble_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_disabled: AppSettings =
            serde_json::from_str(r#"{"floatingBubbleEnabled":false}"#).unwrap();

        assert!(defaults.floating_bubble_enabled);
        assert!(migrated.floating_bubble_enabled);
        assert!(!explicitly_disabled.floating_bubble_enabled);
    }

    #[test]
    fn app_settings_show_account_notes_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_hidden: AppSettings =
            serde_json::from_str(r#"{"hideAccountNotes":true}"#).unwrap();

        assert!(!defaults.hide_account_notes);
        assert!(!migrated.hide_account_notes);
        assert!(explicitly_hidden.hide_account_notes);
    }

    #[test]
    fn app_settings_default_the_bubble_style_to_classic() {
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let glass: AppSettings = serde_json::from_str(r#"{"bubbleStyle":"glass"}"#).unwrap();

        assert!(matches!(migrated.bubble_style, BubbleStyle::Classic));
        assert!(matches!(glass.bubble_style, BubbleStyle::Glass));
    }

    #[test]
    fn app_settings_default_the_web_version_to_disabled() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let enabled: AppSettings = serde_json::from_str(r#"{"webProxyPort":18765}"#).unwrap();

        assert!(defaults.web_proxy_port.is_none());
        assert!(migrated.web_proxy_port.is_none());
        assert_eq!(enabled.web_proxy_port, Some(18_765));
    }

    #[test]
    fn app_settings_default_auto_disable_status_codes_to_access_rejections() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let customized: AppSettings =
            serde_json::from_str(r#"{"autoDisableStatusCodes":[401,429]}"#).unwrap();

        assert_eq!(defaults.auto_disable_status_codes, [401, 402, 403]);
        assert_eq!(migrated.auto_disable_status_codes, [401, 402, 403]);
        assert_eq!(customized.auto_disable_status_codes, [401, 429]);
    }

    #[test]
    fn app_settings_hide_usage_network_errors_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let enabled: AppSettings =
            serde_json::from_str(r#"{"showUsageNetworkErrors":true}"#).unwrap();

        assert!(!defaults.show_usage_network_errors);
        assert!(!migrated.show_usage_network_errors);
        assert!(enabled.show_usage_network_errors);
    }
}
