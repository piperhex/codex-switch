pub(crate) const CODEX_SWITCH_QUOTA_PATH: &str = "/v1/codex-switch/quota";
const CODEX_SWITCH_QUOTA_OBJECT: &str = "codex_switch_quota";
pub(crate) const CODEX_SWITCH_QUOTA_DETECTION_TIMEOUT: Duration = Duration::from_secs(3);

/// Resolves quota requests beside the upstream API, preserving any reverse-proxy prefix.
pub(crate) fn codex_switch_quota_url(base_url: &str) -> Result<String, String> {
    let mut url =
        Url::parse(base_url).map_err(|_| "Codex Switch address is invalid".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Codex Switch address must use HTTP or HTTPS".to_string());
    }
    let path = url.path().trim_end_matches('/');
    let root = path
        .strip_suffix("/api/v1")
        .or_else(|| path.strip_suffix("/v1"))
        .unwrap_or(path);
    url.set_path(&format!("{root}{CODEX_SWITCH_QUOTA_PATH}"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

fn resolve_codex_switch_balance_settings(
    base_url: &str,
    api_key: &str,
    kind: ProviderKind,
    configured: (Option<ProviderBalancePlatform>, Option<String>),
) -> (Option<ProviderBalancePlatform>, Option<String>) {
    if configured.0 == Some(ProviderBalancePlatform::CodexSwitch) {
        return (configured.0, codex_switch_quota_url(base_url).ok());
    }
    if configured.0.is_some() || kind != ProviderKind::OpenAi || api_key.is_empty() {
        return configured;
    }
    let Ok(query_url) = codex_switch_quota_url(base_url) else {
        return configured;
    };
    if !upstream_supports_codex_switch_quota(&query_url, api_key) {
        return configured;
    }
    (Some(ProviderBalancePlatform::CodexSwitch), Some(query_url))
}

fn upstream_supports_codex_switch_quota(query_url: &str, api_key: &str) -> bool {
    let client = crate::system_proxy::apply(Client::builder())
        .timeout(CODEX_SWITCH_QUOTA_DETECTION_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Codex-Switch")
        .build();
    let Ok(client) = client else { return false };
    query_balance_payload(&client, query_url, api_key, None, "Quota")
        .is_ok_and(|payload| is_codex_switch_quota_payload(&payload))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexSwitchQuotaResponse {
    object: String,
    remaining_usd: Option<f64>,
    unlimited: bool,
    #[serde(default)]
    usage_incomplete: bool,
    unit: String,
}

/// Distinguishes the per-key quota response from unrelated OpenAI-compatible usage APIs.
pub(crate) fn is_codex_switch_quota_payload(payload: &Value) -> bool {
    parse_codex_switch_quota_response(payload).is_ok()
}

fn parse_codex_switch_quota_response(payload: &Value) -> Result<CodexSwitchQuotaResponse, String> {
    let quota: CodexSwitchQuotaResponse = serde_json::from_value(payload.clone())
        .map_err(|_| "Codex Switch returned an invalid quota response".to_string())?;
    if quota.object != CODEX_SWITCH_QUOTA_OBJECT || quota.unit != "USD" {
        return Err("Codex Switch returned an invalid quota response".to_string());
    }
    if !quota.unlimited && quota.remaining_usd.is_none_or(|value| !value.is_finite()) {
        return Err("Codex Switch did not return the remaining quota".to_string());
    }
    Ok(quota)
}

fn parse_codex_switch_balance(payload: &Value) -> Result<ParsedProviderApiBalance, String> {
    let quota = parse_codex_switch_quota_response(payload)?;
    if quota.usage_incomplete && !quota.unlimited {
        return Err("部分用量待确认，请联系上游管理员核对额度。".to_string());
    }
    let amount = if quota.unlimited {
        None
    } else {
        quota.remaining_usd.map(|value| value.max(0.0))
    };
    Ok(ParsedProviderApiBalance {
        amount,
        unit: quota.unit,
        unlimited: quota.unlimited,
        embedded_wallet_amount: None,
        embedded_wallet_unit: "USD".to_string(),
        balance_items: Vec::new(),
    })
}
