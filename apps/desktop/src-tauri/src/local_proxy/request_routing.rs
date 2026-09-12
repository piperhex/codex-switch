fn handle_proxy_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    session_id: Option<&str>,
    session_request_id: Option<u64>,
) -> Result<UpstreamPayload, String> {
    let _timeout_scope = sse_idle_timeout::RequestScope::enter(read_app_settings(app)?.sse_idle_timeout);
    let body = request_chat_usage(method, url, body);
    if let Some(url) = gui_routing::upstream_path(url) {
        return gui_routing::handle(gui_routing::GuiProxyRequest {
            app,
            method,
            url,
            headers,
            body,
            session_id,
            session_request_id,
        });
    }
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
        let mut target = match active_target(app) {
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
        let mut diagnostic = proxy_diagnostic_entry(
            method,
            url,
            headers,
            &body,
            Some(&target),
            ProxyDiagnosticRoute::LocalModels,
        );
        let refresh_target = std::cell::Cell::new(false);
        let retry_timeout = upstream_429_retry_timeout(app)?;
        let result = retry_upstream_request(
            retry_timeout,
            || {
                if refresh_retry_target(&mut target, &refresh_target, || active_target(app))? {
                    diagnostic = proxy_diagnostic_entry(
                        method,
                        url,
                        headers,
                        &body,
                        Some(&target),
                        ProxyDiagnosticRoute::LocalModels,
                    );
                }
                models_payload(app, url, headers, &target)
            },
            |response, event| {
                let switched = handle_upstream_quota_event(app, response, event);
                refresh_target.set(switched);
                switched
            },
        );
        append_proxy_diagnostic_result(app, diagnostic, &result, started_at.elapsed());
        return result;
    }

    let mut target = match active_target_for_request(app, path, &body) {
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
    let mut diagnostic = proxy_diagnostic_entry(method, url, headers, &body, Some(&target), route);
    let make_usage_context = |target: &ActiveTarget| {
        let context = token_usage_context(TokenUsageRequest {
            method,
            path,
            body: &body,
            headers,
            target,
            started_at,
            session_id,
            session_request_id,
        });
        if let Some(context) = context.as_ref() {
            update_proxy_session_target(
                context.session_id.as_deref(),
                session_request_id,
                &context.provider,
                &context.model,
            );
        }
        context
    };
    let mut usage_context = make_usage_context(&target);
    let refresh_target = std::cell::Cell::new(false);
    let retry_timeout = upstream_429_retry_timeout(app)?;
    let result = retry_upstream_request(
        retry_timeout,
        || {
            if refresh_retry_target(&mut target, &refresh_target, || {
                active_target_for_request(app, path, &body)
            })? {
                let route = proxy_diagnostic_route(path, &target);
                diagnostic =
                    proxy_diagnostic_entry(method, url, headers, &body, Some(&target), route);
                usage_context = make_usage_context(&target);
            }
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
            let switched = handle_upstream_quota_event(app, response, event);
            refresh_target.set(switched);
            switched
        },
    );
    let provider_models_etag = forward_target_models_etag(app, &target);
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
