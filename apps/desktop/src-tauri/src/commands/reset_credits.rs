#[tauri::command]
pub(crate) async fn fetch_reset_credits<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<ResetCreditsSummary, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_reset_credits_blocking(app, id))
        .await
        .map_err(|error| format!("刷新重置卡任务失败：{error}"))?
}

pub(crate) fn fetch_reset_credits_blocking<R: Runtime>(
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
    let _guard = reset_credit_lock()?;
    redeem_reset_credit(&app, &id, None, || Ok(true)).map(|_| ())
}

fn redeem_reset_credit<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    reserve: Option<u16>,
    still_authorized: impl FnOnce() -> Result<bool, String>,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    let mut auth = load_auth_for_request(app, &paths, id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, id)?;

    let credits = fetch_reset_credits_with_retry(&client, &mut auth, &paths, id)?;
    if credits.credits.is_empty() {
        return Err("当前账号没有可用重置卡".to_string());
    }

    if reserve.is_some_and(|reserve| {
        crate::local_proxy::auto_reset::available_credit_count(&credits) <= usize::from(reserve)
    }) {
        return Ok(false);
    }
    if !still_authorized()? {
        return Ok(false);
    }
    redeem_reset_credit_with_auth(&client, &mut auth, &paths, id)?;
    Ok(true)
}

fn redeem_reset_credit_with_auth(
    client: &Client,
    auth: &mut RequestAuth,
    paths: &Paths,
    id: &str,
) -> Result<(), String> {
    let redeem_request_id = format!(
        "codex-switch-{}-{}",
        Utc::now().timestamp_millis(),
        rand::random::<u64>()
    );
    let mut response = consume_reset_credit_request(client, &auth.value, &redeem_request_id)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        auth.refresh(client, paths, id)?;
        response = consume_reset_credit_request(client, &auth.value, &redeem_request_id)?;
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
            auth.persist(paths, id)?;
            Ok(())
        }
        Some("no_credit") => Err("当前账号没有可用重置卡".to_string()),
        Some("nothing_to_reset") => Err("当前账号当前没有需要重置的用量窗口".to_string()),
        Some(code) => Err(format!("Codex 重置卡使用接口返回未知状态：{code}")),
        None => Err("Codex 重置卡使用接口响应缺少 code".to_string()),
    }
}

static RESET_CREDIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn reset_credit_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    RESET_CREDIT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "重置卡正在使用，请稍后重试".to_string())
}

/// Serialize manual and automatic redemption, then recheck quota and card reserves.
pub(crate) fn consume_exhausted_account_credit<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    reserve: u16,
    still_authorized: impl FnOnce() -> Result<bool, String>,
) -> Result<bool, String> {
    let _guard = reset_credit_lock()?;
    let usage = try_refresh_usage_blocking(app, id)?;
    if !crate::local_proxy::auto_reset::quota_is_exhausted(&usage) {
        return Ok(false);
    }
    redeem_reset_credit(app, id, Some(reserve), still_authorized)
}
