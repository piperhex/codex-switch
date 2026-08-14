use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use chrono::{DateTime, Utc};
use serde_json::Value;
use tauri::{Manager, Runtime};

use crate::{
    auth::{account_fields, canonicalize_chatgpt_auth, validate_auth},
    models::{
        AccountFieldModifiedAt, AppSettings, ManagerStateFile, UsageSummary, DEFAULT_CLOUD_BASE_URL,
    },
};

#[derive(Clone, Copy)]
pub(crate) enum AccountSyncField {
    Auth,
    Note,
    ExpiresAt,
    Usage,
    Active,
    AutoSwitchPriority,
}

#[derive(Clone)]
pub(crate) struct Paths {
    pub(crate) codex_home: PathBuf,
    pub(crate) current_auth: PathBuf,
    pub(crate) current_config: PathBuf,
    pub(crate) accounts: PathBuf,
    pub(crate) providers: PathBuf,
    pub(crate) config_backup: PathBuf,
    pub(crate) state_file: PathBuf,
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(1);

fn atomic_temp_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

pub(crate) fn resolve_codex_home() -> Result<PathBuf, String> {
    std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .ok_or_else(|| "无法定位用户 Home 目录".to_string())
}

pub(crate) fn resolve_paths<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Paths, String> {
    let codex_home = resolve_codex_home()?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let accounts = app_data.join("accounts");
    let providers = app_data.join("providers");
    Ok(Paths {
        current_auth: codex_home.join("auth.json"),
        current_config: codex_home.join("config.toml"),
        codex_home,
        config_backup: app_data.join("config-before-provider.toml"),
        state_file: app_data.join("state.json"),
        accounts,
        providers,
    })
}

pub(crate) fn read_json(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 {} 失败：{error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{} 不是有效 JSON：{error}", path.display()))
}

pub(crate) fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标路径没有父目录".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("创建 {} 失败：{error}", parent.display()))?;
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| format!("序列化 JSON 失败：{error}"))?;
    let temp = atomic_temp_path(path);
    fs::write(&temp, bytes).map_err(|error| format!("写入临时文件失败：{error}"))?;
    replace_file(&temp, path).map_err(|error| format!("提交 {} 失败：{error}", path.display()))
}

pub(crate) fn write_text_atomic(path: &Path, value: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Target path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let temp = atomic_temp_path(path);
    fs::write(&temp, value.as_bytes())
        .map_err(|error| format!("Failed to write temporary file: {error}"))?;
    replace_file(&temp, path).map_err(|error| format!("Failed to save {}: {error}", path.display()))
}

pub(crate) fn write_text_if_changed(path: &Path, value: &str) -> Result<bool, String> {
    match fs::read(path) {
        Ok(existing) if existing == value.as_bytes() => return Ok(false),
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!("Failed to read {}: {error}", path.display()));
        }
    }
    write_text_atomic(path, value)?;
    Ok(true)
}

pub(crate) fn write_json_if_changed(path: &Path, value: &Value) -> Result<bool, String> {
    if let Ok(existing) = read_json(path) {
        if existing == *value {
            return Ok(false);
        }
    }
    write_json_atomic(path, value)?;
    Ok(true)
}

#[cfg(not(windows))]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let mut source_wide: Vec<u16> = source.as_os_str().encode_wide().collect();
    source_wide.push(0);
    let mut destination_wide: Vec<u16> = destination.as_os_str().encode_wide().collect();
    destination_wide.push(0);
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub(crate) fn account_dir(paths: &Paths, id: &str) -> PathBuf {
    paths.accounts.join(id)
}

pub(crate) fn managed_auth_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("auth.json")
}

pub(crate) fn usage_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("usage.json")
}

pub(crate) fn note_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("note.txt")
}

pub(crate) fn expiration_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("expires-at.txt")
}

pub(crate) fn official_account_access_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("official-account-access.json")
}

pub(crate) fn load_official_account_access(paths: &Paths, id: &str) -> (bool, bool) {
    let Ok(value) = read_json(&official_account_access_path(paths, id)) else {
        return (false, true);
    };
    let official = value
        .get("official")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let metadata_editable = value
        .get("metadataEditable")
        .and_then(Value::as_bool)
        .unwrap_or(!official);
    (official, metadata_editable)
}

pub(crate) fn auto_switch_priority_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("auto-switch-priority.txt")
}

pub(crate) fn last_modified_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("last-modified-at.txt")
}

pub(crate) fn field_modified_at_path(paths: &Paths, id: &str) -> PathBuf {
    account_dir(paths, id).join("field-modified-at.json")
}

