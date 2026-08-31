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
