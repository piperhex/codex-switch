fn reported_quota_windows_have_remaining(usage: &UsageSummary) -> bool {
    usage
        .primary
        .as_ref()
        .is_none_or(|window| window.remaining_percent > 0.0)
        && usage
            .secondary
            .as_ref()
            .is_none_or(|window| window.remaining_percent > 0.0)
}

fn primary_remaining_quota_score(usage: &UsageSummary) -> Option<f64> {
    if usage.error.is_some() || !reported_quota_windows_have_remaining(usage) {
        return None;
    }
    let primary = usage.primary.as_ref()?;
    Some(primary.remaining_percent)
}

fn active_target<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<ActiveTarget, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    if let Some(group) = state.active_provider_group.as_deref() {
        return Ok(ActiveTarget::ProviderGroup(
            providers::provider_group_profiles(&paths, group)?,
        ));
    }
    active_target_for_request(app, "", &[])
}

fn active_target_for_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
    body: &[u8],
) -> Result<ActiveTarget, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    if let Some(target) = image_model_target_for_request(&state, path, body) {
        return active_target_from_image_model(&paths, &target);
    }
    if let Some(group) = state.active_provider_group.as_deref() {
        let group_providers = providers::provider_group_profiles(&paths, group)?;
        let requested = serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|value| requested_model(&value).map(str::to_string));
        let provider = providers::provider_for_group_model(&group_providers, requested.as_deref())?;
        providers::ensure_not_local_proxy_base_url(&provider.base_url)?;
        return Ok(ActiveTarget::Provider(Box::new(provider)));
    }
    if let Some(id) = state.active_provider_id {
        if aggregate_api::is_active_id(&id) {
            let config = aggregate_api::read_active_config(&paths, &id)?;
            if !config.enabled {
                return Err("Aggregate API is disabled".to_string());
            }
            let profiles = aggregate_api::member_profiles(&paths, &config)?;
            return Ok(ActiveTarget::Aggregate(AggregateTarget {
                config,
                profiles,
            }));
        }
        let provider = providers::read_provider(&paths, &id)?;
        providers::ensure_not_local_proxy_base_url(&provider.base_url)?;
        return Ok(ActiveTarget::Provider(Box::new(provider)));
    }
    if !state.concurrent_account_routing_enabled {
        if maybe_switch_official_account_below_threshold(app)? {
            return active_target_for_request(app, path, body);
        }
        ensure_active_official_account_meets_threshold(app)?;
    }
    Ok(ActiveTarget::Official {
        model: providers::official_model(),
    })
}

fn image_model_target_for_request(
    state: &ManagerStateFile,
    path: &str,
    body: &[u8],
) -> Option<ImageModelTarget> {
    if is_image_generation_endpoint(path) {
        return effective_image_output_target(state);
    }
    if !is_responses_endpoint(path) || !request_contains_input_image(body) {
        return None;
    }
    state.image_input_target.clone()
}

fn request_contains_input_image(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| value.get("input").cloned())
        .is_some_and(|input| contains_input_image(&input))
}

fn apply_image_output_model<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    target: &ActiveTarget,
) -> Vec<u8> {
    if !is_image_generation_endpoint(path) || !matches!(target, ActiveTarget::Provider(_)) {
        return body;
    }
    let Some(ImageModelTarget::Provider { model, .. }) = resolve_paths(app)
        .ok()
        .and_then(|paths| effective_image_output_target(&read_state(&paths)))
    else {
        return body;
    };
    body_with_selected_image_model(body, &model, header_value(headers, "content-type"))
}

fn active_target_from_image_model(
    paths: &Paths,
    target: &ImageModelTarget,
) -> Result<ActiveTarget, String> {
    match target {
        ImageModelTarget::Official { .. } => Ok(ActiveTarget::Official {
            model: providers::official_model(),
        }),
        ImageModelTarget::Provider { provider_id, model } => {
            let mut provider = providers::read_provider(paths, provider_id)?;
            provider.model = model.clone();
            provider.model_selection_controlled_by_codex = false;
            providers::ensure_not_local_proxy_base_url(&provider.base_url)?;
            Ok(ActiveTarget::Provider(Box::new(provider)))
        }
    }
}

