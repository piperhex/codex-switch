use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::{Mutex, OnceLock},
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::{os::windows::process::CommandExt, thread, time::Instant};

use chrono::{NaiveDate, TimeZone, Utc};
use reqwest::blocking::{Client, Response};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use crate::{
    agent_identity,
    auth::{
        account_fields, canonicalize_chatgpt_auth, is_agent_identity_auth,
        subscription_active_until, token_string, validate_auth,
    },
    codex_api::{
        consume_reset_credit_request, parse_reset_credits, parse_usage, quota_consumption_request,
        quota_consumption_response_completed, refresh_tokens, reset_credits_request,
        token_expiring, usage_request,
    },
    models::{
        AccountSummary, AppInfo, AppSettings, ManagerStateFile, ResetCreditsSummary, UsageSummary,
    },
    storage::{
        account_dir, auto_switch_priority_path, expiration_path, import_value,
        load_auto_switch_priority, load_expiration, load_note, load_official_account_access,
        load_usage, managed_auth_path, note_path, read_app_settings, read_json, read_state,
        resolve_paths, save_auto_switch_priority, save_expiration, save_note, save_usage,
        sync_current_into_store, touch_account_field, usage_path, write_app_settings,
        write_json_atomic, write_json_if_changed, write_managed_auth_if_changed, write_state,
        AccountSyncField, Paths,
    },
};

#[cfg(unix)]
const CHATGPT_COMMAND: &str = "chatgpt";
const OFFICIAL_CONVERSATION_PROVIDER: &str = "openai";
const LOCAL_PROXY_CONVERSATION_PROVIDER: &str = "codex-switch-local";
#[cfg(unix)]
const LEGACY_CODEX_COMMAND: &str = "codex";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const WINDOWS_11_FIRST_BUILD: u32 = 22_000;

static ACCOUNT_AUTO_SWITCH_STATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ACCOUNT_SWITCH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn account_auto_switch_state_lock() -> &'static Mutex<()> {
    ACCOUNT_AUTO_SWITCH_STATE_LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn account_switch_lock() -> &'static Mutex<()> {
    ACCOUNT_SWITCH_LOCK.get_or_init(|| Mutex::new(()))
}

/// Import the externally managed credential only once, when Codex Switch starts.
/// Later operations deliberately use the managed account store instead.
pub(crate) fn initialize_local_state<R: Runtime>(app: &tauri::AppHandle<R>) {
    let _ = sync_current_into_store(app);
    refresh_local_codex_path(app);
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
pub(crate) enum ChatGptLaunchTarget {
    ShellApp(String),
    Executable(String),
}

#[cfg(not(target_os = "windows"))]
pub(crate) type ChatGptLaunchTarget = String;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ManagedFolder {
    CodexHome,
    AccountStore,
}

#[tauri::command]
pub(crate) fn get_app_info<R: Runtime>(app: tauri::AppHandle<R>) -> Result<AppInfo, String> {
    let paths = resolve_paths(&app)?;
    Ok(AppInfo {
        codex_home: paths.codex_home.display().to_string(),
        auth_path: paths.current_auth.display().to_string(),
        config_path: paths.current_config.display().to_string(),
        account_store: paths.accounts.display().to_string(),
        provider_store: paths.providers.display().to_string(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub(crate) fn open_managed_folder<R: Runtime>(
    app: tauri::AppHandle<R>,
    target: ManagedFolder,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let path = match target {
        ManagedFolder::CodexHome => paths.codex_home,
        ManagedFolder::AccountStore => paths.accounts,
    };
    fs::create_dir_all(&path)
        .map_err(|error| format!("Failed to create {}: {error}", path.display()))?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))
}

#[tauri::command]
pub(crate) fn list_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<AccountSummary>, String> {
    // 非 ChatGPT 模式或损坏的当前 auth.json 不应阻止管理器打开。
    let paths = resolve_paths(&app)?;
    fs::create_dir_all(&paths.accounts).map_err(|error| format!("创建账户目录失败：{error}"))?;
    let state = read_state(&paths);
    let active_id = state.active_account_id.clone();
    let mut accounts = Vec::new();
    for entry in
        fs::read_dir(&paths.accounts).map_err(|error| format!("读取账户目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let auth_path = entry.path().join("auth.json");
        if !auth_path.exists() {
            continue;
        }
        let mut auth = read_json(&auth_path)?;
        let repaired = canonicalize_chatgpt_auth(&mut auth)?;
        let (email, auth_plan, account_id, id) = account_fields(&auth)?;
        if repaired {
            write_managed_auth_if_changed(&paths, &id, &auth)?;
        }
        let local_proxy_compatible = true;
        let agent_identity = is_agent_identity_auth(&auth);
        let direct_switch_compatible = !agent_identity;
        let auto_switch_enabled = !state.disabled_account_ids.contains(&id);
        let auto_switch_priority =
            load_auto_switch_priority(&auto_switch_priority_path(&paths, &id));
        let mut usage = load_usage(&usage_path(&paths, &id));
        usage.api_expires_at = subscription_active_until(&auth);
        let (official, metadata_editable) = load_official_account_access(&paths, &id);
        let plan = usage
            .plan
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(auth_plan);
        accounts.push(AccountSummary {
            active: active_id.as_deref() == Some(&id),
            usage,
            note: load_note(&note_path(&paths, &id)),
            expires_at: load_expiration(&expiration_path(&paths, &id)),
            id,
            email,
            plan,
            account_id,
            auto_switch_enabled,
            auto_switch_priority,
            local_proxy_compatible,
            direct_switch_compatible,
            agent_identity,
            official,
            metadata_editable,
        });
    }
    accounts.sort_by(|left, right| left.email.cmp(&right.email));
    Ok(accounts)
}

#[tauri::command]
pub(crate) fn copy_account_auth_json<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    if id.len() != 24 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Account does not exist".to_string());
    }

    let paths = resolve_paths(&app)?;
    let auth = load_validated_managed_auth(&paths, &id)?;
    let content = serde_json::to_string_pretty(&auth)
        .map_err(|error| format!("Failed to serialize auth.json: {error}"))?;
    app.clipboard()
        .write_text(content)
        .map_err(|error| format!("Failed to copy auth.json: {error}"))
}

#[tauri::command]
pub(crate) fn import_auth_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let auth = read_json(Path::new(&path))?;
    let id = import_value(&app, auth, false)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    Ok(id)
}

/// Imports a supported account JSON file by detecting standard auth.json,
/// sub2api-data exports, and compatible JSON/JSONL token layouts.
#[tauri::command]
pub(crate) fn import_account_json_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败：{error}", path))?;
    import_account_json_text(app, content)
}

#[tauri::command]
pub(crate) fn import_account_json_text<R: Runtime>(
    app: tauri::AppHandle<R>,
    content: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content = content.trim_start_matches('\u{feff}').trim();
    if content.is_empty() {
        return Err("导入内容为空".to_string());
    }
    let value = serde_json::from_str::<Value>(content).ok();

    if value.as_ref().is_some_and(is_sub2api_export) {
        let auth_values = parse_sub2api_auth_values(content)?;
        return import_normalized_json_auth_values(&app, &auth_values, normalize_sub2api_auth);
    }

    if value.as_ref().is_some_and(is_valid_auth_json) {
        let id = import_value(&app, value.expect("checked above"), false)?;
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
        crate::system_tray::refresh_menu(&app);
        return Ok(CompatibleJsonImportResult {
            imported_ids: vec![id],
            skipped: Vec::new(),
        });
    }

    let auth_values = parse_compatible_json_auth_values(content)?;
    import_normalized_json_auth_values(&app, &auth_values, normalize_compatible_json_auth)
}

fn is_sub2api_export(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("type").and_then(Value::as_str) == Some("sub2api-data") {
        return true;
    }
    object
        .get("accounts")
        .and_then(Value::as_array)
        .is_some_and(|accounts| !accounts.is_empty() && accounts.iter().all(is_sub2api_account))
}

fn is_sub2api_account(value: &Value) -> bool {
    value.get("platform").and_then(Value::as_str) == Some("openai")
        && value.get("type").and_then(Value::as_str) == Some("oauth")
        && value.get("credentials").is_some_and(Value::is_object)
}

fn is_valid_auth_json(value: &Value) -> bool {
    let mut auth = value.clone();
    canonicalize_chatgpt_auth(&mut auth)
        .and_then(|_| validate_auth(&auth))
        .is_ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibleJsonImportResult {
    pub(crate) imported_ids: Vec<String>,
    pub(crate) skipped: Vec<String>,
}

#[derive(Default)]
struct CompatibleJsonAccountMetadata {
    note: Option<String>,
    expires_at: Option<String>,
    auto_switch_priority: Option<i32>,
    disabled: Option<bool>,
}

#[derive(Default)]
struct CompatibleJsonAuthTokens {
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    session_token: Option<String>,
}

impl CompatibleJsonAuthTokens {
    fn has_any(&self) -> bool {
        self.id_token.is_some()
            || self.access_token.is_some()
            || self.refresh_token.is_some()
            || self.session_token.is_some()
    }
}

/// Imports the common Codex token layouts used by account managers and session exports.
/// The stored result is always reduced to this app's canonical auth.json shape before validation.
#[tauri::command]
pub(crate) fn import_compatible_json_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败：{error}", path))?;
    let auth_values = parse_compatible_json_auth_values(&content)?;
    import_normalized_json_auth_values(&app, &auth_values, normalize_compatible_json_auth)
}

fn import_normalized_json_auth_values<R: Runtime>(
    app: &tauri::AppHandle<R>,
    auth_values: &[Value],
    normalize: fn(&Value) -> Result<Value, String>,
) -> Result<CompatibleJsonImportResult, String> {
    let mut normalized = Vec::new();
    let mut skipped = Vec::new();
    for (index, value) in auth_values.iter().enumerate() {
        match normalize(value) {
            Ok(auth) => normalized.push((auth, compatible_json_account_metadata(value))),
            Err(error) => skipped.push(format!("第 {} 个账号：{error}", index + 1)),
        }
    }
    if normalized.is_empty() {
        return Err(skipped
            .first()
            .cloned()
            .unwrap_or_else(|| "没有找到可导入的账号".to_string()));
    }

    let mut imported_ids = Vec::new();
    let paths = resolve_paths(app)?;
    let mut state = read_state(&paths);
    let mut state_changed = false;
    for (auth, metadata) in normalized {
        let id = import_value(app, auth, false)?;
        if let Some(note) = metadata.note {
            save_note(&note_path(&paths, &id), &note)?;
        }
        if let Some(expires_at) = metadata.expires_at {
            save_expiration(&expiration_path(&paths, &id), &expires_at)?;
        }
        if let Some(priority) = metadata.auto_switch_priority {
            save_auto_switch_priority(&auto_switch_priority_path(&paths, &id), priority)?;
        }
        if metadata.disabled == Some(true) {
            state_changed |= update_disabled_account_ids(&mut state, &id, false);
        }
        if !imported_ids.contains(&id) {
            imported_ids.push(id);
        }
    }
    if state_changed {
        write_state(&paths, &state)?;
    }

    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(app);
    Ok(CompatibleJsonImportResult {
        imported_ids,
        skipped,
    })
}

/// Imports the explicit `sub2api-data` export format and converts each supported
/// OpenAI OAuth or Agent Identity account into the auth.json shape consumed by Codex.
#[tauri::command]
pub(crate) fn import_sub2api_json_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败：{error}", path))?;
    let auth_values = parse_sub2api_auth_values(&content)?;
    import_normalized_json_auth_values(&app, &auth_values, normalize_sub2api_auth)
}

fn parse_sub2api_auth_values(content: &str) -> Result<Vec<Value>, String> {
    let content = content.trim_start_matches('\u{feff}').trim();
    if content.is_empty() {
        return Err("导入文件为空".to_string());
    }
    let value: Value =
        serde_json::from_str(content).map_err(|error| format!("sub2api JSON 格式无效：{error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "sub2api 导出文件顶层必须是 JSON 对象".to_string())?;
    if object
        .get("type")
        .is_some_and(|value| value.as_str() != Some("sub2api-data"))
    {
        return Err("不是有效的 sub2api 账号文件".to_string());
    }
    if object
        .get("version")
        .is_some_and(|value| value.as_i64() != Some(1))
    {
        return Err("仅支持 version=1 的 sub2api 导出文件".to_string());
    }
    let accounts = object
        .get("accounts")
        .and_then(Value::as_array)
        .ok_or_else(|| "sub2api 导出文件缺少 accounts 数组".to_string())?;
    if accounts.is_empty() {
        return Err("sub2api 导出文件中没有账号".to_string());
    }
    if accounts.len() > 1000 {
        return Err("单次最多导入 1000 个账号".to_string());
    }
    Ok(accounts.clone())
}

fn sub2api_required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| format!("sub2api credentials 缺少 {key}"))
}

