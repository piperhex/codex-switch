#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    #[serde(default)]
    pub(crate) codex_home: Option<String>,
    #[serde(default = "default_launch_at_startup")]
    pub(crate) launch_at_startup: bool,
    #[serde(default = "default_close_to_tray")]
    pub(crate) close_to_tray: bool,
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
    pub(crate) show_custom_cloud_server: bool,
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
    #[serde(default = "default_upstream_429_retry_timeout_seconds")]
    pub(crate) upstream_429_retry_timeout_seconds: u64,
    #[serde(default)]
    pub(crate) show_usage_network_errors: bool,
    #[serde(default = "default_gpt_5_6_sol_context_window")]
    pub(crate) gpt_5_6_sol_context_window: u64,
    #[serde(default)]
    pub(crate) web_proxy_port: Option<u16>,
    #[serde(default)]
    pub(crate) web_proxy_listen_on_all_interfaces: bool,
    #[serde(default)]
    pub(crate) network_proxy: NetworkProxySettings,
    #[serde(default)]
    pub(crate) provider_groups: Vec<String>,
    #[serde(default)]
    pub(crate) last_started_version: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkProxySettings {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) proxy_url: String,
    #[serde(default)]
    pub(crate) proxy_port: Option<u16>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BubbleResetDisplay {
    #[default]
    Countdown,
    ResetAt,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BubbleStyle {
    #[default]
    Classic,
    Glass,
}

fn default_privacy_mode() -> bool {
    true
}

fn default_launch_at_startup() -> bool {
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
pub(crate) const DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS: u64 = 300;
pub(crate) const MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS: u64 = 1;
pub(crate) const MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS: u64 = 3_600;
pub(crate) const DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW: u64 = 272_000;
pub(crate) const MAX_GPT_5_6_SOL_CONTEXT_WINDOW: u64 = 1_050_000;
pub(crate) const MIN_GPT_5_6_SOL_CONTEXT_WINDOW: u64 = 1_000;

fn default_token_usage_weeks() -> u16 {
    20
}

fn default_token_usage_refresh_seconds() -> u64 {
    60
}

fn default_gpt_5_6_sol_context_window() -> u64 {
    DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW
}

fn default_close_to_tray() -> bool {
    true
}

fn default_auto_disable_status_codes() -> Vec<u16> {
    vec![401, 402, 403]
}

fn default_upstream_429_retry_timeout_seconds() -> u64 {
    DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_home: None,
            launch_at_startup: default_launch_at_startup(),
            close_to_tray: default_close_to_tray(),
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
            show_custom_cloud_server: false,
            cloud_user_email: None,
            cloud_user_id: None,
            cloud_last_sync_at: None,
            cloud_session_expired: false,
            token_usage_weeks: default_token_usage_weeks(),
            token_usage_refresh_seconds: default_token_usage_refresh_seconds(),
            auto_disable_status_codes: default_auto_disable_status_codes(),
            upstream_429_retry_timeout_seconds: default_upstream_429_retry_timeout_seconds(),
            show_usage_network_errors: false,
            gpt_5_6_sol_context_window: default_gpt_5_6_sol_context_window(),
            web_proxy_port: None,
            web_proxy_listen_on_all_interfaces: false,
            network_proxy: NetworkProxySettings::default(),
            provider_groups: Vec::new(),
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
