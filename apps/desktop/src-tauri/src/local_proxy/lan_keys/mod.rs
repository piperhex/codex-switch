use crate::models::{
    LocalProxyLanApiKey, LocalProxyLanApiKeySummary, ManagerStateFile, SaveLocalProxyLanApiKey,
};
use crate::storage::{self, Paths};
use tauri::{Emitter, Runtime};

pub(crate) mod commands;
mod http;
mod ledger;

pub(crate) use commands::{
    delete_local_proxy_lan_api_key, list_local_proxy_lan_api_keys, save_local_proxy_lan_api_key,
};
pub(super) use http::{authorize_request, is_quota_endpoint, quota_payload, RequestKeyScope};

const MAX_KEYS: usize = 100;
const MAX_NAME_LENGTH: usize = 80;
const MIN_KEY_LENGTH: usize = 16;
const MAX_KEY_LENGTH: usize = 512;
const MAX_QUOTA_USD: f64 = 1_000_000_000.0;

#[derive(Debug, thiserror::Error)]
pub(super) enum LanKeyError {
    #[error("暂时无法读取或保存 API Key，请稍后重试。")]
    Unavailable,
    #[error("请输入 1 至 80 个字的名称。")]
    InvalidName,
    #[error("API Key 需包含 16 至 512 个英文字母、数字或符号，且不能包含空格。")]
    InvalidKey,
    #[error("额度需为 0 至 10 亿美元之间的金额。")]
    InvalidQuota,
    #[error("这个 API Key 已存在，请使用其他密钥。")]
    Duplicate,
    #[error("这个 API Key 已不存在，请刷新后重试。")]
    NotFound,
    #[error("最多可以添加 100 个 API Key。")]
    TooMany,
    #[error("请先关闭局域网监听，或保留至少一个已启用的 API Key。")]
    LastEnabled,
    #[error("A valid API key is required")]
    Unauthorized,
}

/// Stable legacy IDs preserve accounting before and after the first settings migration.
fn legacy_key(secret: &str) -> LocalProxyLanApiKey {
    LocalProxyLanApiKey {
        id: format!("legacy-{}", super::short_hash_str(secret)),
        name: "默认 API Key".to_string(),
        api_key: secret.to_string(),
        enabled: true,
        quota_usd: None,
    }
}

pub(super) fn configured_keys(state: &ManagerStateFile) -> Vec<LocalProxyLanApiKey> {
    let mut keys = state.local_proxy_lan_api_keys.clone();
    if let Some(secret) = state.local_proxy_lan_api_key.as_deref().map(str::trim) {
        if !secret.is_empty() && !keys.iter().any(|key| key.api_key == secret) {
            keys.push(legacy_key(secret));
        }
    }
    keys
}

pub(super) fn migrate_legacy_key(state: &mut ManagerStateFile) {
    state.local_proxy_lan_api_keys = configured_keys(state);
    state.local_proxy_lan_api_key = None;
    state.local_proxy_lan_api_keys_changed = true;
}

fn validate_input(input: &SaveLocalProxyLanApiKey) -> Result<(), LanKeyError> {
    let name_length = input.name.trim().chars().count();
    if !(1..=MAX_NAME_LENGTH).contains(&name_length) {
        return Err(LanKeyError::InvalidName);
    }
    if input
        .quota_usd
        .is_some_and(|quota| !quota.is_finite() || !(0.0..=MAX_QUOTA_USD).contains(&quota))
    {
        return Err(LanKeyError::InvalidQuota);
    }
    if let Some(secret) = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
    {
        if !(MIN_KEY_LENGTH..=MAX_KEY_LENGTH).contains(&secret.len())
            || !secret.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(LanKeyError::InvalidKey);
        }
    }
    Ok(())
}

fn generate_key() -> String {
    use base64::Engine;
    use rand::RngCore;

    let mut entropy = [0_u8; 32];
    rand::rng().fill_bytes(&mut entropy);
    format!(
        "csw-{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(entropy)
    )
}

