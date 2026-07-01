use std::{fs, path::Path, time::Duration};

use chrono::Utc;
use reqwest::blocking::Client;
use serde_json::Value;
use tauri::{Emitter, Runtime};

use crate::{
    auth::{account_fields, validate_auth},
    codex_api::{
        parse_reset_credits, parse_usage, refresh_tokens, reset_credits_request, token_expiring,
        usage_request,
    },
    models::{AccountSummary, AppInfo, ManagerStateFile, ResetCreditsSummary, UsageSummary},
    storage::{
        account_dir, import_value, load_usage, managed_auth_path, read_json, read_state,
        resolve_paths, save_usage, sync_current_into_store, usage_path, write_json_atomic,
        write_state,
    },
};

#[tauri::command]
pub(crate) fn get_app_info<R: Runtime>(app: tauri::AppHandle<R>) -> Result<AppInfo, String> {
    let paths = resolve_paths(&app)?;
    Ok(AppInfo {
        codex_home: paths.codex_home.display().to_string(),
        auth_path: paths.current_auth.display().to_string(),
        account_store: paths.accounts.display().to_string(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub(crate) fn list_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<AccountSummary>, String> {
    // 非 ChatGPT 模式或损坏的当前 auth.json 不应阻止管理器打开。
    let _ = sync_current_into_store(&app);
    let paths = resolve_paths(&app)?;
    fs::create_dir_all(&paths.accounts).map_err(|error| format!("创建账户目录失败：{error}"))?;
    let active_id = read_state(&paths).active_account_id;
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
        let auth = read_json(&auth_path)?;
        let (email, plan, account_id, id) = account_fields(&auth)?;
        accounts.push(AccountSummary {
            active: active_id.as_deref() == Some(&id),
            usage: load_usage(&usage_path(&paths, &id)),
            id,
            email,
            plan,
            account_id,
        });
    }
    accounts.sort_by(|left, right| left.email.cmp(&right.email));
    Ok(accounts)
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
    Ok(id)
}

#[tauri::command]
pub(crate) fn switch_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    // 尽力保存 Codex 在上次切换后自行刷新的 token。
    let _ = sync_current_into_store(&app);
    let paths = resolve_paths(&app)?;
    let selected = read_json(&managed_auth_path(&paths, &id))?;
    validate_auth(&selected)?;
    write_json_atomic(&paths.current_auth, &selected)?;
    write_state(
        &paths,
        &ManagerStateFile {
            active_account_id: Some(id),
        },
    )?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if read_state(&paths).active_account_id.as_deref() == Some(&id) {
        return Err("不能删除当前正在使用的账户，请先切换到其他账户".to_string());
    }
    let target = account_dir(&paths, &id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| format!("删除账户失败：{error}"))?;
    }
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())
}

fn api_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))
}

fn refresh_auth_if_needed(
    client: &Client,
    auth: &mut Value,
    auth_path: &Path,
) -> Result<(), String> {
    if token_expiring(auth) {
        refresh_tokens(client, auth)?;
        write_json_atomic(auth_path, auth)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn refresh_usage<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    let paths = resolve_paths(&app)?;
    let auth_path = managed_auth_path(&paths, &id);
    let mut auth = read_json(&auth_path)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &auth_path)?;

    let mut response = usage_request(&client, &auth)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(&client, &mut auth)?;
        write_json_atomic(&auth_path, &auth)?;
        response = usage_request(&client, &auth)?;
    }

    let result = if response.status().is_success() {
        let payload: Value = response
            .json()
            .map_err(|error| format!("解析用量响应失败：{error}"))?;
        Ok(parse_usage(&payload))
    } else {
        Err(format!("Codex 用量接口返回 HTTP {}", response.status()))
    };

    match result {
        Ok(usage) => {
            save_usage(&usage_path(&paths, &id), &usage)?;
            sync_active_auth(&paths, &id, &auth)?;
            app.emit("accounts-changed", ())
                .map_err(|error| error.to_string())?;
            Ok(usage)
        }
        Err(error) => {
            let cached = UsageSummary {
                error: Some(error.clone()),
                fetched_at: Some(Utc::now().to_rfc3339()),
                ..load_usage(&usage_path(&paths, &id))
            };
            let _ = save_usage(&usage_path(&paths, &id), &cached);
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) fn fetch_reset_credits<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ResetCreditsSummary, String> {
    let paths = resolve_paths(&app)?;
    let auth_path = managed_auth_path(&paths, &id);
    let mut auth = read_json(&auth_path)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &auth_path)?;

    let mut response = reset_credits_request(&client, &auth)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_tokens(&client, &mut auth)?;
        write_json_atomic(&auth_path, &auth)?;
        response = reset_credits_request(&client, &auth)?;
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
    sync_active_auth(&paths, &id, &auth)?;
    parse_reset_credits(&payload)
}

fn sync_active_auth(paths: &crate::storage::Paths, id: &str, auth: &Value) -> Result<(), String> {
    if read_state(paths).active_account_id.as_deref() == Some(id) {
        write_json_atomic(&paths.current_auth, auth)?;
    }
    Ok(())
}
