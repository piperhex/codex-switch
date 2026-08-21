use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub(crate) const DEFAULT_CLOUD_BASE_URL: &str = "https://codex.onepiper.cloud";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountSummary {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    pub(crate) private_details: AccountPrivateDetails,
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

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct AccountPrivateDetails {
    pub(crate) password: String,
    pub(crate) phone_number: String,
    pub(crate) totp_secret: String,
}

impl AccountPrivateDetails {
    pub(crate) fn normalized(mut self) -> Result<Self, String> {
        const MAX_PASSWORD_LENGTH: usize = 1_024;
        const MAX_PHONE_LENGTH: usize = 64;
        const MAX_TOTP_LENGTH: usize = 512;

        if self.password.chars().count() > MAX_PASSWORD_LENGTH {
            return Err("Account password is too long".to_string());
        }
        self.phone_number = self.phone_number.trim().to_string();
        if self.phone_number.chars().count() > MAX_PHONE_LENGTH {
            return Err("Phone number is too long".to_string());
        }
        self.totp_secret = self
            .totp_secret
            .to_uppercase()
            .chars()
            .filter(|character| {
                !character.is_whitespace() && *character != '-' && *character != '='
            })
            .collect();
        let valid_totp = self.totp_secret.is_empty()
            || (self.totp_secret.len() <= MAX_TOTP_LENGTH
                && self
                    .totp_secret
                    .chars()
                    .all(|character| matches!(character, 'A'..='Z' | '2'..='7')));
        valid_totp
            .then_some(self)
            .ok_or_else(|| "2FA key must be a valid Base32 value".to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAccountDetailsInput {
    pub(crate) id: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    pub(crate) private_details: AccountPrivateDetails,
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
    pub(crate) active_provider_group: Option<String>,
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
    pub(crate) image_input_target: Option<ImageModelTarget>,
    #[serde(default)]
    pub(crate) image_output_target: Option<ImageModelTarget>,
    #[serde(default)]
    pub(crate) local_proxy_openai_auth_account_id: Option<String>,
    #[serde(default)]
    pub(crate) disabled_account_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ImageModelTarget {
    Official { account_id: String },
    Provider { provider_id: String, model: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ImageRouteKind {
    Input,
    Output,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ReasoningEffort {
    None,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

pub(crate) type ModelReasoningEfforts = BTreeMap<String, Vec<ReasoningEffort>>;
pub(crate) type ModelContextWindows = BTreeMap<String, u64>;
pub(crate) type ModelApiFormats = BTreeMap<String, ProviderApiFormat>;
