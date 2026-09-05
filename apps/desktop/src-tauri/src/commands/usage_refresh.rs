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
    let refresh_started_at = std::time::Instant::now();
    let paths = resolve_paths(app)?;
    let mut auth = load_auth_for_request(app, &paths, id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, id)?;

    let response = if is_agent_identity_auth(&auth.value) {
        if agent_identity::ensure_task(&client, &mut auth.value)? {
            auth.persist(&paths, id)?;
        }
        let response = agent_identity::usage_request(&client, &auth.value)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            let status = response.status();
            let body = response
                .text()
                .map_err(|error| format!("读取 Agent Identity 鉴权失败响应失败：{error}"))?;
            if !agent_identity::is_invalid_task_response(status, &body) {
                return Err(format!("Codex 用量接口返回 HTTP {status}"));
            }
            agent_identity::register_task(&client, &mut auth.value)?;
            auth.persist(&paths, id)?;
            agent_identity::usage_request(&client, &auth.value)?
        } else {
            response
        }
    } else {
        let mut response = usage_request(&client, &auth.value)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            auth.refresh(&client, &paths, id)?;
            response = usage_request(&client, &auth.value)?;
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
    usage.api_expires_at = subscription_active_until(&auth.value);
    save_usage(&usage_path(&paths, id), &usage)?;
    crate::local_proxy::concurrent_quota::record_usage_refresh(id, refresh_started_at, &usage)?;
    touch_account_field(&paths, id, AccountSyncField::Usage)?;
    auth.persist(&paths, id)?;
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
    auth: &mut RequestAuth,
    paths: &Paths,
    id: &str,
) -> Result<ResetCreditsSummary, String> {
    let mut response = reset_credits_request(client, &auth.value)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        auth.refresh(client, paths, id)?;
        response = reset_credits_request(client, &auth.value)?;
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
    auth.persist(paths, id)?;
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
    let mut response = consume_reset_credit_request(&client, &auth.value, &redeem_request_id)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        auth.refresh(&client, &paths, &id)?;
        response = consume_reset_credit_request(&client, &auth.value, &redeem_request_id)?;
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
            auth.persist(&paths, &id)?;
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
    for path in crate::codex_home::replicated_paths(&paths.current_auth) {
        write_json_if_changed(&path, auth)?;
    }
    Ok(true)
}
