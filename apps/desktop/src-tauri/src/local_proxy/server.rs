fn set_local_proxy_enabled(paths: &Paths, enabled: bool) -> Result<(), String> {
    let mut state = read_state(paths);
    state.local_proxy_enabled = enabled;
    write_state(paths, &state)
}

fn start_server<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| "Local proxy runtime lock is poisoned".to_string())?;
    if guard.is_some() {
        return Ok(false);
    }

    let state = read_state(&resolve_paths(&app)?);
    set_system_prompt_filter_runtime_config(
        state.system_prompt_filter_enabled,
        state.system_prompt_filter_rules.clone(),
    );
    set_system_prompt_injection_runtime_config(
        state.system_prompt_injection_enabled,
        state.system_prompt_injection_prompts.clone(),
    );
    let bind_addr = format!(
        "{}:{LOCAL_PROXY_PORT}",
        proxy_bind_host(lan_listening_enabled(&state))
    );
    let server = Arc::new(bind_http_server(&bind_addr)?);
    let server_for_thread = server.clone();
    let handle = thread::Builder::new()
        .name("codex-switch-local-proxy".to_string())
        .spawn(move || {
            for request in server_for_thread.incoming_requests() {
                let request_app = app.clone();
                let _ = thread::Builder::new()
                    .name("codex-switch-local-proxy-request".to_string())
                    .spawn(move || handle_request(request_app, request));
            }
        })
        .map_err(|error| format!("Failed to spawn local proxy thread: {error}"))?;
    *guard = Some(ProxyRuntime {
        server,
        handle: Some(handle),
    });
    Ok(true)
}

fn proxy_bind_host(listen_on_all_interfaces: bool) -> &'static str {
    if listen_on_all_interfaces {
        LOCAL_PROXY_LAN_HOST
    } else {
        LOCAL_PROXY_HOST
    }
}

fn configured_lan_api_key(state: &ManagerStateFile) -> Option<&str> {
    state
        .local_proxy_lan_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn lan_listening_enabled(state: &ManagerStateFile) -> bool {
    state.local_proxy_listen_on_all_interfaces && configured_lan_api_key(state).is_some()
}

fn bind_http_server(bind_addr: &str) -> Result<Server, String> {
    let deadline = Instant::now() + LOCAL_PROXY_REBIND_RETRY_TIMEOUT;
    loop {
        match Server::http(bind_addr) {
            Ok(server) => return Ok(server),
            Err(error) => {
                let address_in_use = is_address_in_use(error.as_ref());
                if !address_in_use || Instant::now() >= deadline {
                    return Err(format!(
                        "Failed to start local proxy at {bind_addr}: {error}"
                    ));
                }
                thread::sleep(LOCAL_PROXY_REBIND_RETRY_INTERVAL);
            }
        }
    }
}

fn is_address_in_use(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(error) = current {
        if error
            .downcast_ref::<io::Error>()
            .is_some_and(|error| error.kind() == io::ErrorKind::AddrInUse)
        {
            return true;
        }
        current = error.source();
    }
    false
}

fn listener_wake_address(server: &Server) -> Option<SocketAddr> {
    server.server_addr().to_ip().map(|address| {
        let ip = match address.ip() {
            IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
            ip => ip,
        };
        SocketAddr::new(ip, address.port())
    })
}

fn stop_proxy_runtime(mut proxy_runtime: ProxyRuntime) {
    proxy_runtime.server.unblock();
    if let Some(handle) = proxy_runtime.handle.take() {
        let _ = handle.join();
    }

    // tiny_http owns the listening socket in an internal accept thread. Its
    // Server::drop wake-up connects to the bound address, which does not
    // reliably wake a 0.0.0.0 listener on Windows. Arrange an explicit
    // loopback connection after drop sets the close flag, then wait for it.
    let wake = listener_wake_address(&proxy_runtime.server).and_then(|address| {
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::Builder::new()
            .name("codex-switch-local-proxy-shutdown".to_string())
            .spawn(move || {
                if receiver.recv().is_ok() {
                    if let Ok(stream) =
                        TcpStream::connect_timeout(&address, Duration::from_millis(100))
                    {
                        let _ = stream.shutdown(Shutdown::Both);
                    }
                }
            })
            .ok()
            .map(|handle| (sender, handle))
    });
    drop(proxy_runtime.server);
    if let Some((sender, handle)) = wake {
        let _ = sender.send(());
        let _ = handle.join();
    }
}

fn stop_server() {
    let runtime = runtime().lock().ok().and_then(|mut guard| guard.take());
    if let Some(proxy_runtime) = runtime {
        stop_proxy_runtime(proxy_runtime);
    }
    clear_proxy_sessions();
    aggregate_scheduler::clear();
}

fn handle_request<R: Runtime>(app: tauri::AppHandle<R>, mut request: Request) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let remote_address = request.remote_addr().map(|address| address.to_string());
    let headers = request
        .headers()
        .iter()
        .map(|header| {
            (
                header.field.as_str().as_str().to_string(),
                header.value.as_str().to_string(),
            )
        })
        .collect::<Vec<_>>();

    let is_loopback = request
        .remote_addr()
        .map(|address| address.ip().is_loopback())
        .unwrap_or(false);
    if !is_loopback {
        let configured_key = resolve_paths(&app)
            .ok()
            .map(|paths| read_state(&paths))
            .and_then(|state| configured_lan_api_key(&state).map(str::to_string));
        if !configured_key
            .as_deref()
            .is_some_and(|expected| request_has_valid_api_key(&headers, expected))
        {
            respond_error(request, 401, "A valid API key is required".to_string());
            return;
        }
    }

    let mut body = Vec::new();
    if let Err(error) = request.as_reader().read_to_end(&mut body) {
        respond_error(
            request,
            400,
            format!("Failed to read request body: {error}"),
        );
        return;
    }

    let session = (method == Method::Post && is_responses_endpoint(request_path(&url)))
        .then(|| begin_proxy_session_request(&headers, remote_address, &body));
    let result = handle_proxy_request(
        &app,
        &method,
        &url,
        &headers,
        body,
        session.as_ref().map(ProxySessionRequestGuard::session_id),
        session.as_ref().map(ProxySessionRequestGuard::request_id),
    );
    let payload = match result {
        Ok(payload) => payload,
        Err(error) => {
            let is_transport_error = is_upstream_transport_error(&error);
            if is_transport_error {
                let _ = app.emit(LOCAL_PROXY_UPSTREAM_CONNECTION_FAILED_EVENT, ());
            }
            let message = upstream_error_message(&error);
            json_payload(502, json!({ "error": { "message": message } }))
        }
    };
    respond_payload(
        request,
        attach_first_response_capture(payload, session.as_ref()),
    );
}