fn normalize_sub2api_auth(value: &Value) -> Result<Value, String> {
    let account = value
        .as_object()
        .ok_or_else(|| "sub2api account 必须是 JSON 对象".to_string())?;
    if account.get("platform").and_then(Value::as_str) != Some("openai")
        || account.get("type").and_then(Value::as_str) != Some("oauth")
    {
        return Err("仅支持 platform=openai、type=oauth 的账号".to_string());
    }
    let credentials = account
        .get("credentials")
        .ok_or_else(|| "sub2api account 缺少 credentials".to_string())?;
    let auth_mode = credentials
        .get("auth_mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if !auth_mode.eq_ignore_ascii_case("agentIdentity") {
        let mut tokens = serde_json::Map::new();
        tokens.insert(
            "access_token".to_string(),
            Value::String(sub2api_required_string(credentials, "access_token")?.to_string()),
        );
        for key in ["id_token", "refresh_token"] {
            let value = credentials
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            tokens.insert(key.to_string(), Value::String(value.to_string()));
        }
        for (source, target) in [
            ("chatgpt_account_id", "account_id"),
            ("chatgpt_user_id", "chatgpt_user_id"),
            ("email", "email"),
            ("plan_type", "plan_type"),
            ("organization_id", "organization_id"),
            ("expires_at", "expires_at"),
        ] {
            if let Some(value) = credentials
                .get(source)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
            {
                tokens.insert(target.to_string(), Value::String(value.to_string()));
            }
        }

        let mut auth = serde_json::Map::new();
        auth.insert(
            "auth_mode".to_string(),
            Value::String("chatgpt".to_string()),
        );
        auth.insert("OPENAI_API_KEY".to_string(), Value::Null);
        auth.insert("tokens".to_string(), Value::Object(tokens));
        auth.insert(
            "last_refresh".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
        let mut auth = Value::Object(auth);
        canonicalize_chatgpt_auth(&mut auth)?;
        validate_auth(&auth)?;
        return Ok(auth);
    }

    let mut identity = serde_json::Map::new();
    for key in [
        "agent_runtime_id",
        "agent_private_key",
        "account_id",
        "chatgpt_user_id",
    ] {
        identity.insert(
            key.to_string(),
            Value::String(sub2api_required_string(credentials, key)?.to_string()),
        );
    }
    for key in ["task_id", "email", "plan_type"] {
        if let Some(value) = credentials
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
        {
            identity.insert(key.to_string(), Value::String(value.to_string()));
        }
    }
    identity.insert(
        "chatgpt_account_is_fedramp".to_string(),
        Value::Bool(
            credentials
                .get("chatgpt_account_is_fedramp")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        ),
    );

    let mut auth = serde_json::Map::new();
    auth.insert(
        "auth_mode".to_string(),
        Value::String("agentIdentity".to_string()),
    );
    auth.insert("agent_identity".to_string(), Value::Object(identity));
    let auth = Value::Object(auth);
    validate_auth(&auth)?;
    Ok(auth)
}

fn parse_compatible_json_auth_values(content: &str) -> Result<Vec<Value>, String> {
    let content = content.trim_start_matches('\u{feff}').trim();
    if content.is_empty() {
        return Err("导入文件为空".to_string());
    }

    match serde_json::from_str::<Value>(content) {
        Ok(value) => collect_compatible_json_accounts(&value),
        Err(parse_error) => parse_embedded_compatible_json(content)
            .map_err(|detail| format!("JSON 格式无效：{parse_error}；{detail}")),
    }
}

fn collect_compatible_json_accounts(value: &Value) -> Result<Vec<Value>, String> {
    let mut found = Vec::new();
    collect_compatible_json_accounts_at(value, 0, &mut found);
    if found.is_empty() {
        return Err("没有找到包含 Codex token 的账号对象".to_string());
    }
    if found.len() > 1000 {
        return Err("单次最多导入 1000 个账号".to_string());
    }
    Ok(found)
}

fn collect_compatible_json_accounts_at(value: &Value, depth: usize, found: &mut Vec<Value>) {
    if depth > 12 || found.len() > 1000 {
        return;
    }
    match value {
        Value::Array(items) => {
            for item in items {
                collect_compatible_json_accounts_at(item, depth + 1, found);
            }
        }
        Value::Object(object) => {
            if has_direct_compatible_json_token(value) {
                found.push(value.clone());
                return;
            }
            for (key, nested) in object {
                if matches!(
                    key.as_str(),
                    "accessToken" | "access_token" | "sessionToken"
                ) {
                    continue;
                }
                if let Value::String(raw) = nested {
                    if [
                        "auth",
                        "auth_json",
                        "authJson",
                        "session",
                        "session_json",
                        "sessionJson",
                    ]
                    .contains(&key.as_str())
                    {
                        if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                            collect_compatible_json_accounts_at(&parsed, depth + 1, found);
                        }
                    }
                } else {
                    collect_compatible_json_accounts_at(nested, depth + 1, found);
                }
            }
        }
        _ => {}
    }
}

fn has_direct_compatible_json_token(value: &Value) -> bool {
    first_compatible_json_string(
        value,
        &[
            &["id_token"],
            &["idToken"],
            &["access_token"],
            &["accessToken"],
            &["refresh_token"],
            &["refreshToken"],
            &["tokens", "id_token"],
            &["tokens", "idToken"],
            &["tokens", "access_token"],
            &["tokens", "accessToken"],
            &["tokens", "refresh_token"],
            &["tokens", "refreshToken"],
            &["token", "id_token"],
            &["token", "idToken"],
            &["token", "access_token"],
            &["token", "accessToken"],
            &["token", "refresh_token"],
            &["token", "refreshToken"],
            &["credentials", "id_token"],
            &["credentials", "idToken"],
            &["credentials", "access_token"],
            &["credentials", "accessToken"],
            &["credentials", "refresh_token"],
            &["credentials", "refreshToken"],
        ],
    )
    .is_some()
}

fn parse_embedded_compatible_json(content: &str) -> Result<Vec<Value>, String> {
    let mut values = Vec::new();
    for slice in extract_json_slices(content) {
        if let Ok(value) = serde_json::from_str::<Value>(slice) {
            values.extend(collect_compatible_json_accounts(&value).unwrap_or_default());
        }
    }
    if values.is_empty() {
        return Err("未找到可解析的账号 JSON".to_string());
    }
    if values.len() > 1000 {
        return Err("单次最多导入 1000 个账号".to_string());
    }
    Ok(values)
}

fn extract_json_slices(content: &str) -> Vec<&str> {
    let mut slices = Vec::new();
    let mut stack = Vec::new();
    let mut start = None;
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in content.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            if !stack.is_empty() {
                in_string = true;
            }
        } else if matches!(character, '{' | '[') {
            if stack.is_empty() {
                start = Some(index);
            }
            stack.push(character);
        } else if matches!(character, '}' | ']') {
            let Some(open) = stack.pop() else {
                continue;
            };
            if !matches!((open, character), ('{', '}') | ('[', ']')) {
                stack.clear();
                start = None;
            } else if stack.is_empty() {
                if let Some(start) = start.take() {
                    slices.push(&content[start..index + character.len_utf8()]);
                }
            }
        }
    }
    slices
}

fn normalize_compatible_json_auth(value: &Value) -> Result<Value, String> {
    let tokens = extract_compatible_json_tokens(value, 0).ok_or_else(|| {
        "未找到可用的 Codex token；支持 access_token/accessToken、完整 tokens、session/session_json 或 refresh_token"
            .to_string()
    })?;

    let mut token_object = serde_json::Map::new();
    if let Some(access_token) = tokens.access_token {
        token_object.insert("access_token".to_string(), Value::String(access_token));
    }
    if let Some(id_token) = tokens
        .id_token
        .filter(|token| crate::auth::decode_jwt(token).is_ok())
    {
        token_object.insert("id_token".to_string(), Value::String(id_token));
    }
    if let Some(refresh_token) = tokens
        .refresh_token
        .filter(|token| token != "__missing_refresh_token__")
    {
        token_object.insert("refresh_token".to_string(), Value::String(refresh_token));
    }
    if let Some(session_token) = tokens.session_token {
        token_object.insert("session_token".to_string(), Value::String(session_token));
    }
    for (target, paths) in [
        (
            "account_id",
            &[
                &["account", "id"][..],
                &["account_id"][..],
                &["chatgptAccountId"][..],
                &["chatgpt_account_id"][..],
                &["tokens", "accountId"][..],
                &["tokens", "account_id"][..],
                &["tokens", "chatgptAccountId"][..],
                &["tokens", "chatgpt_account_id"][..],
                &["token", "accountId"][..],
                &["token", "account_id"][..],
                &["token", "chatgptAccountId"][..],
                &["token", "chatgpt_account_id"][..],
                &["credentials", "chatgpt_account_id"][..],
                &["providerSpecificData", "chatgptAccountId"][..],
                &["providerSpecificData", "chatgpt_account_id"][..],
                &["meta", "chatgptAccountId"][..],
                &["meta", "chatgpt_account_id"][..],
            ][..],
        ),
        (
            "chatgpt_user_id",
            &[
                &["user", "id"][..],
                &["user_id"][..],
                &["chatgptUserId"][..],
                &["chatgpt_user_id"][..],
                &["tokens", "userId"][..],
                &["tokens", "user_id"][..],
                &["tokens", "chatgptUserId"][..],
                &["tokens", "chatgpt_user_id"][..],
                &["token", "userId"][..],
                &["token", "user_id"][..],
                &["token", "chatgptUserId"][..],
                &["token", "chatgpt_user_id"][..],
                &["credentials", "chatgpt_user_id"][..],
                &["providerSpecificData", "chatgptUserId"][..],
                &["providerSpecificData", "chatgpt_user_id"][..],
            ][..],
        ),
        (
            "email",
            &[
                &["user", "email"][..],
                &["email"][..],
                &["label"][..],
                &["meta", "label"][..],
                &["credentials", "email"][..],
                &["providerSpecificData", "email"][..],
            ][..],
        ),
        (
            "plan_type",
            &[
                &["account", "planType"][..],
                &["account", "plan_type"][..],
                &["planType"][..],
                &["plan_type"][..],
                &["credentials", "plan_type"][..],
                &["providerSpecificData", "chatgptPlanType"][..],
                &["providerSpecificData", "chatgpt_plan_type"][..],
            ][..],
        ),
        (
            "organization_id",
            &[
                &["organizationId"][..],
                &["organization_id"][..],
                &["meta", "organizationId"][..],
                &["meta", "organization_id"][..],
                &["credentials", "organization_id"][..],
                &["providerSpecificData", "organizationId"][..],
                &["providerSpecificData", "organization_id"][..],
            ][..],
        ),
        (
            "expires_at",
            &[
                &["expires"][..],
                &["expiresAt"][..],
                &["expires_at"][..],
                &["expired"][..],
                &["credentials", "expires_at"][..],
            ][..],
        ),
        (
            "workspace_id",
            &[
                &["account", "workspaceId"][..],
                &["account", "workspace_id"][..],
                &["workspaceId"][..],
                &["workspace_id"][..],
                &["meta", "workspaceId"][..],
                &["meta", "workspace_id"][..],
                &["credentials", "workspace_id"][..],
                &["providerSpecificData", "workspaceId"][..],
                &["providerSpecificData", "workspace_id"][..],
            ][..],
        ),
    ] {
        if let Some(value) = first_compatible_json_string(value, paths) {
            token_object.insert(target.to_string(), Value::String(value));
        }
    }
    if value.get("provider").and_then(Value::as_str) == Some("codex") {
        if let Some(id) = first_compatible_json_string(value, &[&["id"]]) {
            token_object
                .entry("account_id".to_string())
                .or_insert(Value::String(id));
        }
    }
    enrich_compatible_token_metadata(&mut token_object);

    let mut auth_object = serde_json::Map::new();
    auth_object.insert("tokens".to_string(), Value::Object(token_object));
    let mut auth = Value::Object(auth_object);

    if crate::auth::token_string(&auth, "access_token").is_none() {
        let client = api_client()?;
        refresh_tokens(&client, &mut auth)?;
    }

    canonicalize_chatgpt_auth(&mut auth)?;
    validate_auth(&auth)?;
    Ok(auth)
}

fn extract_compatible_json_tokens(value: &Value, depth: usize) -> Option<CompatibleJsonAuthTokens> {
    if depth > 4 {
        return None;
    }

    let tokens = CompatibleJsonAuthTokens {
        id_token: first_compatible_json_string(
            value,
            &[
                &["id_token"],
                &["idToken"],
                &["tokens", "id_token"],
                &["tokens", "idToken"],
                &["token", "id_token"],
                &["token", "idToken"],
                &["credentials", "id_token"],
                &["credentials", "idToken"],
            ],
        ),
        access_token: first_compatible_json_string(
            value,
            &[
                &["access_token"],
                &["accessToken"],
                &["tokens", "access_token"],
                &["tokens", "accessToken"],
                &["token", "access_token"],
                &["token", "accessToken"],
                &["credentials", "access_token"],
                &["credentials", "accessToken"],
            ],
        ),
        refresh_token: first_compatible_json_string(
            value,
            &[
                &["refresh_token"],
                &["refreshToken"],
                &["tokens", "refresh_token"],
                &["tokens", "refreshToken"],
                &["token", "refresh_token"],
                &["token", "refreshToken"],
                &["credentials", "refresh_token"],
                &["credentials", "refreshToken"],
            ],
        ),
        session_token: first_compatible_json_string(
            value,
            &[
                &["session_token"],
                &["sessionToken"],
                &["tokens", "session_token"],
                &["tokens", "sessionToken"],
                &["token", "session_token"],
                &["token", "sessionToken"],
                &["credentials", "session_token"],
            ],
        ),
    };
    if tokens.has_any() {
        return Some(tokens);
    }

    let object = value.as_object()?;
    for key in [
        "auth",
        "auth_json",
        "authJson",
        "session",
        "session_json",
        "sessionJson",
    ] {
        let Some(nested) = object.get(key) else {
            continue;
        };
        match nested {
            Value::Object(_) => {
                if let Some(tokens) = extract_compatible_json_tokens(nested, depth + 1) {
                    return Some(tokens);
                }
            }
            Value::String(raw) => {
                let parsed = serde_json::from_str::<Value>(raw).ok()?;
                if let Some(tokens) = extract_compatible_json_tokens(&parsed, depth + 1) {
                    return Some(tokens);
                }
            }
            _ => {}
        }
    }
    None
}

