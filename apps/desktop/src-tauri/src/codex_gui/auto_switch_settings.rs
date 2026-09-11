use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "codex-gui-auto-switch.json";
const CHANGED_EVENT: &str = "codex-gui-auto-switch-settings-changed";
const MAX_ACCOUNT_RULES: usize = 5_000;
const MAX_ID_LENGTH: usize = 256;
const MAX_PRIORITY: i32 = 1_000_000;
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, thiserror::Error)]
pub(crate) enum SettingsError {
    #[error("暂时无法保存或读取自动切号设置，请稍后重试。")]
    Storage,
    #[error("剩余额度阈值应在 0% 到 100% 之间。")]
    InvalidThreshold,
    #[error("账号设置无效，请重新打开设置后重试。")]
    InvalidAccounts,
    #[error("优先级应在 -1000000 到 1000000 之间。")]
    InvalidPriority,
    #[error("部分账号已不可用，请重新打开设置后重试。")]
    UnavailableAccount,
    #[error("备用 Provider 不可用，请重新选择。")]
    UnavailableProvider,
}

/// GUI switching policies never read or update the manager's switching settings.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct GuiAutoSwitchSettings {
    pub(crate) enabled: bool,
    pub(crate) switch_on_quota_exhaustion: bool,
    pub(crate) minimum_remaining_percent: f64,
    pub(crate) mode: GuiAutoSwitchMode,
    pub(crate) fallback_provider_id: Option<String>,
    pub(crate) accounts: Vec<GuiAutoSwitchAccount>,
}

impl Default for GuiAutoSwitchSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            switch_on_quota_exhaustion: true,
            minimum_remaining_percent: 0.0,
            mode: GuiAutoSwitchMode::Sequential,
            fallback_provider_id: None,
            accounts: Vec::new(),
        }
    }
}

impl GuiAutoSwitchSettings {
    /// Missing rules allow newly added accounts with zero priority and threshold.
    pub(crate) fn account_rule(&self, id: &str) -> Option<&GuiAutoSwitchAccount> {
        self.accounts
            .iter()
            .find(|account| account.account_id == id)
    }

    pub(crate) fn effective_threshold(&self, id: &str) -> f64 {
        self.minimum_remaining_percent.max(
            self.account_rule(id)
                .map_or(0.0, |account| account.threshold_percent),
        )
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GuiAutoSwitchMode {
    #[default]
    Sequential,
    Concurrent,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct GuiAutoSwitchAccount {
    pub(crate) account_id: String,
    pub(crate) enabled: bool,
    pub(crate) priority: i32,
    pub(crate) threshold_percent: f64,
}

impl Default for GuiAutoSwitchAccount {
    fn default() -> Self {
        Self {
            account_id: String::new(),
            enabled: true,
            priority: 0,
            threshold_percent: 0.0,
        }
    }
}

/// The persisted revision invalidates routing work after any settings save.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(crate) struct SettingsSnapshot {
    #[serde(flatten)]
    pub(crate) settings: GuiAutoSwitchSettings,
    #[serde(default)]
    pub(crate) revision: u64,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LENGTH
        && id.trim() == id
        && !matches!(id, "." | "..")
        && !id
            .chars()
            .any(|value| value.is_control() || matches!(value, '/' | '\\' | ':' | '\0'))
}

fn validate_threshold(percent: f64) -> Result<(), SettingsError> {
    if !percent.is_finite() || !(0.0..=100.0).contains(&percent) {
        return Err(SettingsError::InvalidThreshold);
    }
    Ok(())
}

fn validate_shape(settings: &GuiAutoSwitchSettings) -> Result<(), SettingsError> {
    validate_threshold(settings.minimum_remaining_percent)?;
    if settings.accounts.len() > MAX_ACCOUNT_RULES {
        return Err(SettingsError::InvalidAccounts);
    }
    let mut ids = HashSet::with_capacity(settings.accounts.len());
    for account in &settings.accounts {
        if !valid_id(&account.account_id) || !ids.insert(&account.account_id) {
            return Err(SettingsError::InvalidAccounts);
        }
        if !(-MAX_PRIORITY..=MAX_PRIORITY).contains(&account.priority) {
            return Err(SettingsError::InvalidPriority);
        }
        validate_threshold(account.threshold_percent)?;
    }
    if settings
        .fallback_provider_id
        .as_deref()
        .is_some_and(|id| !valid_id(id))
    {
        return Err(SettingsError::UnavailableProvider);
    }
    Ok(())
}

fn load(path: &Path) -> Result<SettingsSnapshot, SettingsError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SettingsSnapshot::default());
        }
        Err(_) => return Err(SettingsError::Storage),
    };
    let value: SettingsSnapshot =
        serde_json::from_slice(&bytes).map_err(|_| SettingsError::Storage)?;
    validate_shape(&value.settings)?;
    Ok(value)
}

/// Blocking callers only; async IPC commands delegate this operation to a worker.
pub(crate) fn snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<SettingsSnapshot, SettingsError> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| SettingsError::Storage)?;
    let _guard = SETTINGS_LOCK.lock().map_err(|_| SettingsError::Storage)?;
    load(&root.join(FILE_NAME))
}