fn is_upstream_transport_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("official codex proxy request failed: error sending request")
        || normalized.contains("provider proxy request failed: error sending request")
}

fn upstream_error_message(error: &str) -> &str {
    if is_upstream_transport_error(error) {
        UPSTREAM_CONNECTION_FAILURE_MESSAGE
    } else {
        error
    }
}

fn request_has_valid_api_key(headers: &[(String, String)], expected: &str) -> bool {
    let header_key_matches = ["x-api-key", "openai-api-key", "api-key"]
        .into_iter()
        .filter_map(|name| header_value(headers, name).map(str::trim))
        .any(|actual| !actual.is_empty() && api_keys_equal(expected, actual));
    let bearer_key_matches = header_value(headers, "authorization")
        .map(str::trim)
        .and_then(|value| {
            value
                .get(..7)
                .filter(|prefix| prefix.eq_ignore_ascii_case("bearer "))
                .map(|_| value[7..].trim())
        })
        .filter(|value| !value.is_empty())
        .is_some_and(|actual| api_keys_equal(expected, actual));
    header_key_matches || bearer_key_matches
}

fn api_keys_equal(expected: &str, actual: &str) -> bool {
    let expected = expected.as_bytes();
    let actual = actual.as_bytes();
    expected.len() == actual.len()
        && expected
            .iter()
            .zip(actual)
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
}