fn first_compatible_json_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| {
        let mut current = value;
        for key in *path {
            current = current.get(*key)?;
        }
        current
            .as_str()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn enrich_compatible_token_metadata(tokens: &mut serde_json::Map<String, Value>) {
    let token = tokens
        .get("id_token")
        .or_else(|| tokens.get("access_token"))
        .and_then(Value::as_str)
        .and_then(|token| crate::auth::decode_jwt(token).ok());
    let Some(claims) = token else {
        return;
    };
    let nested = claims
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object);
    let profile = claims
        .get("https://api.openai.com/profile")
        .and_then(Value::as_object);
    for (target, value) in [
        (
            "account_id",
            nested.and_then(|value| value.get("chatgpt_account_id")),
        ),
        (
            "chatgpt_user_id",
            nested
                .and_then(|value| {
                    value
                        .get("chatgpt_user_id")
                        .or_else(|| value.get("user_id"))
                })
                .or_else(|| claims.get("sub")),
        ),
        (
            "email",
            claims
                .get("email")
                .or_else(|| profile.and_then(|value| value.get("email"))),
        ),
        (
            "plan_type",
            nested.and_then(|value| value.get("chatgpt_plan_type")),
        ),
        (
            "organization_id",
            nested
                .and_then(|value| value.get("organization_id"))
                .or_else(|| {
                    nested?
                        .get("organizations")?
                        .as_array()?
                        .iter()
                        .find_map(|value| value.get("id"))
                }),
        ),
        ("workspace_id", claims.get("workspace_id")),
    ] {
        if !tokens.contains_key(target) {
            if let Some(value) = value
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                tokens.insert(target.to_string(), Value::String(value.to_string()));
            }
        }
    }
}

fn compatible_json_account_metadata(value: &Value) -> CompatibleJsonAccountMetadata {
    let note = first_compatible_json_string(
        value,
        &[
            &["account_note"],
            &["accountInfo"],
            &["account_info"],
            &["note"],
            &["notes"],
            &["remark"],
        ],
    );
    let expires_at = compatible_json_expiration(value);
    let auto_switch_priority = value
        .get("priority")
        .and_then(Value::as_i64)
        .and_then(|priority| i32::try_from(priority).ok());
    let disabled = value.get("disabled").and_then(Value::as_bool).or_else(|| {
        value
            .get("isActive")
            .and_then(Value::as_bool)
            .map(|active| !active)
    });
    CompatibleJsonAccountMetadata {
        note,
        expires_at,
        auto_switch_priority,
        disabled,
    }
}

fn compatible_json_expiration(value: &Value) -> Option<String> {
    for path in [
        &["expires"][..],
        &["expiresAt"][..],
        &["expires_at"][..],
        &["expired"][..],
        &["credentials", "expires_at"][..],
    ] {
        let mut current = value;
        let mut present = true;
        for key in path {
            let Some(nested) = current.get(*key) else {
                present = false;
                break;
            };
            current = nested;
        }
        if present {
            if let Some(date) = normalize_compatible_expiration(current) {
                return Some(date);
            }
        }
    }
    for token in [
        first_compatible_json_string(
            value,
            &[
                &["access_token"],
                &["accessToken"],
                &["tokens", "access_token"],
                &["tokens", "accessToken"],
                &["token", "access_token"],
                &["token", "accessToken"],
                &["credentials", "access_token"],
                &["credentials", "accessToken"],
            ],
        ),
        first_compatible_json_string(
            value,
            &[
                &["id_token"],
                &["idToken"],
                &["tokens", "id_token"],
                &["tokens", "idToken"],
                &["token", "id_token"],
                &["token", "idToken"],
                &["credentials", "id_token"],
                &["credentials", "idToken"],
            ],
        ),
    ]
    .into_iter()
    .flatten()
    {
        if let Ok(claims) = crate::auth::decode_jwt(&token) {
            if let Some(exp) = claims.get("exp").and_then(Value::as_i64) {
                return Utc
                    .timestamp_opt(exp, 0)
                    .single()
                    .map(|date| date.date_naive().to_string());
            }
        }
    }
    None
}

fn normalize_compatible_expiration(value: &Value) -> Option<String> {
    if let Some(number) = value.as_i64() {
        let seconds = if number > 100_000_000_000 {
            number / 1000
        } else {
            number
        };
        return Utc
            .timestamp_opt(seconds, 0)
            .single()
            .map(|date| date.date_naive().to_string());
    }
    let raw = value.as_str()?.trim();
    if let Ok(number) = raw.parse::<i64>() {
        let seconds = if number > 100_000_000_000 {
            number / 1000
        } else {
            number
        };
        return Utc
            .timestamp_opt(seconds, 0)
            .single()
            .map(|date| date.date_naive().to_string());
    }
    if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Some(date.to_string());
    }
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|date| date.date_naive().to_string())
}

#[tauri::command]
pub(crate) async fn switch_account<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || switch_account_blocking(app, id))
        .await
        .map_err(|error| format!("Account switch task failed: {error}"))?
}

/// Blocking account switch that must run off the UI thread. The switch spawns
/// PowerShell subprocesses and performs file I/O, so it is invoked through
/// `switch_account` on the desktop and directly from proxy request threads.
pub(crate) fn switch_account_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    refresh_local_codex_path(&app);
    switch_account_unlocked(&app, &id)
}

/// Switch an official account without ever exposing a running ChatGPT/Codex
/// process to the replacement credential.  The local proxy owns the active
/// credential while it is running, so proxy switches intentionally remain
/// hot and do not restart ChatGPT.
#[tauri::command]
pub(crate) async fn switch_account_and_restart_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        switch_account_and_restart_chatgpt_blocking(app, id)
    })
    .await
    .map_err(|error| format!("Account switch task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn deactivate_account_and_restart_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        deactivate_account_and_restart_chatgpt_blocking(app)
    })
    .await
    .map_err(|error| format!("Account deactivation task failed: {error}"))?
}

fn deactivate_account_and_restart_chatgpt_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    refresh_local_codex_path(&app);

    let proxy_running = crate::local_proxy::is_running();
    let client_was_running = !proxy_running && chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| refresh_and_get_chatgpt_launch_target(&app))
        .flatten();
    if client_was_running {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    let deactivate_result = deactivate_account_unlocked(&app, proxy_running);
    if !client_was_running {
        return deactivate_result.map(|_| ());
    }

    let restart_result = crate::codex_runtime::restart_managed_session().and_then(|restarted| {
        if restarted {
            Ok(())
        } else {
            start_chatgpt(launch_target.as_ref())
        }
    });
    match (deactivate_result, restart_result) {
        (Ok(_), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(format!(
            "Official account was deactivated, but ChatGPT/Codex could not be restarted ({error}). Please start ChatGPT or Codex manually."
        )),
        (Err(deactivate_error), Err(restart_error)) => Err(format!(
            "Official account could not be deactivated ({deactivate_error}), and ChatGPT/Codex could not be restarted ({restart_error})."
        )),
    }
}

fn deactivate_account_unlocked<R: Runtime>(
    app: &tauri::AppHandle<R>,
    proxy_running: bool,
) -> Result<Option<String>, String> {
    let paths = resolve_paths(app)?;
    let original_state = read_state(&paths);
    let Some(account_id) = original_state.active_account_id.clone() else {
        return Ok(None);
    };
    let mut state = original_state.clone();
    state.active_account_id = None;
    state.concurrent_account_routing_enabled = false;
    write_state(&paths, &state)?;

    let auth_result = if proxy_running {
        crate::providers::sync_local_proxy_openai_auth(&paths)
    } else {
        match fs::remove_file(&paths.current_auth) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Failed to remove current auth.json: {error}")),
        }
    };
    if let Err(error) = auth_result {
        let _ = write_state(&paths, &original_state);
        return Err(error);
    }

    touch_account_field(&paths, &account_id, AccountSyncField::Active)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    if proxy_running {
        crate::providers::refresh_official_codex_models_for_paths(&paths);
    }
    crate::system_tray::refresh_menu(app);
    Ok(Some(account_id))
}

pub(crate) fn switch_account_and_restart_chatgpt_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;

    // Refresh the launch hint for every account switch, including hot proxy
    // switches where no restart is needed.
    refresh_local_codex_path(&app);
    if crate::local_proxy::is_running() {
        return switch_account_unlocked(&app, &id);
    }

    // Validate the target before stopping ChatGPT so a malformed managed
    // credential cannot leave the user with a closed application.
    let paths = resolve_paths(&app)?;
    load_validated_managed_auth(&paths, &id)?;

    let launch_target = refresh_and_get_chatgpt_launch_target(&app);
    if chatgpt_or_codex_is_running()? {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    // When no client is running, write the replacement credential immediately.
    // When one is running, the preceding shutdown gives the same guarantee.
    switch_account_unlocked(&app, &id)?;
    if crate::codex_runtime::restart_managed_session()? {
        return Ok(());
    }

    start_chatgpt(launch_target.as_ref()).map_err(|error| {
        format!(
            "账户已切换，但无法自动启动 ChatGPT/Codex（{error}）。请手动启动 ChatGPT 或 Codex。"
        )
    })
}

fn switch_account_unlocked<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<(), String> {
    let proxy_running = crate::local_proxy::is_running();
    let paths = resolve_paths(app)?;
    let selected = load_validated_managed_auth(&paths, id)?;
    ensure_account_switch_allowed(&selected, proxy_running)?;
    let original_state = read_state(&paths);
    let mut state = original_state.clone();
    state.active_provider_id = None;
    state.active_account_id = Some(id.to_string());
    state.concurrent_account_routing_enabled = false;

    if proxy_running {
        // Publish the official route before changing config.toml. Codex watches that
        // file and may reconnect immediately; writing the config first would let the
        // reconnect race through the previously selected third-party Provider.
        write_state(&paths, &state)?;
        if let Err(error) = crate::providers::write_official_local_proxy_config(&paths) {
            let _ = write_state(&paths, &original_state);
            return Err(error);
        }
        if let Err(error) = crate::providers::sync_local_proxy_openai_auth(&paths) {
            let _ = write_state(&paths, &original_state);
            return Err(error);
        }
    } else {
        // The local proxy reads the selected managed credential.  Avoid modifying the
        // authentication file watched by the already-running Codex application.
        write_json_atomic(&paths.current_auth, &selected)?;
        // Always remove a stale managed Provider block, even if an older or partially
        // completed switch left active_provider_id out of sync with config.toml.
        crate::providers::restore_official_config(&paths)?;
        write_state(&paths, &state)?;
    }
    touch_account_field(&paths, id, AccountSyncField::Active)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    if proxy_running {
        crate::providers::refresh_official_codex_models_for_paths(&paths);
    }
    crate::system_tray::refresh_menu(app);
    Ok(())
}

fn ensure_account_switch_allowed(auth: &Value, proxy_running: bool) -> Result<(), String> {
    if !proxy_running && is_agent_identity_auth(auth) {
        return Err(
            "Agent Identity 账号只能在本地代理模式下切换。请先启动本地代理，再切换到该账号"
                .to_string(),
        );
    }
    Ok(())
}

pub(crate) fn load_validated_managed_auth(paths: &Paths, id: &str) -> Result<Value, String> {
    let mut auth = read_json(&managed_auth_path(paths, id))?;
    if canonicalize_chatgpt_auth(&mut auth)? {
        write_managed_auth_if_changed(paths, id, &auth)?;
    }
    validate_auth(&auth)?;
    Ok(auth)
}

pub(crate) fn write_managed_auth_to_current(paths: &Paths, id: &str) -> Result<(), String> {
    let auth = load_validated_managed_auth(paths, id)?;
    write_json_atomic(&paths.current_auth, &auth)
}

#[tauri::command]
pub(crate) fn set_account_auto_switch_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }
    set_account_auto_switch_enabled_for_paths(&paths, &id, enabled)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_auto_disable_status_codes<R: Runtime>(
    app: tauri::AppHandle<R>,
    mut status_codes: Vec<u16>,
) -> Result<AppSettings, String> {
    if status_codes
        .iter()
        .any(|status| !(100..=599).contains(status))
    {
        return Err("automatic disable status codes must be between 100 and 599".to_string());
    }
    status_codes.sort_unstable();
    status_codes.dedup();

    let mut settings = read_app_settings(&app)?;
    settings.auto_disable_status_codes = status_codes;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_account_auto_switch_priority<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    priority: i32,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }
    let path = auto_switch_priority_path(&paths, &id);
    if load_auto_switch_priority(&path) != priority || !path.exists() {
        save_auto_switch_priority(&path, priority)?;
        touch_account_field(&paths, &id, AccountSyncField::AutoSwitchPriority)?;
    }
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn update_disabled_account_ids(state: &mut ManagerStateFile, id: &str, enabled: bool) -> bool {
    let was_disabled = state
        .disabled_account_ids
        .iter()
        .any(|account_id| account_id == id);
    let should_be_disabled = !enabled;
    if enabled {
        state
            .disabled_account_ids
            .retain(|account_id| account_id != id);
    } else if !was_disabled {
        state.disabled_account_ids.push(id.to_string());
        state.disabled_account_ids.sort();
    }
    was_disabled != should_be_disabled
}

fn set_account_auto_switch_enabled_for_paths(
    paths: &Paths,
    id: &str,
    enabled: bool,
) -> Result<bool, String> {
    let _guard = account_auto_switch_state_lock()
        .lock()
        .map_err(|_| "Account auto-switch state lock is poisoned".to_string())?;
    let mut state = read_state(paths);
    let changed = update_disabled_account_ids(&mut state, id, enabled);
    if changed {
        write_state(paths, &state)?;
    }
    Ok(changed)
}

