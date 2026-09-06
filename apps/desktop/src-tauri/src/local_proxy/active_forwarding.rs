struct ActiveForwardRequest<'a, R: Runtime> {
    app: &'a tauri::AppHandle<R>,
    method: &'a Method,
    url: &'a str,
    headers: &'a [(String, String)],
    body: Vec<u8>,
    target: &'a ActiveTarget,
    session_id: Option<&'a str>,
    account_id_override: Option<&'a str>,
}

fn refresh_retry_target(
    target: &mut ActiveTarget,
    refresh_requested: &std::cell::Cell<bool>,
    resolve: impl FnOnce() -> Result<ActiveTarget, String>,
) -> Result<bool, String> {
    if !refresh_requested.get() {
        return Ok(false);
    }
    // Account switching can also activate a Provider. Resolve the whole route before
    // replaying the request so it cannot keep using the previous official endpoint.
    *target = resolve()?;
    refresh_requested.set(false);
    Ok(true)
}

fn forward_target_models_etag<R: Runtime>(
    app: &tauri::AppHandle<R>,
    target: &ActiveTarget,
) -> Option<String> {
    active_provider_group_models_etag(app).or_else(|| match target {
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
    })
}

fn forward_active_request<R: Runtime>(
    request: ActiveForwardRequest<'_, R>,
) -> Result<UpstreamPayload, String> {
    let ActiveForwardRequest {
        app,
        method,
        url,
        headers,
        body,
        target,
        session_id,
        account_id_override,
    } = request;
    match target {
        ActiveTarget::Official { model } => {
            if is_anthropic_messages_endpoint(request_path(url)) {
                return forward_anthropic_official(app, headers, body, session_id);
            }
            forward_official(OfficialForwardRequest {
                app,
                method,
                url,
                headers,
                body,
                model,
                session_id,
                account_id_override,
            })
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
