struct TokenUsageRequest<'a> {
    method: &'a Method,
    path: &'a str,
    body: &'a [u8],
    headers: &'a [(String, String)],
    target: &'a ActiveTarget,
    started_at: Instant,
    session_id: Option<&'a str>,
    session_request_id: Option<u64>,
}

fn token_usage_context(request: TokenUsageRequest<'_>) -> Option<TokenUsageContext> {
    let image_request = is_image_generation_endpoint(request.path);
    if *request.method != Method::Post || (!is_responses_endpoint(request.path) && !image_request) {
        return None;
    }
    let request_body = serde_json::from_slice::<Value>(request.body).ok();
    let (provider, provider_id, mut model) =
        token_usage_target(request.target, request_body.as_ref())?;
    if image_request {
        // Image endpoints forward their model unchanged; a chat model is not a valid fallback.
        model = request_body
            .as_ref()
            .and_then(requested_model)
            .map(str::to_string)
            .or_else(|| multipart_request_text_field(request.body, request.headers, "model"))
            .unwrap_or_default();
    }
    Some(TokenUsageContext {
        ts: unix_now(),
        provider,
        provider_id,
        model,
        service_tier: None,
        request_hash: short_hash_bytes(request.body),
        started_at: request.started_at,
        content_type: None,
        expects_event_stream: request_body
            .as_ref()
            .and_then(|value| value.get("stream"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        account: None,
        session_id: request.session_id.map(ToString::to_string),
        session_request_id: request.session_request_id,
    })
}

fn token_usage_target(
    target: &ActiveTarget,
    request_body: Option<&Value>,
) -> Option<(String, Option<String>, String)> {
    let metadata = match target {
        ActiveTarget::Official { model } => {
            let selected_model = request_body
                .map(|value| selected_official_model(value, model))
                .unwrap_or_else(|| model.clone());
            ("Official Codex".to_string(), None, selected_model)
        }
        ActiveTarget::Provider(provider) => {
            let model = request_body
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
    Some(metadata)
}

fn update_proxy_session_response_account(
    context: &mut TokenUsageContext,
    payload: &UpstreamPayload,
) {
    context.account = payload.token_usage_account.clone();
    update_proxy_session_usage(
        context.session_id.as_deref(),
        context
            .account
            .as_ref()
            .map(|account| account.account_id.as_str()),
        context
            .account
            .as_ref()
            .map(|account| account.account_email.as_str()),
        None,
    );
}