#[tauri::command]
pub(crate) fn delete_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let current_state = read_state(&paths);
    if current_state.active_account_id.as_deref() == Some(&id) {
        return Err("不能删除当前正在使用的账户，请先切换到其他账户".to_string());
    }
    if current_state.local_proxy_openai_auth_account_id.as_deref() == Some(&id) {
        return Err(
            "Cannot delete the OpenAI login account selected by the local proxy. Clear the proxy login selection first."
                .to_string(),
        );
    }
    let target = account_dir(&paths, &id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| format!("删除账户失败：{error}"))?;
    }
    set_account_auto_switch_enabled_for_paths(&paths, &id, true)?;
    let mut state = read_state(&paths);
    let cleared_image_generation_account =
        state.image_generation_account_id.as_deref() == Some(&id);
    if cleared_image_generation_account {
        state.image_generation_account_id = None;
        write_state(&paths, &state)?;
    }
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    if cleared_image_generation_account {
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
    }
    crate::system_tray::refresh_menu(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn restart_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || restart_chatgpt_blocking(app))
        .await
        .map_err(|error| format!("ChatGPT restart task failed: {error}"))?
}

pub(crate) fn restart_chatgpt_blocking<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    // Keep a manual account switch and a restart as one operation.  In proxy mode the
    // switch deliberately leaves auth.json alone while Codex is running, so the
    // restarted process must receive the selected credential before it starts.
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    restart_chatgpt_unlocked(&app)
}

pub(crate) fn restart_chatgpt_unlocked<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let launch_target = refresh_and_get_chatgpt_launch_target(app);
    stop_chatgpt_processes()?;
    wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    sync_active_proxy_auth_for_restart(app)?;
    restart_chatgpt_from_target(app, launch_target.as_ref())
}

#[tauri::command]
pub(crate) async fn launch_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || launch_chatgpt_blocking(app))
        .await
        .map_err(|error| format!("ChatGPT launch task failed: {error}"))?
}

fn launch_chatgpt_blocking<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    if chatgpt_or_codex_is_running()? {
        return Ok(false);
    }

    let launch_target = refresh_and_get_chatgpt_launch_target(&app);
    sync_active_proxy_auth_for_restart(&app)?;
    restart_chatgpt_from_target(&app, launch_target.as_ref())?;
    Ok(true)
}

pub(crate) fn restart_chatgpt_from_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
    launch_target: Option<&ChatGptLaunchTarget>,
) -> Result<(), String> {
    record_managed_launch_target(launch_target)?;
    if !crate::codex_runtime::restart_managed_session()? {
        start_chatgpt(launch_target)?;
    }
    refresh_local_codex_path_after_restart(app);
    Ok(())
}

#[cfg(target_os = "windows")]
fn record_managed_launch_target(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    let Some(ChatGptLaunchTarget::Executable(path)) = target else {
        return Ok(());
    };
    crate::codex_runtime::record_launch_executable(path)
}

#[cfg(not(target_os = "windows"))]
fn record_managed_launch_target(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn refresh_local_codex_path_after_restart<R: Runtime>(app: &tauri::AppHandle<R>) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if discover_running_chatgpt_or_codex_path().is_some() {
            refresh_local_codex_path(app);
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(not(target_os = "windows"))]
fn refresh_local_codex_path_after_restart<R: Runtime>(_app: &tauri::AppHandle<R>) {}

fn sync_active_proxy_auth_for_restart<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if !crate::local_proxy::is_running() {
        return Ok(());
    }

    let paths = resolve_paths(app)?;
    crate::providers::sync_local_proxy_openai_auth(&paths)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectConversationSyncResult {
    conversations_updated: usize,
    rollout_files_updated: usize,
}

pub(crate) fn sync_conversation_metadata_if_present(
    codex_home: &Path,
) -> Result<DirectConversationSyncResult, String> {
    sync_conversation_metadata_if_present_with_progress(codex_home, &mut |_, _| {})
}

pub(crate) fn sync_conversation_metadata_if_present_with_progress(
    codex_home: &Path,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<DirectConversationSyncResult, String> {
    if !has_codex_state_database(codex_home)? {
        return Ok(DirectConversationSyncResult {
            conversations_updated: 0,
            rollout_files_updated: 0,
        });
    }
    replace_conversation_provider_with_progress(
        codex_home,
        OFFICIAL_CONVERSATION_PROVIDER,
        LOCAL_PROXY_CONVERSATION_PROVIDER,
        progress,
    )
}

#[tauri::command]
pub(crate) async fn restore_non_proxy_conversations<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<DirectConversationSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || restore_non_proxy_conversations_blocking(app))
        .await
        .map_err(|error| format!("恢复非代理模式对话任务失败：{error}"))?
}

fn restore_non_proxy_conversations_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<DirectConversationSyncResult, String> {
    if crate::local_proxy::is_running() {
        return Err("请先停止本地代理，再恢复非代理模式对话".to_string());
    }

    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    let paths = resolve_paths(&app)?;
    let client_was_running = chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| refresh_and_get_chatgpt_launch_target(&app))
        .flatten();
    if client_was_running {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    let restore_result = restore_conversation_metadata_if_present(&paths.codex_home);
    let restart_result = if client_was_running {
        crate::codex_runtime::restart_managed_session().and_then(|restarted| {
            if restarted {
                Ok(())
            } else {
                start_chatgpt(launch_target.as_ref())
            }
        })
    } else {
        Ok(())
    };

    match (restore_result, restart_result) {
        (Ok(result), Ok(())) => Ok(result),
        (Err(restore_error), Ok(())) => Err(restore_error),
        (Ok(_), Err(restart_error)) => Err(format!(
            "非代理模式对话已恢复，但重新启动 ChatGPT/Codex 失败：{restart_error}。请手动启动 ChatGPT 或 Codex。"
        )),
        (Err(restore_error), Err(restart_error)) => Err(format!(
            "恢复非代理模式对话失败：{restore_error}；重新启动 ChatGPT/Codex 也失败：{restart_error}"
        )),
    }
}

pub(crate) fn restore_conversation_metadata_if_present(
    codex_home: &Path,
) -> Result<DirectConversationSyncResult, String> {
    restore_conversation_metadata_if_present_with_progress(codex_home, &mut |_, _| {})
}

pub(crate) fn restore_conversation_metadata_if_present_with_progress(
    codex_home: &Path,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<DirectConversationSyncResult, String> {
    if !has_codex_state_database(codex_home)? {
        return Ok(DirectConversationSyncResult {
            conversations_updated: 0,
            rollout_files_updated: 0,
        });
    }
    replace_conversation_provider_with_progress(
        codex_home,
        LOCAL_PROXY_CONVERSATION_PROVIDER,
        OFFICIAL_CONVERSATION_PROVIDER,
        progress,
    )
}

fn has_codex_state_database(codex_home: &Path) -> Result<bool, String> {
    let entries = match fs::read_dir(codex_home) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "无法读取 Codex Home {}：{error}",
                codex_home.display()
            ))
        }
    };
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Codex Home 目录项失败：{error}"))?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if file_name
            .strip_prefix("state_")
            .and_then(|value| value.strip_suffix(".sqlite"))
            .and_then(|value| value.parse::<u64>().ok())
            .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn replace_conversation_provider_with_progress(
    codex_home: &Path,
    source_provider: &str,
    target_provider: &str,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<DirectConversationSyncResult, String> {
    let state_database = latest_codex_state_database(codex_home)?;
    let mut connection = open_conversation_database(&state_database)?;
    if !sqlite_table_has_column(&connection, "threads", "model_provider")? {
        return Err(format!(
            "{} 中没有可识别的 Codex 对话表",
            state_database.display()
        ));
    }

    let conversation_rows =
        conversation_rollouts_for_provider(&connection, &state_database, source_provider)?;
    let conversation_ids = conversation_rows
        .iter()
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let mut unique_rollout_paths = HashSet::new();
    let conversation_rollouts = conversation_rows
        .into_iter()
        .filter_map(|(_, path)| unique_rollout_paths.insert(path.clone()).then_some(path))
        .collect::<Vec<_>>();
    let total_rollouts = conversation_rollouts.len();
    progress(0, total_rollouts);

    // Keep the primary database update uncommitted until every rollout and
    // desktop catalog has been updated. If any file fails, all completed file
    // changes are compensated before the error is returned.
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始更新 {}：{error}", state_database.display()))?;
    let conversations_updated = transaction
        .execute(
            "UPDATE threads SET model_provider = ?1 WHERE model_provider = ?2",
            params![target_provider, source_provider],
        )
        .map_err(|error| format!("更新 {} 失败：{error}", state_database.display()))?;

    let mut rollout_files_updated = 0;
    let mut updated_rollout_paths = Vec::new();
    for (index, rollout_path) in conversation_rollouts.iter().enumerate() {
        match update_rollout_provider(rollout_path, source_provider, target_provider) {
            Ok(true) => {
                rollout_files_updated += 1;
                updated_rollout_paths.push(rollout_path.clone());
            }
            Ok(false) => {}
            Err(error) => {
                let _ = transaction.rollback();
                let rollback_errors = rollback_rollout_providers(
                    &updated_rollout_paths,
                    target_provider,
                    source_provider,
                );
                return Err(conversation_transition_error(error, rollback_errors));
            }
        }
        progress(index + 1, total_rollouts);
    }

    if let Err(error) = update_desktop_thread_catalogs(
        codex_home,
        source_provider,
        target_provider,
        &conversation_ids,
    ) {
        let _ = transaction.rollback();
        let mut rollback_errors =
            rollback_rollout_providers(&updated_rollout_paths, target_provider, source_provider);
        if let Err(rollback_error) = update_desktop_thread_catalogs(
            codex_home,
            target_provider,
            source_provider,
            &conversation_ids,
        ) {
            rollback_errors.push(rollback_error);
        }
        return Err(conversation_transition_error(error, rollback_errors));
    }

    if let Err(error) = transaction.commit() {
        let mut rollback_errors =
            rollback_rollout_providers(&updated_rollout_paths, target_provider, source_provider);
        if let Err(rollback_error) = update_desktop_thread_catalogs(
            codex_home,
            target_provider,
            source_provider,
            &conversation_ids,
        ) {
            rollback_errors.push(rollback_error);
        }
        return Err(conversation_transition_error(
            format!("提交 {} 失败：{error}", state_database.display()),
            rollback_errors,
        ));
    }

    Ok(DirectConversationSyncResult {
        conversations_updated,
        rollout_files_updated,
    })
}

fn rollback_rollout_providers(
    rollout_paths: &[PathBuf],
    source_provider: &str,
    target_provider: &str,
) -> Vec<String> {
    rollout_paths
        .iter()
        .filter_map(|path| {
            update_rollout_provider(path, source_provider, target_provider)
                .err()
                .map(|error| format!("{}：{error}", path.display()))
        })
        .collect()
}

fn conversation_transition_error(error: String, rollback_errors: Vec<String>) -> String {
    if rollback_errors.is_empty() {
        format!("对话记录切换失败，已恢复原状态：{error}")
    } else {
        format!(
            "对话记录切换失败：{error}；自动恢复时仍有 {} 个文件失败，请重试或导出诊断日志",
            rollback_errors.len()
        )
    }
}

fn latest_codex_state_database(codex_home: &Path) -> Result<PathBuf, String> {
    let entries = fs::read_dir(codex_home)
        .map_err(|error| format!("无法读取 Codex Home {}：{error}", codex_home.display()))?;
    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Codex Home 目录项失败：{error}"))?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(version) = file_name
            .strip_prefix("state_")
            .and_then(|value| value.strip_suffix(".sqlite"))
            .and_then(|value| value.parse::<u64>().ok())
        else {
            continue;
        };
        candidates.push((version, entry.path()));
    }
    candidates
        .into_iter()
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
        .ok_or_else(|| format!("未在 {} 中找到 Codex 对话数据库", codex_home.display()))
}

fn open_conversation_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("无法打开 Codex 对话数据库 {}：{error}", path.display()))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("无法配置 Codex 对话数据库 {}：{error}", path.display()))?;
    Ok(connection)
}

pub(crate) fn conversation_titles_by_id(
    codex_home: &Path,
    conversation_ids: &HashSet<String>,
) -> Result<HashMap<String, String>, String> {
    if conversation_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let state_database = latest_codex_state_database(codex_home)?;
    let connection = open_conversation_database(&state_database)?;
    if !sqlite_table_has_column(&connection, "threads", "title")? {
        return Ok(HashMap::new());
    }

    let mut statement = connection
        .prepare("SELECT title FROM threads WHERE id = ?1")
        .map_err(|error| format!("无法查询 {}：{error}", state_database.display()))?;
    let mut titles = HashMap::new();
    for id in conversation_ids {
        let title = statement
            .query_row(params![id], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|error| {
                format!(
                    "无法读取 {} 中的对话标题：{error}",
                    state_database.display()
                )
            })?;
        if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
            titles.insert(id.clone(), title);
        }
    }
    Ok(titles)
}