fn proxy_diagnostic_route(path: &str, target: &ActiveTarget) -> ProxyDiagnosticRoute {
    match target {
        ActiveTarget::Official { .. } => ProxyDiagnosticRoute::Official,
        ActiveTarget::Provider(provider)
            if provider.kind == ProviderKind::Custom && is_response_create_endpoint(path) =>
        {
            ProxyDiagnosticRoute::ProviderAuto
        }
        ActiveTarget::Provider(provider)
            if is_responses_endpoint(path)
                && provider.api_format == ProviderApiFormat::OpenaiChat =>
        {
            ProxyDiagnosticRoute::ProviderChatBridge
        }
        ActiveTarget::Provider(_) if is_responses_endpoint(path) => {
            ProxyDiagnosticRoute::ProviderResponsesPassthrough
        }
        ActiveTarget::Provider(_) => ProxyDiagnosticRoute::ProviderPassthrough,
        ActiveTarget::ProviderGroup(_) => ProxyDiagnosticRoute::LocalModels,
        ActiveTarget::Aggregate(_) => ProxyDiagnosticRoute::ProviderAuto,
    }
}

fn proxy_diagnostic_entry(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: &[u8],
    target: Option<&ActiveTarget>,
    route: ProxyDiagnosticRoute,
) -> Value {
    let path = request_path(url);
    let request_body = serde_json::from_slice::<Value>(body).ok();
    let upstream_endpoint = upstream_endpoint_for_codex_request(url);

    let mut entry = json!({
        "ts": unix_now(),
        "event": "local_proxy_request",
        "method": method.as_str(),
        "path": path,
        "query": request_query_diagnostic(url),
        "upstreamEndpoint": request_path(&upstream_endpoint),
        "isResponsesEndpoint": is_responses_endpoint(path),
        "route": route.as_str(),
        "requestBodyBytes": body.len(),
        "requestBodyHash": short_hash_bytes(body),
        "requestBody": request_body_diagnostic(body, request_body.as_ref()),
        "requestHeaders": diagnostic_header_summary(headers),
        "target": diagnostic_target(target, route),
    });

    if is_responses_endpoint(path) {
        entry["responses"] = request_body
            .as_ref()
            .map(responses_body_diagnostic)
            .unwrap_or_else(|| json!({ "json": false }));
    }

    entry
}

fn append_proxy_diagnostic_result<R: Runtime>(
    app: &tauri::AppHandle<R>,
    mut entry: Value,
    result: &Result<UpstreamPayload, String>,
    duration: Duration,
) {
    entry["durationMs"] = json!(duration.as_millis() as u64);
    match result {
        Ok(payload) => {
            let mut result = json!({
                "ok": status_ok(payload.status),
                "status": payload.status,
                "contentType": payload.content_type,
                "bodyKind": match &payload.body {
                    UpstreamBody::Buffered(_) => "buffered",
                    UpstreamBody::Streaming(_) => "streaming",
                }
            });
            if !status_ok(payload.status) {
                result["responseBody"] = match &payload.body {
                    UpstreamBody::Buffered(body) => {
                        diagnostic_response_body(body, payload.content_type.as_deref())
                    }
                    UpstreamBody::Streaming(_) => json!({
                        "captured": false,
                        "reason": "streaming response body was not buffered"
                    }),
                };
            }
            entry["result"] = result;
        }
        Err(error) => {
            entry["result"] = json!({
                "ok": false,
                "error": truncate_for_log(error, 240),
                "errorHash": short_hash_str(error)
            });
        }
    }

    if let Err(error) = append_diagnostic_log(app, &entry) {
        eprintln!("failed to write local proxy diagnostics: {error}");
    }
}

fn token_usage_context(
    method: &Method,
    path: &str,
    body: &[u8],
    target: &ActiveTarget,
    started_at: Instant,
    session_id: Option<&str>,
    session_request_id: Option<u64>,
) -> Option<TokenUsageContext> {
    if *method != Method::Post || !is_responses_endpoint(path) {
        return None;
    }

    let request_body = serde_json::from_slice::<Value>(body).ok();
    let (provider, provider_id, model) = match target {
        ActiveTarget::Official { model } => {
            let selected_model = request_body
                .as_ref()
                .map(|value| selected_official_model(value, model))
                .unwrap_or_else(|| model.clone());
            ("Official Codex".to_string(), None, selected_model)
        }
        ActiveTarget::Provider(provider) => {
            let model = request_body
                .as_ref()
                .map(|value| selected_provider_model(value, provider))
                .unwrap_or_else(|| provider.model.clone());
            (provider.name.clone(), Some(provider.id.clone()), model)
        }
        ActiveTarget::ProviderGroup(_) => return None,
        ActiveTarget::Aggregate(target) => (
            target.config.name.clone(),
            Some(aggregate_api::active_id(&target.config.id)),
            target.config.model.clone(),
        ),
    };

    Some(TokenUsageContext {
        ts: unix_now(),
        provider,
        provider_id,
        model,
        request_hash: short_hash_bytes(body),
        started_at,
        content_type: None,
        expects_event_stream: request_body
            .as_ref()
            .and_then(|value| value.get("stream"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        account: None,
        session_id: session_id.map(ToString::to_string),
        session_request_id,
    })
}