pub(crate) fn load_note(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub(crate) fn load_expiration(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub(crate) fn load_auto_switch_priority(path: &Path) -> i32 {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or_default()
}

pub(crate) fn save_note(path: &Path, note: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The note path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    if note.is_empty() {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("Failed to remove {}: {error}", path.display()))?;
        }
        return Ok(());
    }

    let temp = atomic_temp_path(path);
    fs::write(&temp, note.as_bytes())
        .map_err(|error| format!("Failed to write account note: {error}"))?;
    replace_file(&temp, path).map_err(|error| format!("Failed to save {}: {error}", path.display()))
}

pub(crate) fn save_expiration(path: &Path, expires_at: &str) -> Result<(), String> {
    save_note(path, expires_at)
}

pub(crate) fn save_auto_switch_priority(path: &Path, priority: i32) -> Result<(), String> {
    write_text_atomic(path, &priority.to_string())
}

pub(crate) fn parse_last_modified(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

pub(crate) fn load_last_modified(path: &Path) -> Option<DateTime<Utc>> {
    parse_last_modified(&fs::read_to_string(path).ok()?)
}

pub(crate) fn save_last_modified(path: &Path, modified_at: DateTime<Utc>) -> Result<(), String> {
    save_note(path, &modified_at.to_rfc3339())
}

pub(crate) fn save_account_last_modified(
    paths: &Paths,
    id: &str,
    modified_at: DateTime<Utc>,
) -> Result<(), String> {
    save_last_modified(&last_modified_path(paths, id), modified_at)
}

fn latest_file_modified(paths: &Paths, id: &str) -> Option<DateTime<Utc>> {
    [
        managed_auth_path(paths, id),
        note_path(paths, id),
        expiration_path(paths, id),
        usage_path(paths, id),
        auto_switch_priority_path(paths, id),
    ]
    .into_iter()
    .filter_map(|path| fs::metadata(path).ok()?.modified().ok())
    .map(DateTime::<Utc>::from)
    .max()
}

pub(crate) fn load_or_init_last_modified(paths: &Paths, id: &str) -> Result<DateTime<Utc>, String> {
    let path = last_modified_path(paths, id);
    if let Some(modified_at) = load_last_modified(&path) {
        return Ok(modified_at);
    }

    let modified_at = latest_file_modified(paths, id).unwrap_or_else(Utc::now);
    save_last_modified(&path, modified_at)?;
    Ok(modified_at)
}

fn file_modified_or_fallback(path: PathBuf, fallback: &str) -> String {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(DateTime::<Utc>::from)
        .unwrap_or_else(|| parse_last_modified(fallback).unwrap_or_else(Utc::now))
        .to_rfc3339()
}

fn fill_missing_field_modified_at(
    values: &mut AccountFieldModifiedAt,
    paths: &Paths,
    id: &str,
    fallback: &str,
) {
    if values.auth.trim().is_empty() {
        values.auth = file_modified_or_fallback(managed_auth_path(paths, id), fallback);
    }
    if values.note.trim().is_empty() {
        values.note = file_modified_or_fallback(note_path(paths, id), fallback);
    }
    if values.expires_at.trim().is_empty() {
        values.expires_at = file_modified_or_fallback(expiration_path(paths, id), fallback);
    }
    if values.usage.trim().is_empty() {
        values.usage = file_modified_or_fallback(usage_path(paths, id), fallback);
    }
    if values.active.trim().is_empty() {
        values.active = fallback.to_string();
    }
    if values.auto_switch_priority.trim().is_empty() {
        values.auto_switch_priority =
            file_modified_or_fallback(auto_switch_priority_path(paths, id), fallback);
    }
}

pub(crate) fn load_or_init_account_field_modified_at(
    paths: &Paths,
    id: &str,
) -> Result<AccountFieldModifiedAt, String> {
    let fallback = load_or_init_last_modified(paths, id)?.to_rfc3339();
    let path = field_modified_at_path(paths, id);
    let mut values = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<AccountFieldModifiedAt>(&bytes).ok())
        .unwrap_or_default();
    let original = serde_json::to_value(&values).map_err(|error| error.to_string())?;
    fill_missing_field_modified_at(&mut values, paths, id, &fallback);
    if serde_json::to_value(&values).map_err(|error| error.to_string())? != original {
        save_account_field_modified_at(paths, id, &values)?;
    }
    Ok(values)
}