fn sqlite_table_has_column(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("无法读取 SQLite 表 {table}：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("无法读取 SQLite 表 {table} 的字段：{error}"))?;
    for item in columns {
        if item.map_err(|error| format!("无法解析 SQLite 表 {table} 的字段：{error}"))? == column
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn conversation_rollouts_for_provider(
    connection: &Connection,
    database_path: &Path,
    provider: &str,
) -> Result<Vec<(String, PathBuf)>, String> {
    let mut statement = connection
        .prepare("SELECT id, rollout_path FROM threads WHERE model_provider = ?1")
        .map_err(|error| format!("无法查询 {}：{error}", database_path.display()))?;
    let rows = statement
        .query_map(params![provider], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("无法读取 {} 中的对话：{error}", database_path.display()))?;
    rows.map(|row| {
        row.map(|(id, path)| (id, PathBuf::from(path)))
            .map_err(|error| format!("无法解析 Codex 对话文件路径：{error}"))
    })
    .collect()
}

fn update_rollout_provider(
    path: &Path,
    source_provider: &str,
    target_provider: &str,
) -> Result<bool, String> {
    if !path.exists() {
        return Err(format!("Codex 对话文件不存在：{}", path.display()));
    }

    let source = fs::File::open(path)
        .map_err(|error| format!("无法打开 Codex 对话文件 {}：{error}", path.display()))?;
    let mut reader = BufReader::new(source);
    let mut first_line = String::new();
    reader
        .read_line(&mut first_line)
        .map_err(|error| format!("无法读取 Codex 对话文件 {}：{error}", path.display()))?;
    if first_line.trim().is_empty() {
        return Err(format!("Codex 对话文件为空：{}", path.display()));
    }

    let mut metadata: Value = serde_json::from_str(first_line.trim_end())
        .map_err(|error| format!("Codex 对话元数据无效 {}：{error}", path.display()))?;
    let Some(provider) = metadata.pointer_mut("/payload/model_provider") else {
        return Err(format!(
            "Codex 对话文件缺少 model_provider：{}",
            path.display()
        ));
    };
    if provider.as_str() != Some(source_provider) {
        return Ok(false);
    }
    *provider = Value::String(target_provider.to_string());

    let temp_path = path.with_extension(format!("codex-switch-sync-{}.tmp", std::process::id()));
    let write_result = (|| -> Result<(), String> {
        let temp = fs::File::create(&temp_path).map_err(|error| {
            format!(
                "无法创建 Codex 对话临时文件 {}：{error}",
                temp_path.display()
            )
        })?;
        let mut writer = BufWriter::new(temp);
        serde_json::to_writer(&mut writer, &metadata)
            .map_err(|error| format!("无法写入 Codex 对话元数据：{error}"))?;
        writer
            .write_all(b"\n")
            .and_then(|_| std::io::copy(&mut reader, &mut writer).map(|_| ()))
            .and_then(|_| writer.flush())
            .map_err(|error| format!("无法写入 Codex 对话文件 {}：{error}", path.display()))?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| format!("无法刷新 Codex 对话文件 {}：{error}", path.display()))
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    drop(reader);
    crate::storage::replace_file(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("无法提交 Codex 对话文件 {}：{error}", path.display())
    })?;
    Ok(true)
}

fn update_desktop_thread_catalogs(
    codex_home: &Path,
    source_provider: &str,
    target_provider: &str,
    conversation_ids: &[String],
) -> Result<(), String> {
    if conversation_ids.is_empty() {
        return Ok(());
    }
    let catalog_dir = codex_home.join("sqlite");
    if !catalog_dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(&catalog_dir)
        .map_err(|error| format!("无法读取 Codex 对话目录 {}：{error}", catalog_dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Codex 对话目录项失败：{error}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("db") {
            continue;
        }
        let mut connection = open_conversation_database(&path)?;
        if !sqlite_table_has_column(&connection, "local_thread_catalog", "model_provider")? {
            continue;
        }
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始更新 Codex 对话目录 {}：{error}", path.display()))?;
        {
            let mut statement = transaction
                .prepare(
                    "UPDATE local_thread_catalog SET model_provider = ?1 \
                     WHERE model_provider = ?2 AND thread_id = ?3",
                )
                .map_err(|error| {
                    format!("准备更新 Codex 对话目录 {} 失败：{error}", path.display())
                })?;
            for id in conversation_ids {
                statement
                    .execute(params![target_provider, source_provider, id])
                    .map_err(|error| {
                        format!("更新 Codex 对话目录 {} 失败：{error}", path.display())
                    })?;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("提交 Codex 对话目录 {} 失败：{error}", path.display()))?;
    }
    Ok(())
}

fn api_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))
}

fn refresh_auth_if_needed(
    client: &Client,
    auth: &mut Value,
    paths: &Paths,
    id: &str,
) -> Result<(), String> {
    if is_agent_identity_auth(auth) {
        return Ok(());
    }
    if token_expiring(auth) {
        refresh_tokens(client, auth)?;
        persist_request_auth(paths, id, auth)?;
    }
    Ok(())
}

fn is_active_account(paths: &Paths, id: &str) -> bool {
    read_state(paths).active_account_id.as_deref() == Some(id)
}

fn load_auth_for_request<R: Runtime>(
    _app: &tauri::AppHandle<R>,
    paths: &Paths,
    id: &str,
) -> Result<Value, String> {
    let managed_path = managed_auth_path(paths, id);
    // The current .codex/auth.json is a startup-only import source. Subsequent
    // account operations use the managed copy so external file changes cannot
    // silently alter the active account.
    let mut auth = read_json(&managed_path)?;
    if canonicalize_chatgpt_auth(&mut auth)? {
        write_managed_auth_if_changed(paths, id, &auth)?;
    }
    validate_auth(&auth)?;
    Ok(auth)
}

fn persist_request_auth(paths: &Paths, id: &str, auth: &Value) -> Result<(), String> {
    write_managed_auth_if_changed(paths, id, auth)?;
    sync_active_auth(paths, id, auth)
}

#[tauri::command]
pub(crate) async fn refresh_usage<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    tauri::async_runtime::spawn_blocking(move || refresh_usage_blocking(app, id))
        .await
        .map_err(|error| format!("刷新用量任务失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn consume_account_quota<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || consume_account_quota_blocking(app, id))
        .await
        .map_err(|error| format!("消耗额度任务失败：{error}"))?
}

fn consume_account_quota_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if read_state(&paths)
        .disabled_account_ids
        .iter()
        .any(|account_id| account_id == &id)
    {
        return Err("Account is disabled; quota consumption was skipped".to_string());
    }
    let mut auth = load_auth_for_request(&app, &paths, &id)?;
    let client = quota_consumption_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, &id)?;

    let response = if is_agent_identity_auth(&auth) {
        if agent_identity::ensure_task(&client, &mut auth)? {
            persist_request_auth(&paths, &id, &auth)?;
        }
        let response = send_quota_consumption_request(&client, &auth)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            let status = response.status();
            let body = response
                .text()
                .map_err(|error| format!("读取 Agent Identity 鉴权失败响应失败：{error}"))?;
            if !agent_identity::is_invalid_task_response(status, &body) {
                return Err(format!("Codex 对话接口返回 HTTP {status}"));
            }
            agent_identity::register_task(&client, &mut auth)?;
            persist_request_auth(&paths, &id, &auth)?;
            send_quota_consumption_request(&client, &auth)?
        } else {
            response
        }
    } else {
        let mut response = send_quota_consumption_request(&client, &auth)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            refresh_tokens(&client, &mut auth)?;
            persist_request_auth(&paths, &id, &auth)?;
            response = send_quota_consumption_request(&client, &auth)?;
        }
        response
    };

    ensure_quota_consumption_completed(response)?;
    persist_request_auth(&paths, &id, &auth)
}

fn quota_consumption_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("创建额度消耗网络客户端失败：{error}"))
}

fn send_quota_consumption_request(client: &Client, auth: &Value) -> Result<Response, String> {
    if is_agent_identity_auth(auth) {
        let authentication = agent_identity::request_authentication(auth)?;
        return quota_consumption_request(
            client,
            &authentication.authorization,
            Some(&authentication.account_id),
            authentication.is_fedramp,
        );
    }

    let access_token = token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 access_token".to_string())?;
    let (_, _, account_id, _) = account_fields(auth)?;
    quota_consumption_request(
        client,
        &format!("Bearer {access_token}"),
        account_id.as_deref(),
        false,
    )
}

fn ensure_quota_consumption_completed(response: Response) -> Result<(), String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("读取 Codex 对话响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("Codex 对话接口返回 HTTP {status}"));
    }
    if !quota_consumption_response_completed(&body) {
        return Err("Codex 对话流未正常完成".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn update_account_note<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    note: String,
    expires_at: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }
    let (official, metadata_editable) = load_official_account_access(&paths, &id);
    if official && !metadata_editable {
        return Err(
            "You do not have permission to edit this official account's note or expiration date"
                .to_string(),
        );
    }
    if !expires_at.is_empty() {
        NaiveDate::parse_from_str(&expires_at, "%Y-%m-%d")
            .map_err(|_| "Expiration date must use YYYY-MM-DD format".to_string())?;
    }
    save_note(&note_path(&paths, &id), &note)?;
    save_expiration(&expiration_path(&paths, &id), &expires_at)?;
    touch_account_field(&paths, &id, AccountSyncField::Note)?;
    touch_account_field(&paths, &id, AccountSyncField::ExpiresAt)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn refresh_usage_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    match try_refresh_usage_blocking(&app, &id) {
        Ok(usage) => Ok(usage),
        Err(error) => {
            if let Ok(paths) = resolve_paths(&app) {
                let settings = read_app_settings(&app).unwrap_or_default();
                let should_report_error =
                    settings.show_usage_network_errors || !is_usage_network_error(&error);
                let cached = UsageSummary {
                    error: should_report_error.then(|| error.clone()),
                    fetched_at: Some(Utc::now().to_rfc3339()),
                    ..load_usage(&usage_path(&paths, &id))
                };
                if save_usage(&usage_path(&paths, &id), &cached).is_ok() {
                    let _ = touch_account_field(&paths, &id, AccountSyncField::Usage);
                }
                // A usage refresh can fail for temporary reasons (for example, a network
                // disconnect or timeout). Only an explicitly configured upstream HTTP status
                // can turn a failure into a persisted account exclusion.
                let state = read_state(&paths);
                let disable_error = if should_disable_account_auto_switch(
                    &error,
                    state.auto_switch_on_quota_exhaustion
                        && state.auto_disable_unreachable_accounts,
                    &settings.auto_disable_status_codes,
                ) {
                    set_account_auto_switch_enabled_for_paths(&paths, &id, false).err()
                } else {
                    None
                };
                let _ = app.emit("accounts-changed", ());
                crate::system_tray::refresh_menu(&app);
                if let Some(disable_error) = disable_error {
                    return Err(format!("{error}；自动禁用账号失败：{disable_error}"));
                }
                if !should_report_error {
                    return Ok(cached);
                }
            }
            Err(error)
        }
    }
}

fn is_usage_network_error(error: &str) -> bool {
    if (100..=599).any(|status| error.contains(&format!("HTTP {status}"))) {
        return false;
    }

    let normalized = error.to_ascii_lowercase();
    [
        "error sending request",
        "failed to send request",
        "network",
        "timed out",
        "timeout",
        "connection",
        "dns",
        "tcp",
        "tls",
        "请求超时",
        "连接失败",
        "网络错误",
    ]
    .iter()
    .any(|fragment| normalized.contains(fragment))
}

fn should_disable_account_auto_switch(
    error: &str,
    auto_disable_enabled: bool,
    status_codes: &[u16],
) -> bool {
    // Usage and token-refresh failures include their upstream HTTP status in the error.
    // Only statuses selected by the user are eligible for automatic exclusion. Network errors,
    // timeouts, unmatched HTTP responses, and parsing failures always remain retryable.
    auto_disable_enabled
        && status_codes
            .iter()
            .any(|status| error.contains(&format!("HTTP {status}")))
}

fn try_refresh_usage_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<UsageSummary, String> {
    let paths = resolve_paths(app)?;
    let mut auth = load_auth_for_request(app, &paths, id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, id)?;

    let response = if is_agent_identity_auth(&auth) {
        if agent_identity::ensure_task(&client, &mut auth)? {
            persist_request_auth(&paths, id, &auth)?;
        }
        let response = agent_identity::usage_request(&client, &auth)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            let status = response.status();
            let body = response
                .text()
                .map_err(|error| format!("读取 Agent Identity 鉴权失败响应失败：{error}"))?;
            if !agent_identity::is_invalid_task_response(status, &body) {
                return Err(format!("Codex 用量接口返回 HTTP {status}"));
            }
            agent_identity::register_task(&client, &mut auth)?;
            persist_request_auth(&paths, id, &auth)?;
            agent_identity::usage_request(&client, &auth)?
        } else {
            response
        }
    } else {
        let mut response = usage_request(&client, &auth)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            refresh_tokens(&client, &mut auth)?;
            persist_request_auth(&paths, id, &auth)?;
            response = usage_request(&client, &auth)?;
        }
        response
    };

    if !response.status().is_success() {
        return Err(format!("Codex 用量接口返回 HTTP {}", response.status()));
    }

    let payload: Value = response
        .json()
        .map_err(|error| format!("解析用量响应失败：{error}"))?;
    let mut usage = parse_usage(&payload);
    usage.api_expires_at = subscription_active_until(&auth);
    save_usage(&usage_path(&paths, id), &usage)?;
    touch_account_field(&paths, id, AccountSyncField::Usage)?;
    persist_request_auth(&paths, id, &auth)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(app);
    Ok(usage)
}

#[tauri::command]
pub(crate) async fn fetch_reset_credits<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ResetCreditsSummary, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_reset_credits_blocking(app, id))
        .await
        .map_err(|error| format!("刷新重置卡任务失败：{error}"))?
}

fn fetch_reset_credits_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ResetCreditsSummary, String> {
    let paths = resolve_paths(&app)?;
    let mut auth = load_auth_for_request(&app, &paths, &id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, &id)?;

    fetch_reset_credits_with_retry(&client, &mut auth, &paths, &id)
}

