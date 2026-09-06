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
            body: UpstreamBody::Buffered(anthropic_stream::response_sse(
                &json!({
                    "id": "msg_codex_switch_probe", "status": "incomplete", "output": [],
                    "incomplete_details": { "reason": "max_output_tokens" },
                    "usage": { "input_tokens": input_tokens, "output_tokens": 1 }
                }),
                model,
            )),
            token_usage_service_tier: None,
            token_usage_account: None,
        };
    }
    json_payload(
        200,
        json!({
            "id": "msg_codex_switch_probe",
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [{ "type": "text", "text": "" }],
            "stop_reason": "max_tokens",
            "stop_sequence": Value::Null,
            "usage": { "input_tokens": input_tokens, "output_tokens": 1 }
        }),
    )
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
    let subagent_model =
        crate::third_party_apps::effective_settings(&app_settings).claude_subagent_model;
    let responses_body = inject_system_prompt_value(filter_system_prompt_value(
        anthropic_to_responses(&request, &subagent_model),
    ));
    update_proxy_session_target(
        session_id,
        None,
        "Official Codex",
        requested_model(&responses_body).unwrap_or_default(),
    );
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
    if let Some(tier) = request.get("service_tier") {
        responses_body["service_tier"] = tier.clone();
    }
    responses_body["model"] =
        Value::String(anthropic_provider_model(&request, provider, subagent_model));
    let encoded = serde_json::to_vec(&responses_body)
        .map_err(|error| format!("Failed to encode Anthropic request: {error}"))?;
    let payload = forward_provider_request(&Method::Post, "/v1/responses", &[], encoded, provider)?;
    convert_responses_payload(payload, stream, model)
}

fn anthropic_provider_model(
    request: &Value,
    provider: &ProviderProfile,
    subagent_model: &str,
) -> String {
    if is_anthropic_subagent_request(request) {
        provider
            .models
            .iter()
            .find(|model| model.as_str() == subagent_model)
            .cloned()
            .unwrap_or_else(|| provider.model.clone())
    } else {
        provider.model.clone()
    }
}

fn convert_responses_payload(
    mut payload: UpstreamPayload,
    stream: bool,
    model: &str,
) -> Result<UpstreamPayload, String> {
    if !status_ok(payload.status) {
        return Ok(payload);
    }
    if payload
        .content_type
        .as_deref()
        .is_some_and(|value| value.contains("application/json"))
    {
        let response = match &mut payload.body {
            UpstreamBody::Buffered(body) => serde_json::from_slice::<Value>(body),
            UpstreamBody::Streaming(reader) => serde_json::from_reader::<_, Value>(reader),
        }
        .map_err(|_| "The service returned an invalid response. Please try again.".to_string())?;
        return convert_anthropic_json_payload(payload, &response, stream, model);
    }
    let upstream_body = std::mem::replace(&mut payload.body, UpstreamBody::Buffered(Vec::new()));
    let reader: Box<dyn Read + Send> = match upstream_body {
        UpstreamBody::Buffered(body) => {
            if let Ok(response) = serde_json::from_slice::<Value>(&body) {
                return convert_anthropic_json_payload(payload, &response, stream, model);
            }
            Box::new(std::io::Cursor::new(body))
        }
        UpstreamBody::Streaming(reader) => reader,
    };
    if stream {
        payload.content_type = Some("text/event-stream; charset=utf-8".to_string());
        payload.body = UpstreamBody::Streaming(Box::new(
            anthropic_stream::AnthropicSseReader::new(BufReader::new(reader), model),
        ));
        return Ok(payload);
    }
    let message =
        anthropic_stream::collect_message(reader, model).map_err(|error| error.to_string())?;
    payload.content_type = Some("application/json; charset=utf-8".to_string());
    payload.body = UpstreamBody::Buffered(message.to_string().into_bytes());
    Ok(payload)
}

fn convert_anthropic_json_payload(
    mut payload: UpstreamPayload,
    response: &Value,
    stream: bool,
    model: &str,
) -> Result<UpstreamPayload, String> {
    let message =
        anthropic_stream::convert_response(response, model).map_err(|error| error.to_string())?;
    let (content_type, body) = if stream {
        (
            "text/event-stream",
            anthropic_stream::response_sse(response, model),
        )
    } else {
        ("application/json", message.to_string().into_bytes())
    };
    payload.content_type = Some(format!("{content_type}; charset=utf-8"));
    payload.body = UpstreamBody::Buffered(body);
    Ok(payload)
}