pub(crate) fn save_account_field_modified_at(
    paths: &Paths,
    id: &str,
    values: &AccountFieldModifiedAt,
) -> Result<(), String> {
    let value = serde_json::to_value(values).map_err(|error| error.to_string())?;
    write_json_atomic(&field_modified_at_path(paths, id), &value)?;
    let latest = [
        &values.auth,
        &values.note,
        &values.expires_at,
        &values.usage,
        &values.active,
        &values.auto_switch_priority,
    ]
    .into_iter()
    .filter_map(|value| parse_last_modified(value))
    .max();
    if let Some(latest) = latest {
        save_account_last_modified(paths, id, latest)?;
    }
    Ok(())
}

pub(crate) fn touch_account_field(
    paths: &Paths,
    id: &str,
    field: AccountSyncField,
) -> Result<DateTime<Utc>, String> {
    let modified_at = Utc::now();
    let mut values = load_or_init_account_field_modified_at(paths, id)?;
    let value = modified_at.to_rfc3339();
    match field {
        AccountSyncField::Auth => values.auth = value,
        AccountSyncField::Note => values.note = value,
        AccountSyncField::ExpiresAt => values.expires_at = value,
        AccountSyncField::Usage => values.usage = value,
        AccountSyncField::Active => values.active = value,
        AccountSyncField::AutoSwitchPriority => values.auto_switch_priority = value,
    }
    save_account_field_modified_at(paths, id, &values)?;
    Ok(modified_at)
}

pub(crate) fn write_managed_auth_if_changed(
    paths: &Paths,
    id: &str,
    auth: &Value,
) -> Result<bool, String> {
    let changed = write_json_if_changed(&managed_auth_path(paths, id), auth)?;
    if changed {
        touch_account_field(paths, id, AccountSyncField::Auth)?;
    }
    Ok(changed)
}

pub(crate) fn read_state(paths: &Paths) -> ManagerStateFile {
    fs::read(&paths.state_file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn write_state(paths: &Paths, state: &ManagerStateFile) -> Result<(), String> {
    let value = serde_json::to_value(state).map_err(|error| error.to_string())?;
    write_json_atomic(&paths.state_file, &value)
}

pub(crate) fn app_settings_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("settings.json"))
}

pub(crate) fn read_app_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<AppSettings, String> {
    let path = app_settings_path(app)?;
    Ok(fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default())
}

pub(crate) fn write_app_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
) -> Result<(), String> {
    let path = app_settings_path(app)?;
    let value = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    write_json_atomic(&path, &value)
}

fn apply_app_settings_version_migration(settings: &mut AppSettings, current_version: &str) -> bool {
    if settings.last_started_version.as_deref() == Some(current_version) {
        return false;
    }
    if settings
        .cloud_base_url
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        settings.cloud_base_url = Some(DEFAULT_CLOUD_BASE_URL.to_string());
    }
    settings.last_started_version = Some(current_version.to_string());
    true
}

pub(crate) fn migrate_app_settings_for_version<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let mut settings = read_app_settings(app)?;
    let current_version = app.package_info().version.to_string();
    if apply_app_settings_version_migration(&mut settings, &current_version) {
        write_app_settings(app, &settings)?;
    }
    Ok(())
}

fn should_activate_import(
    state: &ManagerStateFile,
    activate: bool,
    current_auth_exists: bool,
) -> bool {
    activate
        || (!current_auth_exists
            && state.active_account_id.is_none()
            && state.active_provider_id.is_none())
}

fn should_sync_current_as_active(
    state: &ManagerStateFile,
    id: &str,
    agent_identity: bool,
    proxy_running: bool,
) -> bool {
    state.active_provider_id.is_none()
        && !state.local_proxy_enabled
        && !proxy_running
        && state.active_account_id.as_deref() != Some(id)
        && !agent_identity
}

pub(crate) fn import_value<R: Runtime>(
    app: &tauri::AppHandle<R>,
    mut auth: Value,
    activate: bool,
) -> Result<String, String> {
    canonicalize_chatgpt_auth(&mut auth)?;
    validate_auth(&auth)?;
    let paths = resolve_paths(app)?;
    let (_, _, _, id) = account_fields(&auth)?;
    let mut state = read_state(&paths);
    let should_activate = should_activate_import(&state, activate, paths.current_auth.exists());
    write_managed_auth_if_changed(&paths, &id, &auth)?;
    if should_activate {
        let proxy_running = crate::local_proxy::is_running();
        let can_activate = if proxy_running {
            true
        } else if crate::auth::is_agent_identity_auth(&auth) {
            false
        } else {
            crate::commands::sync_current_auth_if_client_stopped(&paths, &auth)?
        };
        if can_activate {
            state.active_account_id = Some(id.clone());
            write_state(&paths, &state)?;
            if crate::local_proxy::is_running() {
                crate::providers::apply_local_proxy_config_for_paths(&paths)?;
            }
        }
    }
    Ok(id)
}