pub(super) fn save_key(
    state: &mut ManagerStateFile,
    input: SaveLocalProxyLanApiKey,
) -> Result<(), LanKeyError> {
    validate_input(&input)?;
    migrate_legacy_key(state);
    let existing = existing_key_index(&state.local_proxy_lan_api_keys, input.id.as_deref())?;
    if existing.is_none() && state.local_proxy_lan_api_keys.len() >= MAX_KEYS {
        return Err(LanKeyError::TooMany);
    }
    let secret = selected_secret(
        input.api_key.as_deref(),
        existing.map(|index| state.local_proxy_lan_api_keys[index].api_key.as_str()),
    );
    if state
        .local_proxy_lan_api_keys
        .iter()
        .enumerate()
        .any(|(index, key)| Some(index) != existing && super::api_keys_equal(&key.api_key, &secret))
    {
        return Err(LanKeyError::Duplicate);
    }
    let key = LocalProxyLanApiKey {
        id: input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        name: input.name.trim().to_string(),
        api_key: secret,
        enabled: input.enabled,
        quota_usd: input.quota_usd,
    };
    match existing {
        Some(index) => state.local_proxy_lan_api_keys[index] = key,
        None => state.local_proxy_lan_api_keys.push(key),
    }
    validate_active_key(state)
}

fn existing_key_index(
    keys: &[LocalProxyLanApiKey],
    id: Option<&str>,
) -> Result<Option<usize>, LanKeyError> {
    id.map(|id| {
        keys.iter()
            .position(|key| key.id == id)
            .ok_or(LanKeyError::NotFound)
    })
    .transpose()
}

fn selected_secret(supplied: Option<&str>, existing: Option<&str>) -> String {
    supplied
        .map(str::trim)
        .filter(|secret| !secret.is_empty())
        .or(existing)
        .map(str::to_string)
        .unwrap_or_else(generate_key)
}

fn mutate_keys(
    paths: &Paths,
    mutate: impl FnOnce(&mut ManagerStateFile) -> Result<(), LanKeyError>,
) -> Result<(), LanKeyError> {
    let mut failure = None;
    storage::update_state(paths, |state| {
        mutate(state).map_err(|error| {
            let message = error.to_string();
            failure = Some(error);
            message
        })
    })
    .map_err(|_| failure.unwrap_or(LanKeyError::Unavailable))
}

fn validate_active_key(state: &ManagerStateFile) -> Result<(), LanKeyError> {
    if state.local_proxy_listen_on_all_interfaces
        && !state.local_proxy_lan_api_keys.iter().any(|key| key.enabled)
    {
        return Err(LanKeyError::LastEnabled);
    }
    Ok(())
}

fn summary(key: &LocalProxyLanApiKey, usage: ledger::KeyUsage) -> LocalProxyLanApiKeySummary {
    let suffix: String = if key.api_key.chars().count() <= 4 {
        String::new()
    } else {
        key.api_key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    };
    LocalProxyLanApiKeySummary {
        id: key.id.clone(),
        name: key.name.clone(),
        key_preview: format!("••••{suffix}"),
        enabled: key.enabled,
        quota_usd: key.quota_usd,
        used_tokens: usage.tokens,
        used_cost_usd: usage.cost_usd,
        remaining_usd: key.quota_usd.map(|quota| (quota - usage.cost_usd).max(0.0)),
        usage_incomplete: usage.incomplete,
    }
}

fn list_summaries(paths: &Paths) -> Result<Vec<LocalProxyLanApiKeySummary>, LanKeyError> {
    let state = storage::try_read_state(paths).map_err(|_| LanKeyError::Unavailable)?;
    let usage = ledger::load_all(paths)?;
    Ok(configured_keys(&state)
        .iter()
        .map(|key| summary(key, usage.get(&key.id).copied().unwrap_or_default()))
        .collect())
}

pub(super) fn record_usage<R: Runtime>(
    app: &tauri::AppHandle<R>,
    key_id: &str,
    entry: &crate::models::TokenUsageEntry,
    usage_complete: bool,
) -> Result<(), LanKeyError> {
    let paths = storage::resolve_paths(app).map_err(|_| LanKeyError::Unavailable)?;
    let rates = crate::codex_usage_cost_rates::load(&paths);
    let provider = entry
        .provider_id
        .as_deref()
        .and_then(|id| crate::providers::read_provider(&paths, id).ok());
    let incomplete = !usage_complete
        || rates.is_err()
        || entry.input_tokens.is_none()
        || entry.output_tokens.is_none();
    let cost_usd = rates
        .map(|rates| rates.estimate_cost(entry, provider.as_ref()))
        .unwrap_or(0.0);
    let tokens = entry.total_tokens.unwrap_or_else(|| {
        entry
            .input_tokens
            .unwrap_or(0)
            .saturating_add(entry.output_tokens.unwrap_or(0))
    });
    ledger::record(
        &paths,
        key_id,
        ledger::KeyUsage {
            tokens,
            cost_usd,
            incomplete,
        },
    )?;
    if let Err(error) = app.emit("local-proxy-lan-keys-updated", ()) {
        eprintln!("Failed to notify LAN key usage update: {error}");
    }
    Ok(())
}

#[cfg(test)]
mod tests;
