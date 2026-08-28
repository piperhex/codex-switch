fn forward_official<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    model: &str,
    session_id: Option<&str>,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let upstream_endpoint = upstream_endpoint_for_codex_request(url);
    let credential_purpose = if is_image_generation_endpoint(request_path(&upstream_endpoint)) {
        OfficialCredentialPurpose::ImageGeneration
    } else if request_contains_input_image(&body) {
        OfficialCredentialPurpose::ImageInput
    } else {
        OfficialCredentialPurpose::Default
    };
    let mut credentials = official_credentials(app, &client, credential_purpose, session_id)?;
    let upstream_url = official_url(&upstream_endpoint);
    let body = official_body_for_upstream(method, &upstream_endpoint, body, model);
    let mut payload = send_official_request(
        &client,
        method,
        &upstream_url,
        headers,
        body.as_slice(),
        &credentials.authentication,
    )?;
    if invalid_agent_identity_task_response(&credentials.authentication, &payload) {
        refresh_agent_identity_task(&mut credentials.authentication, app, &client)?;
        payload = send_official_request(
            &client,
            method,
            &upstream_url,
            headers,
            body.as_slice(),
            &credentials.authentication,
        )?;
    }
    payload.token_usage_account = Some(credentials.token_usage_account);
    Ok(payload)
}

fn send_official_request(
    client: &Client,
    method: &Method,
    upstream_url: &str,
    headers: &[(String, String)],
    body: &[u8],
    authentication: &OfficialRequestAuthentication,
) -> Result<UpstreamPayload, String> {
    let mut request = client
        .request(reqwest_method(method)?, upstream_url)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0");
    match authentication {
        OfficialRequestAuthentication::OAuth {
            access_token,
            chatgpt_account_id,
        } => {
            request = request.bearer_auth(access_token);
            if let Some(account_id) = chatgpt_account_id {
                request = request.header("ChatGPT-Account-Id", account_id);
            }
        }
        OfficialRequestAuthentication::AgentIdentity {
            request_authentication,
            ..
        } => {
            request = request
                .header("Authorization", &request_authentication.authorization)
                .header("ChatGPT-Account-Id", &request_authentication.account_id);
            if request_authentication.is_fedramp {
                request = request.header("x-openai-fedramp", "true");
            }
        }
    }
    stream_response(
        apply_forward_headers(request, headers, true)
            .body(body.to_vec())
            .send()
            .map_err(|error| {
                format_upstream_request_error("Official Codex proxy request failed", &error)
            })?,
    )
}

fn official_body_for_upstream(method: &Method, url: &str, body: Vec<u8>, model: &str) -> Vec<u8> {
    if *method != Method::Post || !is_responses_endpoint(request_path(url)) {
        return body;
    }
    let model = model.trim();
    if model.is_empty() {
        return body;
    }
    let Ok(mut value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    let removed_incompatible_reasoning = remove_incompatible_official_reasoning_from_input(&mut value);
    // ChatGPT's OAuth-backed Codex endpoint rejects the token-limit field that
    // OpenCode's Responses adapter sends. Codex itself leaves this field out,
    // so omit it when forwarding third-party requests to the official service.
    let removed_unsupported_output_limit = value.as_object_mut().is_some_and(|object| {
        object.remove("max_output_tokens").is_some()
    });
    if requested_model(&value).is_some()
        && !removed_incompatible_reasoning
        && !removed_unsupported_output_limit
    {
        return body;
    }
    if requested_model(&value).is_none() {
        value["model"] = Value::String(selected_official_model(&value, model));
    }
    serde_json::to_vec(&value).unwrap_or(body)
}

fn forward_provider(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let upstream_endpoint = upstream_endpoint_for_codex_request(url);
    let upstream_url = build_upstream_url(&provider.base_url, &upstream_endpoint);
    let body = provider_body_for_upstream(method, &upstream_endpoint, body, provider);
    let request = client.request(reqwest_method(method)?, upstream_url);
    let request = if provider.api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(provider.api_key.trim())
    };
    let request = apply_forward_headers(request, headers, true);
    stream_response(
        request
            .body(body)
            .send()
            .map_err(|error| format_upstream_request_error("Provider proxy request failed", &error))?,
    )
}

fn forward_provider_request(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    if provider.kind == ProviderKind::Custom
        && *method == Method::Post
        && is_response_create_endpoint(request_path(url))
    {
        return forward_provider_with_api_fallback(method, url, headers, body, provider);
    }
    if is_responses_endpoint(request_path(url))
        && provider.api_format == ProviderApiFormat::OpenaiChat
    {
        return forward_chat_bridge(method, url, headers, body, provider);
    }
    forward_provider(method, url, headers, body, provider)
}