fn handle_proxy_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    session_id: Option<&str>,
    session_request_id: Option<u64>,
) -> Result<UpstreamPayload, String> {
    let path = request_path(url);
    let started_at = Instant::now();
    if *method == Method::Get && path == "/health" {
        let diagnostic = proxy_diagnostic_entry(
            method,
            url,
            headers,
            &body,
            None,
            ProxyDiagnosticRoute::LocalHealth,
        );
        let result = Ok(json_payload(200, json!({ "status": "ok" })));
        append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
        return result;
    }
    if matches!(*method, Method::Get | Method::Head) && path == "/claude-desktop/api/hello" {
        let result = Ok(json_payload(200, json!({ "status": "ok" })));
        append_proxy_diagnostic_result(
            app,
            proxy_diagnostic_entry(
                method,
                url,
                headers,
                &body,
                None,
                ProxyDiagnosticRoute::LocalHealth,
            ),
            &result,
            started_at.elapsed(),
        );
        return result;
    }
    if *method == Method::Post && is_anthropic_count_tokens_endpoint(path) {
        let result = Ok(json_payload(
            200,
            json!({ "input_tokens": body.len().saturating_div(4) }),
        ));
        append_proxy_diagnostic_result(
            app,
            proxy_diagnostic_entry(
                method,
                url,
                headers,
                &body,
                None,
                ProxyDiagnosticRoute::LocalHealth,
            ),
            &result,
            started_at.elapsed(),
        );
        return result;
    }
    if *method == Method::Post
        && is_anthropic_messages_endpoint(path)
        && is_anthropic_token_probe(&body)
    {
        let result = Ok(anthropic_token_probe_payload(&body));
        append_proxy_diagnostic_result(
            app,
            proxy_diagnostic_entry(
                method,
                url,
                headers,
                &body,
                None,
                ProxyDiagnosticRoute::LocalHealth,
            ),
            &result,
            started_at.elapsed(),
        );
        return result;
    }
    if *method == Method::Get && matches!(path, "/usage" | "/v1/usage") {
        return current_usage_payload(app);
    }
    if *method == Method::Get && matches!(path, "/models" | "/v1/models") {
        let target = match active_target(app) {
            Ok(target) => target,
            Err(error) => {
                let diagnostic = proxy_diagnostic_entry(
                    method,
                    url,
                    headers,
                    &body,
                    None,
                    ProxyDiagnosticRoute::LocalModels,
                );
                let result = Err(error);
                append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
                return result;
            }
        };
        let diagnostic = proxy_diagnostic_entry(
            method,
            url,
            headers,
            &body,
            Some(&target),
            ProxyDiagnosticRoute::LocalModels,
        );
        let retry_timeout = upstream_429_retry_timeout(app)?;
        let result = retry_upstream_request(
            retry_timeout,
            || models_payload(app, url, headers, &target),
            |response, event| handle_upstream_quota_event(app, response, event),
        );
        append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
        return result;
    }

    let target = match active_target_for_request(app, path, &body) {
        Ok(target) => target,
        Err(error) => {
            let diagnostic = proxy_diagnostic_entry(
                method,
                url,
                headers,
                &body,
                None,
                ProxyDiagnosticRoute::TargetResolutionError,
            );
            let result = Err(error);
            append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
            return result;
        }
    };
    let body = apply_image_output_model(app, path, headers, body, &target);
    let body = if is_anthropic_messages_endpoint(path) {
        body
    } else {
        inject_system_prompts(filter_system_prompts(body))
    };
    let route = proxy_diagnostic_route(path, &target);
    let diagnostic = proxy_diagnostic_entry(method, url, headers, &body, Some(&target), route);
    let usage_context = token_usage_context(
        method,
        path,
        &body,
        &target,
        started_at,
        session_id,
        session_request_id,
    );
    if let Some(context) = usage_context.as_ref() {
        update_proxy_session_target(
            context.session_id.as_deref(),
            session_request_id,
            &context.provider,
            &context.model,
        );
    }
    let provider_models_etag = active_provider_group_models_etag(app).or_else(|| match &target {
        ActiveTarget::Provider(provider) if !providers::uses_upstream_official_models(provider) => {
            Some(provider_models_etag_with_image_route(
                provider,
                image_input_route_enabled(app),
            ))
        }
        ActiveTarget::ProviderGroup(group_providers) => {
            Some(provider_group_models_etag_with_image_route(
                group_providers,
                image_input_route_enabled(app),
            ))
        }
        ActiveTarget::Aggregate(target) => Some(aggregate_models_etag(
            &target.config,
            image_input_route_enabled(app),
        )),
        _ => None,
    });
    let retry_timeout = upstream_429_retry_timeout(app)?;
    let result = retry_upstream_request(
        retry_timeout,
        || forward_active_request(app, method, url, headers, body.clone(), &target, session_id),
        |response, event| handle_upstream_quota_event(app, response, event),
    );
    let result = result.map(|mut payload| {
        if let Some(etag) = provider_models_etag {
            payload
                .response_headers
                .retain(|(name, _)| !name.eq_ignore_ascii_case("x-models-etag"));
            payload
                .response_headers
                .push(("x-models-etag".to_string(), etag));
        }
        payload
    });
    let result = attach_token_usage_capture(app, usage_context, result);
    append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
    result
}

