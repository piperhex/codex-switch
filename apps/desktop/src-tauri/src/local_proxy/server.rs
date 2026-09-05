fn set_local_proxy_enabled(paths: &Paths, enabled: bool) -> Result<(), String> {
    let mut state = read_state(paths);
    state.local_proxy_enabled = enabled;
    write_state(paths, &state)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProxyServiceTier {
    Default,
    Priority,
}

impl ProxyServiceTier {
    fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Priority => "priority",
        }
    }
}

static PROXY_SERVICE_TIER: OnceLock<RwLock<Option<ProxyServiceTier>>> = OnceLock::new();

fn proxy_service_tier() -> ProxyServiceTier {
    PROXY_SERVICE_TIER
        .get_or_init(|| RwLock::new(None))
        .read()
        .ok()
        .and_then(|tier| *tier)
        .unwrap_or(ProxyServiceTier::Default)
}

pub(crate) fn proxy_service_tier_name() -> &'static str {
    proxy_service_tier().as_str()
}

fn proxy_service_tier_override() -> Option<ProxyServiceTier> {
    PROXY_SERVICE_TIER
        .get_or_init(|| RwLock::new(None))
        .read()
        .ok()
        .and_then(|tier| *tier)
}

fn set_proxy_service_tier(tier: Option<ProxyServiceTier>) {
    if let Ok(mut current) = PROXY_SERVICE_TIER
        .get_or_init(|| RwLock::new(None))
        .write()
    {
        *current = tier;
    }
}

#[cfg(test)]
fn parse_proxy_service_tier(value: &Value) -> Result<ProxyServiceTier, &'static str> {
    parse_proxy_service_tier_name(value.get("service_tier").and_then(Value::as_str))
}

fn parse_proxy_service_tier_name(value: Option<&str>) -> Result<ProxyServiceTier, &'static str> {
    match value {
        Some("default") => Ok(ProxyServiceTier::Default),
        Some("priority") => Ok(ProxyServiceTier::Priority),
        _ => Err("service_tier must be either default or priority"),
    }
}

fn effective_proxy_service_tier(
    body: &[u8],
    override_tier: Option<ProxyServiceTier>,
) -> Option<ProxyServiceTier> {
    if override_tier.is_some() {
        return override_tier;
    }
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return None;
    };
    match value.get("service_tier").and_then(Value::as_str) {
        None => Some(ProxyServiceTier::Default),
        value => parse_proxy_service_tier_name(value).ok(),
    }
}

pub(crate) fn set_proxy_service_tier_by_name(value: &str) -> bool {
    let Ok(tier) = parse_proxy_service_tier_name(Some(value)) else {
        return false;
    };
    set_proxy_service_tier(Some(tier));
    true
}

fn update_proxy_service_tier_for_openai_auth(account_id: Option<&str>) -> bool {
    if account_id.is_none()
        || proxy_service_tier_override() == Some(ProxyServiceTier::Default)
    {
        return false;
    }
    set_proxy_service_tier(Some(ProxyServiceTier::Default));
    true
}

fn start_server<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| "Local proxy runtime lock is poisoned".to_string())?;
    if guard.is_some() {
        return Ok(false);
    }
    set_proxy_service_tier(None);

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

    let captures_conversation = is_responses_endpoint(request_path(&url))
        || is_image_generation_endpoint(request_path(&url));
    let session = (method == Method::Post && captures_conversation).then(|| {
        let service_tier = effective_proxy_service_tier(&body, proxy_service_tier_override());
        begin_proxy_session_request(&headers, remote_address, &body, service_tier)
    });
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
            let message = upstream_error_message(&error);
            json_payload(502, json!({ "error": { "message": message } }))
        }
    };
    respond_payload(
        request,
        attach_first_response_capture(
            attach_conversation_response_capture(payload, session.as_ref()),
            session.as_ref(),
        ),
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
    let mut image_account_pool = image_account_pool_for_request(app, path, &body, &target)?;
    let image_account_failover_enabled = image_account_pool.is_some();
    let route = proxy_diagnostic_route(path, &target);
    let diagnostic = proxy_diagnostic_entry(method, url, headers, &body, Some(&target), route);
    let usage_context = token_usage_context(TokenUsageRequest {
        method,
        path,
        body: &body,
        headers,
        target: &target,
        started_at,
        session_id,
        session_request_id,
    });
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
        || {
            let account_id_override = image_account_pool
                .as_ref()
                .map(|pool| pool.current_account_id().to_string());
            let result = forward_active_request(ActiveForwardRequest {
                app,
                method,
                url,
                headers,
                body: body.clone(),
                target: &target,
                session_id,
                account_id_override: account_id_override.as_deref(),
            });
            if let Ok(response) = result.as_ref() {
                advance_image_account_after_429(&mut image_account_pool, response);
            }
            result
        },
        |response, event| {
            if image_account_failover_enabled {
                return false;
            }
            handle_upstream_quota_event(app, response, event)
        },
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