fn forward_aggregate_request(
    request: AggregateForwardRequest<'_>,
) -> Result<UpstreamPayload, String> {
    let member_ids = request
        .target
        .profiles
        .iter()
        .map(|provider| provider.id.clone())
        .collect::<Vec<_>>();
    let mut excluded = HashSet::new();
    let mut last_result = None;
    loop {
        let member_id = match aggregate_scheduler::select_member(
            &request.target.config.id,
            request.session_id,
            &member_ids,
            &excluded,
        ) {
            Ok(member_id) => member_id,
            Err(error) => return last_result.unwrap_or(Err(error)),
        };
        let provider = request
            .target
            .profiles
            .iter()
            .find(|provider| provider.id == member_id)
            .ok_or_else(|| "Aggregate API member does not exist".to_string())?;
        let provider = aggregate_api::force_aggregate_model(provider, &request.target.config.model);
        let result = forward_provider_request(
            request.method,
            request.url,
            request.headers,
            request.body.clone(),
            &provider,
        );
        if !aggregate_result_is_retryable(&result) {
            aggregate_scheduler::mark_success(&request.target.config.id, &member_id);
            return result;
        }
        aggregate_scheduler::mark_failure(
            &request.target.config.id,
            &member_id,
            request.session_id,
        );
        excluded.insert(member_id);
        last_result = Some(result);
    }
}

fn aggregate_result_is_retryable(result: &Result<UpstreamPayload, String>) -> bool {
    match result {
        Ok(payload) => matches!(payload.status, 408 | 425 | 429 | 500 | 502 | 503 | 504),
        Err(error) => {
            let error = error.to_ascii_lowercase();
            [
                "request failed",
                "timed out",
                "timeout",
                "connection",
                "connect error",
                "network",
                "dns",
                "error sending request",
            ]
            .iter()
            .any(|marker| error.contains(marker))
        }
    }
}

fn forward_provider_with_api_fallback(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    let model = provider_request_model(&body, provider);
    if let Some(format) = provider.model_api_formats.get(&model).copied() {
        provider_api_cache::forget_format(&provider.id, &model);
        return forward_provider_with_format(format, method, url, headers, body, provider);
    }
    let preferred = provider_api_cache::cached_format(&provider.id, &provider.base_url, &model)
        .unwrap_or(provider.api_format);
    let first =
        forward_provider_with_format(preferred, method, url, headers, body.clone(), provider);
    if api_attempt_succeeded(&first) {
        remember_provider_api_format(provider, &model, preferred);
        return first;
    }
    if first.as_ref().is_ok_and(|payload| payload.status == 429) {
        return first;
    }

    let alternate = alternate_api_format(preferred);
    let second = forward_provider_with_format(alternate, method, url, headers, body, provider);
    if api_attempt_succeeded(&second) {
        remember_provider_api_format(provider, &model, alternate);
        return second;
    }
    provider_api_cache::forget_format(&provider.id, &model);
    preferred_protocol_failure(first, second)
}

fn forward_provider_with_format(
    format: ProviderApiFormat,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    match format {
        ProviderApiFormat::OpenaiResponses => {
            forward_provider(method, url, headers, body, provider)
        }
        ProviderApiFormat::OpenaiChat => forward_chat_bridge(method, url, headers, body, provider),
    }
}

fn provider_request_model(body: &[u8], provider: &ProviderProfile) -> String {
    serde_json::from_slice::<Value>(body)
        .ok()
        .map(|value| selected_provider_model(&value, provider))
        .unwrap_or_else(|| provider.model.clone())
}

fn alternate_api_format(format: ProviderApiFormat) -> ProviderApiFormat {
    match format {
        ProviderApiFormat::OpenaiResponses => ProviderApiFormat::OpenaiChat,
        ProviderApiFormat::OpenaiChat => ProviderApiFormat::OpenaiResponses,
    }
}

fn api_attempt_succeeded(result: &Result<UpstreamPayload, String>) -> bool {
    result
        .as_ref()
        .is_ok_and(|payload| status_ok(payload.status))
}

fn remember_provider_api_format(
    provider: &ProviderProfile,
    model: &str,
    format: ProviderApiFormat,
) {
    provider_api_cache::remember_format(&provider.id, &provider.base_url, model, format);
}

fn preferred_protocol_failure(
    first: Result<UpstreamPayload, String>,
    second: Result<UpstreamPayload, String>,
) -> Result<UpstreamPayload, String> {
    match (first, second) {
        (_, Ok(payload)) => Ok(payload),
        (Ok(payload), Err(_)) => Ok(payload),
        (Err(first_error), Err(second_error)) => Err(format!(
            "Provider request failed for both supported API formats: {first_error}; {second_error}"
        )),
    }
}