fn fetch_reset_credits_with_retry(
    client: &Client,
    auth: &mut Value,
    paths: &Paths,
    id: &str,
) -> Result<ResetCreditsSummary, String> {
    let mut response = reset_credits_request(client, auth)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(client, auth)?;
        persist_request_auth(paths, id, auth)?;
        response = reset_credits_request(client, auth)?;
    }
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("凭证已失效，或请求未正确携带 Authorization，请重新登录".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("Codex 重置卡接口返回 HTTP {}", response.status()));
    }

    let payload: Value = response
        .json()
        .map_err(|error| format!("解析重置卡响应失败：{error}"))?;
    persist_request_auth(paths, id, auth)?;
    parse_reset_credits(&payload)
}

#[tauri::command]
pub(crate) async fn consume_reset_credit<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || consume_reset_credit_blocking(app, id))
        .await
        .map_err(|error| format!("使用重置卡任务失败：{error}"))?
}

fn consume_reset_credit_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    let mut auth = load_auth_for_request(&app, &paths, &id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, &id)?;

    let credits = fetch_reset_credits_with_retry(&client, &mut auth, &paths, &id)?;
    if credits.credits.is_empty() {
        return Err("当前账号没有可用重置卡".to_string());
    }

    let redeem_request_id = format!(
        "codex-switch-{}-{}",
        Utc::now().timestamp_millis(),
        rand::random::<u64>()
    );
    let mut response = consume_reset_credit_request(&client, &auth, &redeem_request_id)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(&client, &mut auth)?;
        persist_request_auth(&paths, &id, &auth)?;
        response = consume_reset_credit_request(&client, &auth, &redeem_request_id)?;
    }
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("凭证已失效，或请求未正确携带 Authorization，请重新登录".to_string());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Codex 重置卡使用接口返回 HTTP {}",
            response.status()
        ));
    }

    let payload: Value = response
        .json()
        .map_err(|error| format!("解析重置卡使用响应失败：{error}"))?;
    match payload.get("code").and_then(Value::as_str) {
        Some("reset") | Some("already_redeemed") => {
            persist_request_auth(&paths, &id, &auth)?;
            Ok(())
        }
        Some("no_credit") => Err("当前账号没有可用重置卡".to_string()),
        Some("nothing_to_reset") => Err("当前账号当前没有需要重置的用量窗口".to_string()),
        Some(code) => Err(format!("Codex 重置卡使用接口返回未知状态：{code}")),
        None => Err("Codex 重置卡使用接口响应缺少 code".to_string()),
    }
}

fn sync_active_auth(paths: &Paths, id: &str, auth: &Value) -> Result<(), String> {
    if !is_active_account(paths, id) {
        return Ok(());
    }

    sync_current_auth_if_client_stopped(paths, auth)?;
    Ok(())
}

/// Synchronize the startup credential only when no ChatGPT/Codex process can be observing it.
/// A failed process check is treated as "running" so background work never risks a hot write.
pub(crate) fn sync_current_auth_if_client_stopped(
    paths: &Paths,
    auth: &Value,
) -> Result<bool, String> {
    let Ok(_switch_guard) = account_switch_lock().lock() else {
        return Ok(false);
    };
    if matches!(read_json(&paths.current_auth), Ok(current) if current == *auth) {
        return Ok(true);
    }
    let client_running = chatgpt_or_codex_is_running().unwrap_or(true);
    sync_current_auth_with_client_state(paths, auth, client_running)
}

fn sync_current_auth_with_client_state(
    paths: &Paths,
    auth: &Value,
    client_running: bool,
) -> Result<bool, String> {
    if client_running {
        return Ok(false);
    }
    write_json_if_changed(&paths.current_auth, auth)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn refresh_local_codex_path<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(path) = discover_running_chatgpt_or_codex_path() else {
        return;
    };
    let Ok(paths) = resolve_paths(app) else {
        return;
    };
    let mut state = read_state(&paths);
    if state.local_codex_path.as_deref() != Some(path.as_str()) {
        state.local_codex_path = Some(path.clone());
        let _ = write_state(&paths, &state);
    }
    let _ = crate::codex_runtime::record_launch_executable(&path);
}

#[cfg(not(target_os = "windows"))]
fn refresh_local_codex_path<R: Runtime>(_app: &tauri::AppHandle<R>) {}

#[cfg(target_os = "windows")]
fn discover_running_chatgpt_or_codex_path() -> Option<String> {
    windows_powershell_line(
        "Get-Process -Name ChatGPT,codex -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1 -ExpandProperty Path",
    )
    .and_then(|path| normalize_windows_chatgpt_target(&path))
}

pub(crate) fn refresh_and_get_chatgpt_launch_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<ChatGptLaunchTarget> {
    refresh_local_codex_path(app);

    #[cfg(target_os = "windows")]
    {
        let saved_target = resolve_paths(app)
            .ok()
            .and_then(|paths| read_state(&paths).local_codex_path)
            .filter(|path| Path::new(path).is_file())
            .map(ChatGptLaunchTarget::Executable);
        saved_target.or_else(official_default_chatgpt_target)
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn official_default_chatgpt_target() -> Option<ChatGptLaunchTarget> {
    windows_powershell_line(
        "(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty InstallLocation)",
    )
    .and_then(|path| {
        let target = Path::new(&path).join("app").join("ChatGPT.exe");
        target
            .is_file()
            .then(|| target.as_os_str().to_string_lossy().into_owned())
    })
    .map(ChatGptLaunchTarget::Executable)
    .or_else(|| official_chatgpt_shell_app_id().map(ChatGptLaunchTarget::ShellApp))
}

#[cfg(target_os = "windows")]
fn official_chatgpt_shell_app_id() -> Option<String> {
    // Reading the package manifest avoids depending on the localized Start menu
    // display name. Get-StartApps remains a fallback for older package layouts.
    windows_powershell_line(
        "$package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1; if ($package) { $manifest = Get-AppxPackageManifest -Package $package.PackageFullName -ErrorAction SilentlyContinue; $application = @($manifest.Package.Applications.Application) | Select-Object -First 1; if ($application) { \"$($package.PackageFamilyName)!$($application.Id)\" } }",
    )
    .or_else(|| {
        windows_powershell_line(
            "$app = Get-StartApps | Where-Object { $_.AppID -like 'OpenAI.Codex_*!*' } | Select-Object -First 1; if ($app) { $app.AppID }",
        )
    })
}

#[cfg(target_os = "windows")]
pub(crate) fn chatgpt_or_codex_is_running() -> Result<bool, String> {
    let output = windows_hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "if (@(Get-Process -Name ChatGPT,codex -ErrorAction SilentlyContinue).Count -gt 0) { exit 0 } else { exit 1 }",
        ])
        .status()
        .map_err(|error| format!("检查 ChatGPT/Codex 进程失败：{error}"))?;
    Ok(output.success())
}

#[cfg(unix)]
pub(crate) fn chatgpt_or_codex_is_running() -> Result<bool, String> {
    for name in [CHATGPT_COMMAND, LEGACY_CODEX_COMMAND] {
        match Command::new("pgrep").args(["-x", name]).status() {
            Ok(status) if status.success() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(format!("检查 ChatGPT/Codex 进程失败：{error}")),
        }
    }
    Ok(false)
}

#[cfg(target_os = "windows")]
pub(crate) fn stop_chatgpt_processes() -> Result<(), String> {
    let output = windows_hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "$processes = Get-Process -Name ChatGPT,codex -ErrorAction SilentlyContinue; if ($processes) { $processes | Stop-Process -Force -ErrorAction Stop }",
        ])
        .output()
        .map_err(|error| format!("停止 ChatGPT 失败：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_output_error("停止 ChatGPT 失败", &output))
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn wait_for_chatgpt_processes_to_exit(timeout: Duration) -> Result<(), String> {
    // ChatGPT is a multi-process application.  Its main process can exit before a
    // renderer or the bundled `codex.exe` has gone away, and a remaining process
    // may briefly respawn another one.  Keep checking and terminating during the
    // whole grace period instead of terminating once and only passively waiting.
    let timeout_ms = timeout.as_millis();
    let script = format!(
        r#"
$deadline = [DateTime]::UtcNow.AddMilliseconds({timeout_ms})
while ($true) {{
    $running = @(Get-Process -Name ChatGPT,codex -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {{ exit 0 }}

    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    if ([DateTime]::UtcNow -ge $deadline) {{
        $details = $running | ForEach-Object {{ "$($_.ProcessName) (PID $($_.Id))" }}
        [Console]::Error.WriteLine("仍在运行：" + ($details -join ", "))
        exit 1
    }}
    Start-Sleep -Milliseconds 150
}}
"#,
    );
    let output = windows_hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|error| format!("确认 ChatGPT 已退出失败：{error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let suffix = if details.is_empty() {
            String::new()
        } else {
            format!("（{details}）")
        };
        Err(format!(
            "ChatGPT/Codex 进程未在 {} 秒内完全退出，已取消启动以避免旧凭据与新凭据竞争{suffix}",
            timeout.as_secs()
        ))
    }
}

#[cfg(unix)]
pub(crate) fn stop_chatgpt_processes() -> Result<(), String> {
    stop_unix_process(CHATGPT_COMMAND)?;
    stop_unix_process(LEGACY_CODEX_COMMAND)?;
    #[cfg(target_os = "macos")]
    {
        stop_unix_process("ChatGPT")?;
        stop_unix_process("Codex")?;
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn wait_for_chatgpt_processes_to_exit(_timeout: Duration) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn stop_unix_process(name: &str) -> Result<(), String> {
    let status = Command::new("pkill")
        .args(["-x", name])
        .status()
        .map_err(|error| format!("停止 ChatGPT 失败：{error}"))?;
    if status.success() || status.code() == Some(1) {
        Ok(())
    } else {
        Err(status_error("停止 ChatGPT 失败", status))
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn start_chatgpt(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    if is_windows_10() {
        return start_chatgpt_windows_10(target);
    }
    start_chatgpt_windows_default(target)
}

#[cfg(target_os = "windows")]
fn start_chatgpt_windows_default(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    match target {
        Some(ChatGptLaunchTarget::ShellApp(app_id)) => start_windows_shell_app(app_id),
        Some(ChatGptLaunchTarget::Executable(target)) => {
            start_windows_executable(target).or_else(start_official_windows_chatgpt)
        }
        None => Err("未找到本地 ChatGPT/Codex 路径，且官方默认安装路径不可用".to_string()),
    }
}

/// Windows 10 cannot reliably execute the full-trust entry point from the
/// protected WindowsApps directory with CreateProcess. Activate the Store app
/// by its application user model id instead, which lets the shell apply the
/// package identity and the current user's package permissions.
#[cfg(target_os = "windows")]
fn start_chatgpt_windows_10(target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    match target {
        Some(ChatGptLaunchTarget::ShellApp(app_id)) => {
            activate_windows_store_app(app_id).or_else(|native_error| {
                start_windows_shell_app(app_id).map_err(|shell_error| {
                    format!(
                        "Windows 10 原生应用激活失败：{native_error}；Shell 回退也失败：{shell_error}"
                    )
                })
            })
        }
        Some(ChatGptLaunchTarget::Executable(target))
            if is_windows_store_package_executable(target) =>
        {
            start_official_windows_10_chatgpt()
        }
        Some(ChatGptLaunchTarget::Executable(target)) => start_windows_executable(target)
            .or_else(|recorded_error| {
                start_official_windows_10_chatgpt().map_err(|official_error| {
                    format!(
                        "启动已记录的 ChatGPT/Codex 路径失败：{recorded_error}；Windows 10 应用包激活也失败：{official_error}"
                    )
                })
            }),
        None => start_official_windows_10_chatgpt(),
    }
}

#[cfg(target_os = "windows")]
fn start_official_windows_10_chatgpt() -> Result<(), String> {
    let app_id = official_chatgpt_shell_app_id()
        .ok_or_else(|| "Windows 10 未找到已安装的 ChatGPT 应用包身份".to_string())?;
    activate_windows_store_app(&app_id).or_else(|native_error| {
        start_windows_shell_app(&app_id).map_err(|shell_error| {
            format!("Windows 10 原生应用激活失败：{native_error}；Shell 回退也失败：{shell_error}")
        })
    })
}

#[cfg(target_os = "windows")]
fn activate_windows_store_app(app_id: &str) -> Result<(), String> {
    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::RPC_E_CHANGED_MODE,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE},
        },
    };

    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    let initialized_here = match unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok() {
        Ok(()) => true,
        // A Tauri worker may already have initialized COM with another apartment
        // model. COM is available in that case and must not be uninitialized here.
        Err(error) if error.code() == RPC_E_CHANGED_MODE => false,
        Err(error) => return Err(format!("初始化 Windows 10 应用激活环境失败：{error}")),
    };
    let _com = ComGuard(initialized_here);
    let manager: IApplicationActivationManager =
        unsafe { CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER) }
            .map_err(|error| format!("创建 Windows 10 应用激活器失败：{error}"))?;

    unsafe { manager.ActivateApplication(&HSTRING::from(app_id), &HSTRING::new(), AO_NONE) }
        .map(|_| ())
        .map_err(|error| format!("按应用包身份启动 ChatGPT 失败：{error}"))
}

#[cfg(target_os = "windows")]
fn start_windows_shell_app(app_id: &str) -> Result<(), String> {
    let app_uri = format!("shell:AppsFolder\\{app_id}");
    windows_hidden_command("explorer.exe")
        .arg(app_uri)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("通过 Windows Shell 启动 ChatGPT 失败：{error}"))
}

#[cfg(target_os = "windows")]
fn start_official_windows_chatgpt(recorded_error: String) -> Result<(), String> {
    let official_target = official_default_chatgpt_target().ok_or(recorded_error.clone())?;
    let result = match official_target {
        ChatGptLaunchTarget::ShellApp(app_id) => start_windows_shell_app(&app_id),
        ChatGptLaunchTarget::Executable(path) => start_windows_executable(&path),
    };
    result.map_err(|official_error| {
        format!(
            "Failed to start the recorded ChatGPT/Codex path: {recorded_error}; the official installation also failed: {official_error}"
        )
    })
}

#[cfg(target_os = "windows")]
fn is_windows_10() -> bool {
    let version = windows_version::OsVersion::current();
    !windows_version::is_server() && is_windows_10_version(version.major, version.build)
}

#[cfg(target_os = "windows")]
fn is_windows_10_version(major: u32, build: u32) -> bool {
    major == 10 && build < WINDOWS_11_FIRST_BUILD
}

#[cfg(target_os = "windows")]
fn is_windows_store_package_executable(target: &str) -> bool {
    Path::new(target).components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("WindowsApps")
    })
}

