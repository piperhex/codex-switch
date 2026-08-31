fn anthropic_token_probe_payload(body: &[u8]) -> UpstreamPayload {
    let request = serde_json::from_slice::<Value>(body).unwrap_or_else(|_| json!({}));
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("claude");
    let input_tokens = body.len().saturating_div(4);
    if request
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return UpstreamPayload {
            status: 200,
            content_type: Some("text/event-stream; charset=utf-8".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(
                responses_sse_to_anthropic(&[], model).into_bytes(),
            ),
            token_usage_account: None,
        };
    }
    json_payload(200, json!({
        "id": "msg_codex_switch_probe",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{ "type": "text", "text": "" }],
        "stop_reason": "max_tokens",
        "stop_sequence": Value::Null,
        "usage": { "input_tokens": input_tokens, "output_tokens": 1 }
    }))
}

fn forward_anthropic_official<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    _headers: &[(String, String)],
    body: Vec<u8>,
    session_id: Option<&str>,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let credentials = official_credentials(
        app,
        &client,
        OfficialCredentialOptions {
            purpose: OfficialCredentialPurpose::Default,
            session_id,
            account_id_override: None,
        },
    )?;
    let request: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Anthropic request body is not valid JSON: {error}"))?;
    let stream = request
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("claude");
    let app_settings = read_app_settings(app)?;
    let subagent_model = crate::third_party_apps::effective_settings(&app_settings)
        .claude_subagent_model;
    let responses_body = inject_system_prompt_value(filter_system_prompt_value(
        anthropic_to_responses(&request, &subagent_model),
    ));
    let encoded = serde_json::to_vec(&responses_body)
        .map_err(|error| format!("Failed to encode Anthropic request: {error}"))?;
    let mut payload = send_official_request(
        &client,
        &Method::Post,
        &official_url("/v1/responses"),
        // Claude Desktop sends Anthropic-specific headers that are not valid
        // Codex headers. The official route supplies its own authentication
        // and client identity; forwarding this request header set can make
        // reqwest reject the upstream builder before any network call.
        &[],
        &encoded,
        &credentials.authentication,
    )?;
    payload.token_usage_account = Some(credentials.token_usage_account);
    convert_responses_payload(payload, stream, model)
}

fn forward_anthropic_provider(
    body: Vec<u8>,
    provider: &ProviderProfile,
    subagent_model: &str,
) -> Result<UpstreamPayload, String> {
    let request: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Anthropic request body is not valid JSON: {error}"))?;
    let stream = request
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("claude");
    let mut responses_body = inject_system_prompt_value(filter_system_prompt_value(
        anthropic_to_responses(&request, subagent_model),
    ));
    let target_model = if is_anthropic_subagent_request(&request) {
        provider
            .models
            .iter()
            .find(|model| model.as_str() == subagent_model)
            .cloned()
            .unwrap_or_else(|| provider.model.clone())
    } else {
        provider.model.clone()
    };
    responses_body["model"] = Value::String(target_model);
    let encoded = serde_json::to_vec(&responses_body)
        .map_err(|error| format!("Failed to encode Anthropic request: {error}"))?;
    let payload = forward_provider_request(
        &Method::Post,
        "/v1/responses",
        &[],
        encoded,
        provider,
    )?;
    convert_responses_payload(payload, stream, model)
}

fn convert_responses_payload(
    mut payload: UpstreamPayload,
    stream: bool,
    model: &str,
) -> Result<UpstreamPayload, String> {
    if !status_ok(payload.status) {
        return Ok(payload);
    }
    let response_body = read_payload_body(&mut payload)?;
    if stream {
        return Ok(UpstreamPayload {
            status: payload.status,
            content_type: Some("text/event-stream; charset=utf-8".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(
                responses_sse_to_anthropic(&response_body, model).into_bytes(),
            ),
            token_usage_account: payload.token_usage_account,
        });
    }
    let mut converted = json_payload(
        payload.status,
        responses_sse_to_anthropic_message(&response_body, model),
    );
    converted.response_headers = payload.response_headers;
    converted.token_usage_account = payload.token_usage_account;
    Ok(converted)
}

fn read_payload_body(payload: &mut UpstreamPayload) -> Result<Vec<u8>, String> {
    match std::mem::replace(&mut payload.body, UpstreamBody::Buffered(Vec::new())) {
        UpstreamBody::Buffered(body) => Ok(body),
        UpstreamBody::Streaming(mut stream) => {
            let mut body = Vec::new();
            stream
                .read_to_end(&mut body)
                .map_err(|error| format!("Failed to read Codex response: {error}"))?;
            Ok(body)
        }
    }
}