pub(crate) fn sync_current_into_store<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    if !paths.current_auth.exists() {
        return Ok(());
    }
    let mut auth = read_json(&paths.current_auth)?;
    let repaired = canonicalize_chatgpt_auth(&mut auth)?;
    validate_auth(&auth)?;
    let id = import_value(app, auth.clone(), false)?;
    if repaired {
        crate::commands::sync_current_auth_if_client_stopped(&paths, &auth)?;
    }
    let mut state = read_state(&paths);
    // In proxy mode auth.json is either absent or belongs to the optional OpenAI
    // login-state account, which is independent from the upstream official account.
    // Do not let startup synchronization turn that credential into the active account.
    if should_sync_current_as_active(
        &state,
        &id,
        crate::auth::is_agent_identity_auth(&auth),
        crate::local_proxy::is_running(),
    ) {
        state.active_account_id = Some(id);
        write_state(&paths, &state)?;
    }
    Ok(())
}

pub(crate) fn load_usage(path: &Path) -> UsageSummary {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn save_usage(path: &Path, usage: &UsageSummary) -> Result<(), String> {
    let value = serde_json::to_value(usage).map_err(|error| error.to_string())?;
    write_json_atomic(path, &value)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        apply_app_settings_version_migration, should_activate_import,
        should_sync_current_as_active, write_text_if_changed,
    };
    use crate::models::{AppSettings, ManagerStateFile, DEFAULT_CLOUD_BASE_URL};

    #[test]
    fn text_is_only_replaced_when_contents_change() {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-storage-test-{}",
            uuid::Uuid::new_v4()
        ));
        let path = root.join("config.toml");

        assert!(write_text_if_changed(&path, "model = \"first\"\n").unwrap());
        assert!(!write_text_if_changed(&path, "model = \"first\"\n").unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "model = \"first\"\n");

        assert!(write_text_if_changed(&path, "model = \"second\"\n").unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "model = \"second\"\n");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn new_app_version_defaults_an_unconfigured_cloud_server() {
        let mut settings: AppSettings =
            serde_json::from_str(r#"{"cloudBaseUrl":null,"lastStartedVersion":"1.1.19"}"#).unwrap();

        assert!(apply_app_settings_version_migration(
            &mut settings,
            "1.1.20"
        ));
        assert_eq!(
            settings.cloud_base_url.as_deref(),
            Some(DEFAULT_CLOUD_BASE_URL)
        );
        assert_eq!(settings.last_started_version.as_deref(), Some("1.1.20"));
    }

    #[test]
    fn version_migration_preserves_a_custom_cloud_server() {
        let mut settings = AppSettings {
            cloud_base_url: Some("https://cloud.example.com".to_string()),
            last_started_version: Some("1.1.19".to_string()),
            ..AppSettings::default()
        };

        assert!(apply_app_settings_version_migration(
            &mut settings,
            "1.1.20"
        ));
        assert_eq!(
            settings.cloud_base_url.as_deref(),
            Some("https://cloud.example.com")
        );
    }

    #[test]
    fn version_migration_only_runs_once_per_version() {
        let mut settings = AppSettings {
            cloud_base_url: None,
            last_started_version: Some("1.1.20".to_string()),
            ..AppSettings::default()
        };

        assert!(!apply_app_settings_version_migration(
            &mut settings,
            "1.1.20"
        ));
        assert!(settings.cloud_base_url.is_none());
    }

    #[test]
    fn first_official_import_becomes_active_when_codex_has_no_auth() {
        assert!(should_activate_import(
            &ManagerStateFile::default(),
            false,
            false
        ));
    }

    #[test]
    fn passive_import_does_not_replace_existing_codex_auth() {
        assert!(!should_activate_import(
            &ManagerStateFile::default(),
            false,
            true
        ));
    }

    #[test]
    fn passive_import_does_not_take_over_an_active_provider() {
        let state = ManagerStateFile {
            active_provider_id: Some("provider-1".to_string()),
            ..ManagerStateFile::default()
        };

        assert!(!should_activate_import(&state, false, false));
    }

    #[test]
    fn explicit_activation_still_replaces_existing_codex_auth() {
        assert!(should_activate_import(
            &ManagerStateFile::default(),
            true,
            true
        ));
    }

    #[test]
    fn proxy_login_auth_does_not_replace_the_active_upstream_account_on_startup() {
        let state = ManagerStateFile {
            active_account_id: Some("upstream-account".to_string()),
            local_proxy_enabled: true,
            local_proxy_openai_auth_account_id: Some("login-account".to_string()),
            ..ManagerStateFile::default()
        };

        assert!(!should_sync_current_as_active(
            &state,
            "login-account",
            false,
            false
        ));
    }
}
