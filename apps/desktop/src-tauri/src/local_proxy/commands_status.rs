pub(crate) fn is_running() -> bool {
    runtime()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

fn status<R: Runtime>(app: &tauri::AppHandle<R>) -> LocalProxyStatus {
    let (
        auto_switch_on_quota_exhaustion,
        concurrent_account_routing_enabled,
        custom_auto_switch_priority_enabled,
        custom_auto_switch_threshold_enabled,
        auto_disable_unreachable_accounts,
        listen_on_all_interfaces,
        has_lan_api_key,
        image_generation_account_id,
        image_input_target,
        image_output_target,
        openai_auth_account_id,
    ) = resolve_paths(app)
        .map(|paths| {
            let state = read_state(&paths);
            let image_output_target = effective_image_output_target(&state);
            (
                state.auto_switch_on_quota_exhaustion,
                state.concurrent_account_routing_enabled,
                state.custom_auto_switch_priority_enabled,
                state.custom_auto_switch_threshold_enabled,
                state.auto_disable_unreachable_accounts,
                lan_listening_enabled(&state),
                configured_lan_api_key(&state).is_some(),
                state.image_generation_account_id,
                state.image_input_target,
                image_output_target,
                state.local_proxy_openai_auth_account_id,
            )
        })
        .unwrap_or((
            false, false, false, false, false, false, false, None, None, None, None,
        ));
    LocalProxyStatus {
        running: is_running(),
        address: proxy_bind_host(listen_on_all_interfaces).to_string(),
        port: LOCAL_PROXY_PORT,
        base_url: LOCAL_PROXY_BASE_URL.to_string(),
        auto_switch_on_quota_exhaustion,
        concurrent_account_routing_enabled,
        custom_auto_switch_priority_enabled,
        custom_auto_switch_threshold_enabled,
        auto_disable_unreachable_accounts,
        listen_on_all_interfaces,
        has_lan_api_key,
        image_generation_account_id,
        image_input_target,
        image_output_target,
        openai_auth_account_id,
    }
}

fn effective_image_output_target(state: &ManagerStateFile) -> Option<ImageModelTarget> {
    state.image_output_target.clone().or_else(|| {
        state
            .image_generation_account_id
            .as_ref()
            .map(|account_id| ImageModelTarget::Official {
                account_id: account_id.clone(),
            })
    })
}

#[tauri::command]
pub(crate) async fn get_local_proxy_status<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(status(&app)))
        .await
        .map_err(|error| format!("Local proxy status task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_gpt_5_6_sol_context_window<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    context_window: u64,
) -> Result<AppSettings, String> {
    validate_gpt_5_6_sol_context_window(context_window)?;
    tauri::async_runtime::spawn_blocking(move || {
        set_gpt_5_6_sol_context_window_blocking(&app, context_window)
    })
    .await
    .map_err(|error| format!("Model context window task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_upstream_429_retry_timeout<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    timeout_seconds: u64,
) -> Result<AppSettings, String> {
    if !(MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS..=MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS)
        .contains(&timeout_seconds)
    {
        return Err(format!(
            "429 retry time must be between {MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS} and \
             {MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS} seconds"
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut settings = read_app_settings(&app)?;
        settings.upstream_429_retry_timeout_seconds = timeout_seconds;
        write_app_settings(&app, &settings)?;
        Ok(settings)
    })
    .await
    .map_err(|error| format!("429 retry settings task failed: {error}"))?
}

fn validate_gpt_5_6_sol_context_window(context_window: u64) -> Result<(), String> {
    if !(MIN_GPT_5_6_SOL_CONTEXT_WINDOW..=MAX_GPT_5_6_SOL_CONTEXT_WINDOW).contains(&context_window)
        || !context_window.is_multiple_of(MIN_GPT_5_6_SOL_CONTEXT_WINDOW)
    {
        return Err("Context window must be a whole K value between 1K and 1050K".to_string());
    }
    Ok(())
}

fn set_gpt_5_6_sol_context_window_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    context_window: u64,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(app)?;
    settings.gpt_5_6_sol_context_window = context_window;
    write_app_settings(app, &settings)?;
    let paths = resolve_paths(app)?;
    if let Err(error) = update_cached_model_context_window(&paths, context_window) {
        // The proxy applies the override on the next model request even if this best-effort cache refresh races Codex.
        eprintln!("failed to update the cached GPT-5.6 Sol context window: {error}");
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn list_proxy_sessions<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ProxySessionSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_proxy_sessions_blocking(&app))
        .await
        .map_err(|error| format!("Proxy session list task failed: {error}"))?
}

fn list_proxy_sessions_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<ProxySessionSummary>, String> {
    let sessions = proxy_sessions()
        .lock()
        .map_err(|_| "Proxy session registry lock is poisoned".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let paths = resolve_paths(app).ok();
    let official_context_windows = paths
        .as_ref()
        .map(official_model_context_windows)
        .unwrap_or_default();
    let upstream_official_provider_names = paths
        .as_ref()
        .map(upstream_official_provider_names)
        .unwrap_or_default();
    let provider_context_windows = paths
        .as_ref()
        .map(provider_context_windows)
        .unwrap_or_default();
    let session_ids = sessions
        .iter()
        .map(|session| session.id.clone())
        .collect::<HashSet<_>>();
    let conversation_titles = paths
        .as_ref()
        .and_then(|paths| {
            crate::commands::conversation_titles_by_id(&paths.codex_home, &session_ids).ok()
        })
        .unwrap_or_default();
    let default_provider_context_window = providers::DEFAULT_MODEL_CONTEXT_WINDOW
        .saturating_mul(DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT)
        / 100;
    let mut summaries = sessions
        .iter()
        .map(|session| {
            let model_context_window = match (session.provider.as_deref(), session.model.as_deref())
            {
                (Some(provider), Some(model))
                    if uses_official_model_context(provider, &upstream_official_provider_names) =>
                {
                    official_context_windows.get(model).copied()
                }
                (Some(provider), Some(model)) => Some(
                    provider_context_windows
                        .get(provider)
                        .map(|windows| windows.for_model(model))
                        .unwrap_or(default_provider_context_window),
                ),
                _ => None,
            };
            ProxySessionSummary {
                id: session.id.clone(),
                title: conversation_titles.get(&session.id).cloned(),
                client: session.client.clone(),
                remote_address: session.remote_address.clone(),
                connected_at: session.connected_at,
                last_seen_at: session.last_seen_at,
                active_requests: session.active_requests,
                request_count: session.request_count,
                provider: session.provider.clone(),
                concurrent_routed: session.concurrent_routed,
                account_id: session.account_id.clone(),
                account_email: session.account_email.clone(),
                model: session.model.clone(),
                context_tokens: session.context_tokens,
                model_context_window,
                total_tokens: session.token_totals.total_tokens,
                input_tokens: session.token_totals.input_tokens,
                output_tokens: session.token_totals.output_tokens,
                reasoning_tokens: session.token_totals.reasoning_tokens,
                cached_tokens: session.token_totals.cached_tokens,
            }
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| {
        right
            .active_requests
            .cmp(&left.active_requests)
            .then_with(|| right.last_seen_at.cmp(&left.last_seen_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(summaries)
}

#[tauri::command]
pub(crate) async fn list_proxy_session_requests(
    session_id: String,
) -> Result<Vec<ProxySessionRequestSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_proxy_session_requests_blocking(&session_id))
        .await
        .map_err(|error| format!("Proxy session request list task failed: {error}"))?
}

fn list_proxy_session_requests_blocking(
    session_id: &str,
) -> Result<Vec<ProxySessionRequestSummary>, String> {
    let sessions = proxy_sessions()
        .lock()
        .map_err(|_| "Proxy session registry lock is poisoned".to_string())?;
    let Some(session) = sessions.get(session_id) else {
        return Ok(Vec::new());
    };
    Ok(session
        .requests
        .iter()
        .rev()
        .map(|request| ProxySessionRequestSummary {
            id: request.id,
            started_at: request.started_at,
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            first_response_time_ms: request.first_response_time_ms,
            response_time_ms: request.response_time_ms,
            total_tokens: request.usage.as_ref().and_then(token_usage_total),
            input_tokens: request.usage.as_ref().and_then(|usage| usage.input_tokens),
            output_tokens: request.usage.as_ref().and_then(|usage| usage.output_tokens),
            reasoning_tokens: request
                .usage
                .as_ref()
                .and_then(|usage| usage.reasoning_tokens),
            cached_tokens: request.usage.as_ref().and_then(|usage| usage.cached_tokens),
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn get_recent_proxy_session_latency() -> Result<ProxySessionLatencySummary, String>
{
    tauri::async_runtime::spawn_blocking(get_recent_proxy_session_latency_blocking)
        .await
        .map_err(|error| format!("Proxy session latency task failed: {error}"))?
}

fn get_recent_proxy_session_latency_blocking() -> Result<ProxySessionLatencySummary, String> {
    let mut sessions = proxy_sessions()
        .lock()
        .map_err(|_| "Proxy session registry lock is poisoned".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        right
            .last_seen_at
            .cmp(&left.last_seen_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let (total_first_response_time_ms, request_count) = sessions
        .into_iter()
        .take(5)
        .flat_map(|session| session.requests.into_iter())
        .filter_map(|request| request.first_response_time_ms)
        .fold((0_u64, 0_u64), |(total, count), first_response_time_ms| {
            (
                total.saturating_add(first_response_time_ms),
                count.saturating_add(1),
            )
        });

    Ok(ProxySessionLatencySummary {
        total_first_response_time_ms,
        request_count,
    })
}

#[tauri::command]
pub(crate) fn export_diagnostic_logs<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let destination = PathBuf::from(path);
    let parent = destination
        .parent()
        .ok_or_else(|| "Diagnostic log export path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    let source = diagnostic_log_path(&app)?;
    if source.exists() {
        fs::copy(&source, &destination).map_err(|error| {
            format!(
                "Failed to export diagnostics from {} to {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
    } else {
        let empty_log = json!({
            "ts": unix_now(),
            "event": "no_diagnostic_logs",
            "message": "No local proxy diagnostic logs have been recorded yet."
        })
        .to_string();
        fs::write(&destination, format!("{empty_log}\n")).map_err(|error| {
            format!(
                "Failed to write diagnostic export {}: {error}",
                destination.display()
            )
        })?;
    }

    Ok(destination.display().to_string())
}

#[tauri::command]
pub(crate) async fn list_token_usage_entries<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<TokenUsageEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_token_usage_entries_blocking(&app))
        .await
        .map_err(|error| format!("Token usage list task failed: {error}"))?
}

fn list_token_usage_entries_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<TokenUsageEntry>, String> {
    let connection = open_token_usage_db(app)?;
    let mut entries = list_token_usage_entries_from_db(&connection, TOKEN_USAGE_LIST_LIMIT)?;
    let paths = resolve_paths(app).ok();
    let official_context_windows = paths
        .as_ref()
        .map(official_model_context_windows)
        .unwrap_or_default();
    let upstream_official_provider_names = paths
        .as_ref()
        .map(upstream_official_provider_names)
        .unwrap_or_default();
    let provider_context_windows = paths
        .as_ref()
        .map(provider_context_windows)
        .unwrap_or_default();
    for entry in &mut entries {
        entry.model_context_window =
            if uses_official_model_context(&entry.provider, &upstream_official_provider_names) {
                official_context_windows.get(&entry.model).copied()
            } else {
                Some(
                    provider_context_windows
                        .get(&entry.provider)
                        .map(|windows| windows.for_model(&entry.model))
                        .unwrap_or(
                            providers::DEFAULT_MODEL_CONTEXT_WINDOW
                                .saturating_mul(DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT)
                                / 100,
                        ),
                )
            };
    }
    Ok(entries)
}

#[tauri::command]
pub(crate) async fn list_daily_token_usage<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<DailyTokenUsage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_token_usage_db(&app)?;
        list_daily_token_usage_from_db(&connection, start_ts)
    })
    .await
    .map_err(|error| format!("Daily token usage task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_account_token_usage<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<AccountTokenUsageTotals>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_token_usage_db(&app)?;
        list_account_token_usage_from_db(&connection, start_ts)
    })
    .await
    .map_err(|error| format!("Account token usage task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_provider_token_usage<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<ProviderTokenUsageTotals>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_token_usage_db(&app)?;
        list_provider_token_usage_from_db(&connection, start_ts)
    })
    .await
    .map_err(|error| format!("Provider token usage task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn show_token_usage_window<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TOKEN_USAGE_WINDOW_LABEL) {
        let _ = window.destroy();
    }

    WebviewWindowBuilder::new(&app, TOKEN_USAGE_WINDOW_LABEL, token_usage_window_url())
        .title("Token Usage")
        .inner_size(1180.0, 780.0)
        .min_inner_size(900.0, 620.0)
        .resizable(true)
        .maximizable(true)
        .closable(true)
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn token_usage_window_url() -> WebviewUrl {
    WebviewUrl::App("index.html#token-usage".into())
}