pub(crate) fn read<R: Runtime>(app: &AppHandle<R>) -> Result<GuiAutoSwitchSettings, SettingsError> {
    snapshot(app).map(|value| value.settings)
}

/// Callbacks may only persist a selection; never refresh quotas or make requests here.
/// Lock order is settings, GUI selection, then routing; callers must preserve it.
pub(crate) fn with_current<R: Runtime, T>(
    app: &AppHandle<R>,
    expected_revision: u64,
    apply: impl FnOnce() -> T,
) -> Result<Option<T>, SettingsError> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| SettingsError::Storage)?;
    with_current_path(&root.join(FILE_NAME), expected_revision, apply)
}

fn with_current_path<T>(
    path: &Path,
    expected_revision: u64,
    apply: impl FnOnce() -> T,
) -> Result<Option<T>, SettingsError> {
    let _guard = SETTINGS_LOCK.lock().map_err(|_| SettingsError::Storage)?;
    if load(path)?.revision != expected_revision {
        return Ok(None);
    }
    Ok(Some(apply()))
}

fn validate_catalog_ids(
    settings: &GuiAutoSwitchSettings,
    available: &HashSet<&str>,
) -> Result<(), SettingsError> {
    if settings
        .accounts
        .iter()
        .any(|account| !available.contains(account.account_id.as_str()))
    {
        return Err(SettingsError::UnavailableAccount);
    }
    Ok(())
}

fn validate_accounts(
    app: &AppHandle,
    settings: &GuiAutoSwitchSettings,
) -> Result<(), SettingsError> {
    if settings.accounts.is_empty() {
        return Ok(());
    }
    let accounts =
        crate::commands::list_accounts_blocking(app.clone()).map_err(|_| SettingsError::Storage)?;
    let available = accounts
        .iter()
        .filter(|account| account.local_proxy_compatible)
        .map(|account| account.id.as_str())
        .collect::<HashSet<_>>();
    // Check the managed catalog before constructing credential paths from IPC IDs.
    validate_catalog_ids(settings, &available)?;
    let paths = crate::storage::resolve_paths(app).map_err(|_| SettingsError::Storage)?;
    for account in &settings.accounts {
        crate::commands::load_validated_managed_auth(&paths, &account.account_id)
            .map_err(|_| SettingsError::UnavailableAccount)?;
    }
    Ok(())
}

fn validate_provider(
    app: &AppHandle,
    settings: &GuiAutoSwitchSettings,
) -> Result<(), SettingsError> {
    let Some(id) = settings.fallback_provider_id.as_deref() else {
        return Ok(());
    };
    let providers = crate::providers::list_providers_blocking(app.clone())
        .map_err(|_| SettingsError::Storage)?;
    if !providers.iter().any(|provider| provider.id == id) {
        return Err(SettingsError::UnavailableProvider);
    }
    let paths = crate::storage::resolve_paths(app).map_err(|_| SettingsError::Storage)?;
    let provider = crate::providers::read_provider(&paths, id)
        .map_err(|_| SettingsError::UnavailableProvider)?;
    crate::providers::ensure_not_local_proxy_base_url(&provider.base_url)
        .map_err(|_| SettingsError::UnavailableProvider)
}

fn persist(
    path: &Path,
    settings: GuiAutoSwitchSettings,
) -> Result<SettingsSnapshot, SettingsError> {
    let _guard = SETTINGS_LOCK.lock().map_err(|_| SettingsError::Storage)?;
    let revision = load(path)?
        .revision
        .checked_add(1)
        .ok_or(SettingsError::Storage)?;
    let value = SettingsSnapshot { settings, revision };
    let json = serde_json::to_value(&value).map_err(|_| SettingsError::Storage)?;
    crate::storage::write_json_atomic(path, &json).map_err(|_| SettingsError::Storage)?;
    Ok(value)
}

fn save(
    app: &AppHandle,
    settings: GuiAutoSwitchSettings,
) -> Result<GuiAutoSwitchSettings, SettingsError> {
    validate_shape(&settings)?;
    validate_accounts(app, &settings)?;
    validate_provider(app, &settings)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| SettingsError::Storage)?;
    let value = persist(&root.join(FILE_NAME), settings)?;
    super::web::publish(app, CHANGED_EVENT, &value.settings);
    Ok(value.settings)
}

#[tauri::command]
pub(crate) async fn codex_gui_auto_switch_settings(
    app: AppHandle,
) -> Result<GuiAutoSwitchSettings, String> {
    tauri::async_runtime::spawn_blocking(move || read(&app))
        .await
        .map_err(|_| SettingsError::Storage.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_set_auto_switch_settings(
    app: AppHandle,
    settings: GuiAutoSwitchSettings,
) -> Result<GuiAutoSwitchSettings, String> {
    tauri::async_runtime::spawn_blocking(move || save(&app, settings))
        .await
        .map_err(|_| SettingsError::Storage.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "auto_switch_settings_tests.rs"]
mod tests;