fn forward_active_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    target: &ActiveTarget,
    session_id: Option<&str>,
) -> Result<UpstreamPayload, String> {
    match target {
        ActiveTarget::Official { model } => {
            if is_anthropic_messages_endpoint(request_path(url)) {
                return forward_anthropic_official(app, headers, body, session_id);
            }
            forward_official(app, method, url, headers, body, model, session_id)
        }
        ActiveTarget::Provider(provider) => {
            if is_anthropic_messages_endpoint(request_path(url)) {
                let settings = read_app_settings(app)?;
                let subagent_model =
                    crate::third_party_apps::effective_settings(&settings).claude_subagent_model;
                return forward_anthropic_provider(body, provider, &subagent_model);
            }
            forward_provider_request(method, url, headers, body, provider)
        }
        ActiveTarget::Aggregate(target) => forward_aggregate_request(AggregateForwardRequest {
            method,
            url,
            headers,
            body,
            session_id,
            target,
        }),
        ActiveTarget::ProviderGroup(_) => {
            Err("Provider group requests must select a model".to_string())
        }
    }
}

fn current_usage_payload<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<UpstreamPayload, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    let usage = if let Some(provider_id) = state.active_provider_id {
        let provider_id =
            if aggregate_api::is_active_id(&provider_id) {
                let config = aggregate_api::read_active_config(&paths, &provider_id)?;
                config.member_provider_ids.first().cloned().ok_or_else(|| {
                    "Aggregate API does not contain any available APIs".to_string()
                })?
            } else {
                provider_id
            };
        providers::query_provider_usage_blocking(app.clone(), provider_id)?
    } else if let Some(group) = state.active_provider_group.as_deref() {
        let provider = providers::provider_group_profiles(&paths, group)?
            .into_iter()
            .next()
            .ok_or_else(|| "Provider group does not contain any available APIs".to_string())?;
        providers::query_provider_usage_blocking(app.clone(), provider.id)?
    } else {
        let account_id = state
            .active_account_id
            .ok_or_else(|| "No active account is available for usage sync".to_string())?;
        crate::commands::refresh_usage_blocking(app.clone(), account_id)?
    };
    let payload = serde_json::to_value(usage)
        .map_err(|error| format!("Failed to serialize current usage: {error}"))?;
    Ok(json_payload(200, payload))
}

fn upstream_429_retry_timeout<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Duration, String> {
    let seconds = read_app_settings(app)?
        .upstream_429_retry_timeout_seconds
        .clamp(
            MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
            MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
        );
    Ok(Duration::from_secs(seconds))
}

fn retry_upstream_request<F, S>(
    timeout: Duration,
    request: F,
    handle_quota_event: S,
) -> Result<UpstreamPayload, String>
where
    F: FnMut() -> Result<UpstreamPayload, String>,
    S: FnMut(&UpstreamPayload, UpstreamQuotaEvent) -> bool,
{
    let started_at = Instant::now();
    retry_upstream_request_with(timeout, request, handle_quota_event, |delay| {
        thread::sleep(delay.min(timeout.saturating_sub(started_at.elapsed())));
        started_at.elapsed()
    })
}

fn retry_upstream_request_with<F, S, W>(
    timeout: Duration,
    mut request: F,
    mut handle_quota_event: S,
    mut wait_before_retry: W,
) -> Result<UpstreamPayload, String>
where
    F: FnMut() -> Result<UpstreamPayload, String>,
    S: FnMut(&UpstreamPayload, UpstreamQuotaEvent) -> bool,
    W: FnMut(Duration) -> Duration,
{
    let mut retry_number = 0_u16;
    loop {
        let response = request()?;
        if response.status == 429 {
            retry_number = retry_number.saturating_add(1);
            let elapsed = wait_before_retry(upstream_429_retry_delay(retry_number));
            if elapsed >= timeout {
                let _ = handle_quota_event(&response, UpstreamQuotaEvent::RetryTimedOut);
                return Ok(response);
            }
            if is_official_quota_exhaustion(&response) {
                let _ = handle_quota_event(&response, UpstreamQuotaEvent::Retry);
            }
            continue;
        }
        return Ok(response);
    }
}