#[cfg(target_os = "windows")]
fn start_windows_executable(target: &str) -> Result<(), String> {
    let mut command = windows_hidden_command(target);
    if let Some(parent) = Path::new(target)
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        command.current_dir(parent);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))
}

#[cfg(target_os = "windows")]
fn windows_hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(target_os = "windows")]
fn windows_powershell_line(script: &str) -> Option<String> {
    let output = windows_hidden_command("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(target_os = "windows")]
fn normalize_windows_chatgpt_target(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let target = Path::new(trimmed);
    if is_chatgpt_exe(target) {
        return Some(trimmed.to_string());
    }

    if is_codex_exe(target) {
        if let Some(resources) = target
            .parent()
            .filter(|parent| is_dir_named(parent, "resources"))
        {
            if let Some(app_dir) = resources.parent() {
                let app_target = app_dir.join("ChatGPT.exe");
                if app_target.exists() {
                    return Some(app_target.as_os_str().to_string_lossy().into_owned());
                }
            }
        }
    }

    Some(trimmed.to_string())
}

#[cfg(target_os = "windows")]
fn is_chatgpt_exe(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("ChatGPT.exe"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_codex_exe(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("codex.exe"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_dir_named(path: &Path, expected: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
pub(crate) fn start_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    if matches!(Command::new("open").args(["-a", "ChatGPT"]).status(), Ok(status) if status.success())
    {
        return Ok(());
    }
    if matches!(Command::new("open").args(["-a", "Codex"]).status(), Ok(status) if status.success())
    {
        return Ok(());
    }

    let status = Command::new("osascript")
        .args([
            "-e",
            "tell application \"Terminal\" to activate",
            "-e",
            "tell application \"Terminal\" to do script \"chatgpt || codex\"",
        ])
        .status()
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(status_error("启动 ChatGPT 失败", status))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn start_chatgpt(_target: Option<&ChatGptLaunchTarget>) -> Result<(), String> {
    let terminals: &[(&str, &[&str])] = &[
        (
            "x-terminal-emulator",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "gnome-terminal",
            &["--", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "konsole",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        (
            "xfce4-terminal",
            &["-e", "sh", "-lc", "exec chatgpt || exec codex"],
        ),
        ("xterm", &["-e", "sh", "-lc", "exec chatgpt || exec codex"]),
    ];

    for (program, args) in terminals {
        match Command::new(program).args(*args).spawn() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("启动 ChatGPT 失败：{error}")),
        }
    }

    Command::new(CHATGPT_COMMAND)
        .spawn()
        .or_else(|_| Command::new(LEGACY_CODEX_COMMAND).spawn())
        .map(|_| ())
        .map_err(|error| format!("启动 ChatGPT 失败：{error}"))
}

fn command_output_error(action: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        status_error(action, output.status)
    } else {
        format!("{action}：{detail}")
    }
}

fn status_error(action: &str, status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("{action}（退出码：{code}）"),
        None => format!("{action}（进程被信号终止）"),
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_chatgpt_launch_tests {
    use super::{is_windows_10_version, is_windows_store_package_executable};

    #[test]
    fn selects_the_windows_10_launcher_only_for_windows_10_builds() {
        assert!(is_windows_10_version(10, 19_045));
        assert!(!is_windows_10_version(10, 22_000));
        assert!(!is_windows_10_version(11, 22_000));
    }

    #[test]
    fn detects_executables_inside_the_protected_windows_apps_directory() {
        assert!(is_windows_store_package_executable(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_1.0.0.0_x64__example\app\ChatGPT.exe"
        ));
        assert!(!is_windows_store_package_executable(
            r"C:\Users\Example\Apps\ChatGPT.exe"
        ));
    }
}

#[cfg(test)]
mod compatible_json_import_tests {
    use super::{
        compatible_json_account_metadata, ensure_account_switch_allowed, is_sub2api_export,
        is_usage_network_error, normalize_compatible_json_auth, normalize_sub2api_auth,
        parse_compatible_json_auth_values, parse_sub2api_auth_values,
        restore_conversation_metadata_if_present, should_disable_account_auto_switch,
        sync_conversation_metadata_if_present_with_progress, sync_current_auth_with_client_state,
        update_disabled_account_ids, write_managed_auth_to_current,
        LOCAL_PROXY_CONVERSATION_PROVIDER, OFFICIAL_CONVERSATION_PROVIDER,
    };
    use crate::models::ManagerStateFile;
    use crate::storage::{managed_auth_path, read_json, write_json_atomic, Paths};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use rusqlite::Connection;
    use serde_json::{json, Value};
    use std::{fs, path::PathBuf, time::SystemTime};

    fn jwt(payload: Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).expect("serialize JWT payload"))
        )
    }

    fn access_token() -> String {
        jwt(json!({
            "email": "compatible@example.com",
            "sub": "compatible-user",
            "https://api.openai.com/auth": {
                "chatgpt_plan_type": "plus",
                "chatgpt_account_id": "compatible-account"
            }
        }))
    }

    fn agent_identity_auth() -> Value {
        json!({
            "auth_mode": "agentIdentity",
            "agent_identity": {
                "agent_runtime_id": "agent-runtime",
                "agent_private_key": base64::engine::general_purpose::STANDARD.encode([7_u8; 48]),
                "account_id": "agent-workspace",
                "chatgpt_user_id": "agent-user",
                "email": "agent@example.com",
                "plan_type": "business"
            }
        })
    }

    fn test_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-auth-sync-test-{}",
            uuid::Uuid::new_v4()
        ));
        let codex_home = root.join("codex-home");
        let app_data = root.join("app-data");
        Paths {
            current_auth: codex_home.join("auth.json"),
            current_config: codex_home.join("config.toml"),
            codex_home,
            accounts: app_data.join("accounts"),
            providers: app_data.join("providers"),
            config_backup: app_data.join("config-before-provider.toml"),
            state_file: app_data.join("state.json"),
        }
    }

    #[test]
    fn accepts_cockpit_style_account_arrays() {
        let token = access_token();
        let input = json!([{
            "email": "compatible@example.com",
            "tokens": {
                "idToken": token,
                "accessToken": token,
                "refreshToken": "refresh-token"
            }
        }])
        .to_string();

        let values = parse_compatible_json_auth_values(&input).expect("parse compatible array");
        assert_eq!(values.len(), 1);
        let auth = normalize_compatible_json_auth(&values[0]).expect("normalize account");

        assert_eq!(
            auth.pointer("/tokens/access_token").and_then(Value::as_str),
            Some(token.as_str())
        );
        assert_eq!(
            auth.pointer("/tokens/refresh_token")
                .and_then(Value::as_str),
            Some("refresh-token")
        );
        assert_eq!(auth["auth_mode"], "chatgpt");
        assert!(auth["OPENAI_API_KEY"].is_null());
        assert!(
            chrono::DateTime::parse_from_rfc3339(auth["last_refresh"].as_str().unwrap()).is_ok()
        );
    }

    #[test]
    fn unwraps_json_encoded_session_values() {
        let token = access_token();
        let session = json!({
            "idToken": token,
            "accessToken": token,
        });
        let input = json!({ "session_json": session.to_string() }).to_string();

        let values = parse_compatible_json_auth_values(&input).expect("parse session wrapper");
        let auth = normalize_compatible_json_auth(&values[0]).expect("normalize session");

        assert_eq!(
            auth.pointer("/tokens/access_token").and_then(Value::as_str),
            Some(token.as_str())
        );
        assert_eq!(auth["tokens"]["refresh_token"], "");
    }

    #[test]
    fn converts_sub2api_agent_identity_exports_to_auth_json() {
        let input = json!({
            "type": "sub2api-data",
            "version": 1,
            "exported_at": "2026-07-22T01:42:51Z",
            "proxies": [],
            "accounts": [{
                "name": "agent@example.com",
                "platform": "openai",
                "type": "oauth",
                "credentials": {
                    "auth_mode": "agentIdentity",
                    "agent_runtime_id": "agent-runtime",
                    "agent_private_key": base64::engine::general_purpose::STANDARD.encode([9_u8; 48]),
                    "account_id": "workspace-1",
                    "chatgpt_user_id": "user-1",
                    "email": "agent@example.com",
                    "plan_type": "business",
                    "chatgpt_account_is_fedramp": false
                }
            }]
        })
        .to_string();

        let values = parse_sub2api_auth_values(&input).expect("parse sub2api export");
        assert_eq!(values.len(), 1);
        let auth = normalize_sub2api_auth(&values[0]).expect("normalize sub2api account");
        assert_eq!(auth["auth_mode"], "agentIdentity");
        assert_eq!(auth["agent_identity"]["account_id"], "workspace-1");
        assert_eq!(auth["agent_identity"]["email"], "agent@example.com");
        assert!(auth.get("tokens").is_none());
    }

    #[test]
    fn converts_sub2api_oauth_exports_with_opaque_access_tokens() {
        let input = json!({
            "type": "sub2api-data",
            "version": 1,
            "exported_at": "2026-07-23T06:05:26Z",
            "proxies": [],
            "accounts": [{
                "name": "person@example.com",
                "platform": "openai",
                "type": "oauth",
                "credentials": {
                    "access_token": "at-opaque-personal-access-token",
                    "chatgpt_account_id": "account-1",
                    "chatgpt_user_id": "user-1",
                    "email": "person@example.com",
                    "plan_type": "team",
                    "organization_id": "org-1",
                    "expires_at": "2026-10-21T02:37:37Z",
                    "id_token": "",
                    "refresh_token": ""
                }
            }]
        })
        .to_string();

        let values = parse_sub2api_auth_values(&input).expect("parse sub2api export");
        let auth = normalize_sub2api_auth(&values[0]).expect("normalize sub2api oauth account");

        assert_eq!(auth["auth_mode"], "chatgpt");
        assert_eq!(
            auth["tokens"]["access_token"],
            "at-opaque-personal-access-token"
        );
        assert_eq!(auth["tokens"]["account_id"], "account-1");
        assert_eq!(auth["tokens"]["chatgpt_user_id"], "user-1");
        assert_eq!(auth["tokens"]["email"], "person@example.com");
        assert_eq!(auth["tokens"]["plan_type"], "team");
        assert_eq!(auth["tokens"]["refresh_token"], "");
        crate::auth::validate_auth(&auth).unwrap();
    }

    #[test]
    fn accepts_headerless_sub2api_account_exports() {
        let input = json!({
            "exported_at": "2026-08-12T06:34:28Z",
            "proxies": [],
            "accounts": [{
                "name": "person@example.com",
                "platform": "openai",
                "type": "oauth",
                "credentials": {
                    "chatgpt_account_id": "workspace-1",
                    "chatgpt_account_is_fedramp": false,
                    "chatgpt_user_id": "user-1",
                    "plan_type": "team",
                    "access_token": "at-opaque-personal-access-token",
                    "auth_mode": "personalAccessToken",
                    "email": "person@example.com",
                    "openai_auth_mode": "personal_access_token",
                    "token_type": "Bearer"
                },
                "concurrency": 10,
                "priority": 1
            }]
        });

        assert!(is_sub2api_export(&input));
        let values = parse_sub2api_auth_values(&input.to_string())
            .expect("parse headerless sub2api account export");
        let auth = normalize_sub2api_auth(&values[0]).expect("normalize personal access token");

        assert_eq!(auth["auth_mode"], "chatgpt");
        assert_eq!(auth["tokens"]["account_id"], "workspace-1");
        assert_eq!(auth["tokens"]["chatgpt_user_id"], "user-1");
        assert_eq!(auth["tokens"]["email"], "person@example.com");
        assert_eq!(auth["tokens"]["plan_type"], "team");
        assert_eq!(auth["tokens"]["refresh_token"], "");
        crate::auth::validate_auth(&auth).unwrap();
    }

    #[test]
    fn preserves_explicit_identity_from_compatible_access_only_accounts() {
        let input = json!({
            "token": {
                "accessToken": "at-opaque-personal-access-token"
            },
            "user": {
                "id": "user-1",
                "email": "person@example.com"
            },
            "account": {
                "id": "workspace-1",
                "planType": "team"
            }
        });

        let auth = normalize_compatible_json_auth(&input).expect("normalize access-only account");

        assert_eq!(
            auth["tokens"]["access_token"],
            "at-opaque-personal-access-token"
        );
        assert_eq!(auth["tokens"]["account_id"], "workspace-1");
        assert_eq!(auth["tokens"]["chatgpt_user_id"], "user-1");
        assert_eq!(auth["tokens"]["email"], "person@example.com");
        assert_eq!(auth["tokens"]["plan_type"], "team");
        crate::auth::validate_auth(&auth).unwrap();
    }

    #[test]
    fn recursively_finds_accounts_and_parses_json_embedded_in_text() {
        let token = access_token();
        let nested = json!({
            "data": {
                "items": [{
                    "session": {
                        "accessToken": token,
                        "user": { "id": "nested-user", "email": "nested@example.com" },
                        "account": { "id": "nested-account" }
                    }
                }]
            }
        });
        let values = parse_compatible_json_auth_values(&nested.to_string()).unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0]["user"]["id"], "nested-user");

        let mixed = format!("card data: {} trailing text", nested);
        let values = parse_compatible_json_auth_values(&mixed).unwrap();
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn imports_reference_page_metadata_aliases() {
        let token = jwt(json!({ "sub": "metadata-user", "exp": 1_800_000_000_i64 }));
        let input = json!({
            "provider": "codex",
            "id": "router-account",
            "accessToken": token,
            "remark": "imported note",
            "priority": 42,
            "isActive": false
        });
        let auth = normalize_compatible_json_auth(&input).unwrap();
        let metadata = compatible_json_account_metadata(&input);

        assert_eq!(auth["tokens"]["account_id"], "router-account");
        assert_eq!(metadata.note.as_deref(), Some("imported note"));
        assert_eq!(metadata.expires_at.as_deref(), Some("2027-01-15"));
        assert_eq!(metadata.auto_switch_priority, Some(42));
        assert_eq!(metadata.disabled, Some(true));
    }

    #[test]
    fn discards_axonhub_refresh_token_placeholder() {
        let token = access_token();
        let auth = normalize_compatible_json_auth(&json!({
            "access_token": token,
            "refresh_token": "__missing_refresh_token__"
        }))
        .unwrap();
        assert_eq!(auth["tokens"]["refresh_token"], "");
    }

    #[test]
    fn synchronizes_agent_identity_auth_to_local_codex_auth_json() {
        let paths = test_paths();
        let auth = agent_identity_auth();
        let (_, _, _, id) = crate::auth::account_fields(&auth).unwrap();
        write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();

        write_managed_auth_to_current(&paths, &id).unwrap();

        assert_eq!(read_json(&paths.current_auth).unwrap(), auth);
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn allows_agent_identity_switches_only_while_local_proxy_is_running() {
        let auth = agent_identity_auth();
        ensure_account_switch_allowed(&auth, true).unwrap();
        let error = ensure_account_switch_allowed(&auth, false).unwrap_err();
        assert!(error.contains("本地代理模式"));
    }

    #[test]
    fn background_auth_sync_defers_writes_while_client_is_running() {
        let paths = test_paths();
        let old_auth = json!({ "credential": "old" });
        let new_auth = json!({ "credential": "new" });
        write_json_atomic(&paths.current_auth, &old_auth).unwrap();

        assert!(!sync_current_auth_with_client_state(&paths, &new_auth, true).unwrap());
        assert_eq!(read_json(&paths.current_auth).unwrap(), old_auth);

        assert!(sync_current_auth_with_client_state(&paths, &new_auth, false).unwrap());
        assert_eq!(read_json(&paths.current_auth).unwrap(), new_auth);

        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn selected_managed_auth_replaces_stale_current_auth() {
        let paths = test_paths();
        let token = access_token();
        let selected = json!({
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": null,
            "tokens": {
                "id_token": token,
                "access_token": token,
                "refresh_token": "refresh-token"
            },
            "last_refresh": "2026-07-21T00:00:00Z"
        });
        write_json_atomic(&managed_auth_path(&paths, "selected"), &selected).unwrap();
        write_json_atomic(&paths.current_auth, &json!({ "credential": "stale" })).unwrap();

        write_managed_auth_to_current(&paths, "selected").unwrap();

        assert_eq!(
            read_json(&paths.current_auth).unwrap(),
            read_json(&managed_auth_path(&paths, "selected")).unwrap()
        );
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn updates_disabled_account_ids_without_duplicates() {
        let mut state = ManagerStateFile::default();

        assert!(update_disabled_account_ids(&mut state, "account-b", false));
        assert!(update_disabled_account_ids(&mut state, "account-a", false));
        assert!(!update_disabled_account_ids(&mut state, "account-a", false));
        assert_eq!(state.disabled_account_ids, ["account-a", "account-b"]);

        assert!(update_disabled_account_ids(&mut state, "account-a", true));
        assert!(!update_disabled_account_ids(&mut state, "account-a", true));
        assert_eq!(state.disabled_account_ids, ["account-b"]);
    }

    #[test]
    fn usage_refresh_failures_only_disable_enabled_access_rejections() {
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 401 Unauthorized",
            true,
            &[401, 402, 403],
        ));
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 403 Forbidden",
            true,
            &[401, 402, 403],
        ));
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 402 Payment Required",
            true,
            &[401, 402, 403],
        ));

        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 401 Unauthorized",
            false,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 403 Forbidden",
            false,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 402 Payment Required",
            false,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "failed to read Codex usage: error sending request",
            true,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "failed to read Codex usage: operation timed out",
            true,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 503 Service Unavailable",
            true,
            &[401, 402, 403],
        ));
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 429 Too Many Requests",
            true,
            &[429],
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 401 Unauthorized",
            true,
            &[429],
        ));
    }

    #[test]
    fn usage_network_errors_exclude_explicit_http_statuses() {
        assert!(is_usage_network_error(
            "failed to read Codex usage: error sending request for url"
        ));
        assert!(is_usage_network_error(
            "failed to read Codex usage: operation timed out"
        ));
        assert!(is_usage_network_error("DNS lookup failed"));
        assert!(!is_usage_network_error(
            "Codex usage endpoint returned HTTP 503 Service Unavailable"
        ));
        assert!(!is_usage_network_error("failed to parse Codex usage"));
    }

    #[test]
    fn syncs_openai_conversations_into_the_local_proxy_history() {
        let codex_home = temporary_sync_test_dir();
        let rollout_path = codex_home.join("rollout.jsonl");
        fs::write(
            &rollout_path,
            format!(
                "{}\n{}\n",
                json!({
                    "type": "session_meta",
                    "payload": { "model_provider": "openai" }
                }),
                json!({ "type": "event_msg", "payload": { "type": "task_started" } })
            ),
        )
        .expect("write rollout");

        let state_path = codex_home.join("state_5.sqlite");
        let state = Connection::open(&state_path).expect("open state database");
        state
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    model_provider TEXT NOT NULL
                );",
            )
            .expect("create threads table");
        state
            .execute(
                "INSERT INTO threads (id, rollout_path, model_provider) VALUES (?1, ?2, 'openai')",
                ("thread-1", rollout_path.to_string_lossy().as_ref()),
            )
            .expect("insert thread");
        drop(state);

        let catalog_dir = codex_home.join("sqlite");
        fs::create_dir_all(&catalog_dir).expect("create catalog directory");
        let catalog_path = catalog_dir.join("codex-dev.db");
        let catalog = Connection::open(&catalog_path).expect("open catalog database");
        catalog
            .execute_batch(
                "CREATE TABLE local_thread_catalog (
                    thread_id TEXT PRIMARY KEY,
                    model_provider TEXT NOT NULL
                );
                INSERT INTO local_thread_catalog (thread_id, model_provider)
                VALUES ('thread-1', 'openai');",
            )
            .expect("create catalog");
        drop(catalog);

        let mut progress_updates = Vec::new();
        let result = sync_conversation_metadata_if_present_with_progress(
            &codex_home,
            &mut |processed, total| progress_updates.push((processed, total)),
        )
        .expect("sync conversations");
        assert_eq!(result.conversations_updated, 1);
        assert_eq!(result.rollout_files_updated, 1);
        assert_eq!(progress_updates, vec![(0, 1), (1, 1)]);

        let state = Connection::open(&state_path).expect("reopen state database");
        let state_provider: String = state
            .query_row(
                "SELECT model_provider FROM threads WHERE id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read state provider");
        assert_eq!(state_provider, LOCAL_PROXY_CONVERSATION_PROVIDER);

        let catalog = Connection::open(&catalog_path).expect("reopen catalog database");
        let catalog_provider: String = catalog
            .query_row(
                "SELECT model_provider FROM local_thread_catalog WHERE thread_id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read catalog provider");
        assert_eq!(catalog_provider, LOCAL_PROXY_CONVERSATION_PROVIDER);

        let metadata: Value = serde_json::from_str(
            fs::read_to_string(&rollout_path)
                .expect("read rollout")
                .lines()
                .next()
                .expect("rollout metadata"),
        )
        .expect("parse rollout metadata");
        assert_eq!(
            metadata
                .pointer("/payload/model_provider")
                .and_then(Value::as_str),
            Some(LOCAL_PROXY_CONVERSATION_PROVIDER)
        );

        drop(catalog);
        drop(state);

        let restored = restore_conversation_metadata_if_present(&codex_home)
            .expect("restore non-proxy conversations");
        assert_eq!(restored.conversations_updated, 1);
        assert_eq!(restored.rollout_files_updated, 1);

        let state = Connection::open(&state_path).expect("reopen restored state database");
        let state_provider: String = state
            .query_row(
                "SELECT model_provider FROM threads WHERE id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read restored state provider");
        assert_eq!(state_provider, OFFICIAL_CONVERSATION_PROVIDER);

        let catalog = Connection::open(&catalog_path).expect("reopen restored catalog database");
        let catalog_provider: String = catalog
            .query_row(
                "SELECT model_provider FROM local_thread_catalog WHERE thread_id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read restored catalog provider");
        assert_eq!(catalog_provider, OFFICIAL_CONVERSATION_PROVIDER);

        let metadata: Value = serde_json::from_str(
            fs::read_to_string(&rollout_path)
                .expect("read restored rollout")
                .lines()
                .next()
                .expect("restored rollout metadata"),
        )
        .expect("parse restored rollout metadata");
        assert_eq!(
            metadata
                .pointer("/payload/model_provider")
                .and_then(Value::as_str),
            Some(OFFICIAL_CONVERSATION_PROVIDER)
        );

        drop(catalog);
        drop(state);
        fs::remove_dir_all(&codex_home).expect("remove test directory");
    }

    #[test]
    fn rolls_back_conversation_transition_when_a_rollout_cannot_be_updated() {
        let codex_home = temporary_sync_test_dir();
        let rollout_path = codex_home.join("rollout.jsonl");
        fs::write(
            &rollout_path,
            format!(
                "{}\n{}\n",
                json!({
                    "type": "session_meta",
                    "payload": { "model_provider": LOCAL_PROXY_CONVERSATION_PROVIDER }
                }),
                json!({ "type": "event_msg", "payload": { "type": "task_started" } })
            ),
        )
        .expect("write rollout");
        let missing_rollout_path = codex_home.join("missing-rollout.jsonl");

        let state_path = codex_home.join("state_5.sqlite");
        let state = Connection::open(&state_path).expect("open state database");
        state
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    model_provider TEXT NOT NULL
                );",
            )
            .expect("create threads table");
        for (id, path) in [
            ("thread-1", &rollout_path),
            ("thread-2", &missing_rollout_path),
        ] {
            state
                .execute(
                    "INSERT INTO threads (id, rollout_path, model_provider) VALUES (?1, ?2, ?3)",
                    (
                        id,
                        path.to_string_lossy().as_ref(),
                        LOCAL_PROXY_CONVERSATION_PROVIDER,
                    ),
                )
                .expect("insert thread");
        }
        drop(state);

        let catalog_dir = codex_home.join("sqlite");
        fs::create_dir_all(&catalog_dir).expect("create catalog directory");
        let catalog_path = catalog_dir.join("codex-dev.db");
        let catalog = Connection::open(&catalog_path).expect("open catalog database");
        catalog
            .execute_batch(&format!(
                "CREATE TABLE local_thread_catalog (
                    thread_id TEXT PRIMARY KEY,
                    model_provider TEXT NOT NULL
                );
                INSERT INTO local_thread_catalog VALUES ('thread-1', '{LOCAL_PROXY_CONVERSATION_PROVIDER}');
                INSERT INTO local_thread_catalog VALUES ('thread-2', '{LOCAL_PROXY_CONVERSATION_PROVIDER}');"
            ))
            .expect("create catalog");
        drop(catalog);

        let error = restore_conversation_metadata_if_present(&codex_home)
            .expect_err("missing rollout should fail the transition");
        assert!(error.contains("已恢复原状态"));

        let state = Connection::open(&state_path).expect("reopen state database");
        let non_proxy_rows: i64 = state
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider = 'openai'",
                [],
                |row| row.get(0),
            )
            .expect("count restored state rows");
        assert_eq!(non_proxy_rows, 0);

        let catalog = Connection::open(&catalog_path).expect("reopen catalog database");
        let non_proxy_catalog_rows: i64 = catalog
            .query_row(
                "SELECT COUNT(*) FROM local_thread_catalog WHERE model_provider = 'openai'",
                [],
                |row| row.get(0),
            )
            .expect("count restored catalog rows");
        assert_eq!(non_proxy_catalog_rows, 0);

        let metadata: Value = serde_json::from_str(
            fs::read_to_string(&rollout_path)
                .expect("read rolled back rollout")
                .lines()
                .next()
                .expect("rollout metadata"),
        )
        .expect("parse rollout metadata");
        assert_eq!(
            metadata
                .pointer("/payload/model_provider")
                .and_then(Value::as_str),
            Some(LOCAL_PROXY_CONVERSATION_PROVIDER)
        );

        drop(catalog);
        drop(state);
        fs::remove_dir_all(&codex_home).expect("remove test directory");
    }

    fn temporary_sync_test_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "codex-switch-conversation-sync-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }
}
