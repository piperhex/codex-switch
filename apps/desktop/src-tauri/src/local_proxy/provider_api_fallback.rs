/// A transport failure cannot establish API support: the upstream may still be
/// processing the submitted request. Only an explicit endpoint rejection permits replay.
fn forward_provider_api(
    provider: &ProviderProfile,
    body: &[u8],
    mut send: impl FnMut(ProviderApiFormat) -> Result<UpstreamPayload, String>,
) -> Result<UpstreamPayload, String> {
    let request = serde_json::from_slice::<Value>(body).unwrap_or(Value::Null);
    let model = selected_provider_model(&request, provider);
    if let Some(format) = provider.model_api_formats.get(&model).copied() {
        provider_api_cache::forget_format(&provider.id, &model);
        return provider_api_attempt(format, 1, &mut send);
    }
    let requires_responses = tool_request_requires_responses(&model, &request);
    let preferred = if requires_responses {
        ProviderApiFormat::OpenaiResponses
    } else {
        provider_api_cache::cached_format(&provider.id, &provider.base_url, &model)
            .unwrap_or(provider.api_format)
    };
    let first = provider_api_attempt(preferred, 1, &mut send);
    if api_attempt_succeeded(&first) {
        remember_provider_api_format(provider, &model, preferred);
        return first;
    }
    if !first.as_ref().is_ok_and(unsupported_provider_endpoint) {
        return first;
    }
    if requires_responses {
        diagnostic_event(json!({
            "event": "provider_api_fallback_skipped", "reason": "request_requires_responses"
        }));
        return first;
    }
    let alternate = alternate_api_format(preferred);
    diagnostic_event(json!({
        "event": "provider_api_fallback", "from": preferred, "to": alternate,
        "reason": "unsupported_endpoint"
    }));
    let second = provider_api_attempt(alternate, 2, &mut send);
    if api_attempt_succeeded(&second) {
        record_discarded_proxy_attempt(&first);
        remember_provider_api_format(provider, &model, alternate);
        return second;
    }
    provider_api_cache::forget_format(&provider.id, &model);
    // Keep the original failure visible; the fallback failure remains in diagnostics/history.
    record_discarded_proxy_attempt(&second);
    first
}

fn provider_api_attempt(
    format: ProviderApiFormat,
    attempt: u8,
    send: &mut impl FnMut(ProviderApiFormat) -> Result<UpstreamPayload, String>,
) -> Result<UpstreamPayload, String> {
    let endpoint = match format {
        ProviderApiFormat::OpenaiResponses => "/responses",
        ProviderApiFormat::OpenaiChat => "/chat/completions",
    };
    diagnostic_event(json!({
        "event": "provider_api_attempt_started", "attempt": attempt,
        "apiFormat": format, "endpoint": endpoint
    }));
    let result = send(format);
    let summary = match &result {
        Ok(payload) => diagnostic_payload(payload),
        Err(error) => json!({ "error": crate::error_logs::sanitize_diagnostic_message(error) }),
    };
    diagnostic_event(json!({
        "event": "provider_api_attempt_finished", "attempt": attempt,
        "apiFormat": format, "endpoint": endpoint, "result": summary
    }));
    result
}

fn unsupported_provider_endpoint(payload: &UpstreamPayload) -> bool {
    use reqwest::StatusCode;
    let Ok(status) = StatusCode::from_u16(payload.status) else {
        return false;
    };
    if !matches!(
        status,
        StatusCode::BAD_REQUEST
            | StatusCode::NOT_FOUND
            | StatusCode::METHOD_NOT_ALLOWED
            | StatusCode::UNPROCESSABLE_ENTITY
            | StatusCode::NOT_IMPLEMENTED
    ) {
        return false;
    }
    let UpstreamBody::Buffered(body) = &payload.body else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return unsupported_endpoint_message(&String::from_utf8_lossy(body), status);
    };
    let code = value
        .pointer("/error/code")
        .or_else(|| value.pointer("/error/type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if matches!(
        code,
        "unsupported_endpoint"
            | "unknown_endpoint"
            | "endpoint_not_found"
            | "unsupported_api"
            | "unsupported_api_format"
    ) {
        return true;
    }
    let message = value
        .pointer("/error/message")
        .or_else(|| value.get("message"))
        .or_else(|| value.get("detail"))
        .or_else(|| value.get("error"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    unsupported_endpoint_message(message, status)
}

fn unsupported_endpoint_message(message: &str, status: reqwest::StatusCode) -> bool {
    use reqwest::StatusCode;
    let message = message.trim().to_ascii_lowercase();
    if matches!(
        (status, message.as_str()),
        (StatusCode::NOT_FOUND, "404 page not found")
            | (StatusCode::METHOD_NOT_ALLOWED, "method not allowed")
            | (StatusCode::NOT_IMPLEMENTED, "not implemented")
    ) {
        return true;
    }
    [
        "unsupported endpoint",
        "unknown endpoint",
        "unrecognized endpoint",
        "endpoint not found",
        "endpoint is not supported",
        "endpoint not supported",
        "unsupported api format",
        "responses api is not supported",
        "responses api not supported",
        "responses is not supported",
        "chat completions api is not supported",
        "chat completions api not supported",
        "does not support the responses api",
        "does not support the chat completions api",
        "cannot post /v1/responses",
        "cannot post /responses",
        "cannot post /v1/chat/completions",
        "cannot post /chat/completions",
    ]
    .iter()
    .any(|marker| message.contains(marker))
}

/// These models require Responses for tools at their default reasoning effort.
/// Preserve explicit model-level API overrides and never silently turn reasoning off.
/// Contract: https://developers.openai.com/api/docs/guides/deployment-checklist
fn tool_request_requires_responses(model: &str, request: &Value) -> bool {
    if !request_uses_tools(request) {
        return false;
    }
    match model {
        "gpt-6-astra" | "gpt-6.1-sol" => true,
        "gpt-6-sol" | "gpt-6-luna" => {
            request.pointer("/reasoning/effort").and_then(Value::as_str) != Some("none")
        }
        _ => false,
    }
}

fn request_uses_tools(request: &Value) -> bool {
    if request
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| !tools.is_empty())
    {
        return true;
    }
    request
        .get("input")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|item| {
                matches!(
                    item.get("type").and_then(Value::as_str),
                    Some(
                        "function_call"
                            | "function_call_output"
                            | "custom_tool_call"
                            | "custom_tool_call_output"
                    )
                )
            })
        })
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
