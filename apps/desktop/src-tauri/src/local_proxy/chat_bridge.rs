fn forward_chat_bridge(
    method: &Method,
    _url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> UpstreamResult {
    if *method != Method::Post {
        return Err("Chat bridge only supports POST requests".to_string().into());
    }
    let mut responses_body: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Responses request body is not valid JSON: {error}"))?;
    let selected_model = selected_provider_model(&responses_body, provider);
    responses_body["model"] = Value::String(selected_model.clone());
    let tool_context = build_codex_tool_context_from_request(&responses_body);
    let continuation_scope = chat_continuation_scope(&provider.id, headers);
    let mut chat_body = responses_to_chat_completions_with_context(
        &responses_body,
        &tool_context,
        continuation_scope.as_ref(),
    );
    if provider.balance_platform == Some(ProviderBalancePlatform::DeepSeek) {
        apply_deepseek_reasoning(&responses_body, &mut chat_body);
    }
    let stream = chat_body
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let client = http_client()?;
    let upstream_url = if provider.balance_platform == Some(ProviderBalancePlatform::DeepSeek) {
        providers::deepseek_endpoint_url(&provider.base_url, "/chat/completions")?.to_string()
    } else {
        build_upstream_url(&provider.base_url, "/chat/completions")
    };
    let request = client.post(upstream_url);
    let request = if provider.api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(provider.api_key.trim())
    }
    .json(&chat_body);
    let request = apply_forward_headers(request, headers, true);
    let response = request
        .send()
        .map_err(|error| upstream_request_error("Chat bridge request failed", error))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let response_headers = forwarded_response_headers(response.headers());
    if stream && status_ok(status) && is_event_stream(content_type.as_deref()) {
        return Ok(UpstreamPayload {
            status,
            content_type: Some("text/event-stream; charset=utf-8".to_string()),
            response_headers,
            body: UpstreamBody::Streaming(Box::new(ChatSseReader::new(
                BufReader::new(response),
                selected_model,
                tool_context,
                continuation_scope,
            ))),
            token_usage_account: None,
        });
    }

    let body = response
        .bytes()
        .map_err(|error| upstream_request_error("Failed to read chat bridge response", error))?;
    if !status_ok(status) {
        return Ok(UpstreamPayload {
            status,
            content_type: content_type
                .or_else(|| Some("application/json; charset=utf-8".to_string())),
            response_headers,
            body: UpstreamBody::Buffered(body.to_vec()),
            token_usage_account: None,
        });
    }

    let json: Value = serde_json::from_slice(&body)
        .map_err(|_| "Chat bridge upstream returned non-JSON response".to_string())?;
    let mut payload = json_payload(
        status,
        chat_to_responses_json(&json, &tool_context, continuation_scope.as_ref()),
    );
    payload.response_headers = response_headers;
    Ok(payload)
}

fn chat_continuation_scope(
    provider_id: &str,
    headers: &[(String, String)],
) -> Option<chat_bridge_continuation::ContinuationScope> {
    proxy_session_id(headers)
        .filter(|session_id| {
            provider_id.len() <= MAX_CONTINUATION_SCOPE_ID_BYTES
                && session_id.len() <= MAX_CONTINUATION_SCOPE_ID_BYTES
        })
        .map(|session_id| {
            chat_bridge_continuation::ContinuationScope::new(provider_id, &session_id)
        })
}

fn selected_provider_model(body: &Value, provider: &ProviderProfile) -> String {
    if providers::uses_upstream_official_models(provider) {
        return selected_official_model(body, &provider.model);
    }
    if !provider.model_selection_controlled_by_codex {
        return provider.model.clone();
    }
    body.get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| provider.models.iter().any(|allowed| allowed == model))
        .unwrap_or(&provider.model)
        .to_string()
}

fn requested_model(body: &Value) -> Option<&str> {
    body.get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
}

fn selected_official_model(body: &Value, fallback: &str) -> String {
    requested_model(body)
        .unwrap_or_else(|| fallback.trim())
        .to_string()
}

fn enabled_concurrent_account_ids(
    paths: &Paths,
    state: &ManagerStateFile,
) -> Result<Vec<String>, String> {
    let mut account_ids = fs::read_dir(&paths.accounts)
        .map_err(|error| format!("Failed to read account directory: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir() && entry.path().join("auth.json").is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|account_id| !state.disabled_account_ids.contains(account_id))
        .collect::<Vec<_>>();
    account_ids.sort();
    Ok(account_ids)
}

fn primary_quota_available_for_concurrent_routing(
    usage: &UsageSummary,
    threshold: Option<f64>,
) -> bool {
    let Some(threshold) = threshold else {
        return !usage
            .primary
            .as_ref()
            .is_some_and(|primary| primary.remaining_percent <= 0.0);
    };
    primary_remaining_quota_score(usage).is_some_and(|remaining| remaining >= threshold)
}

fn available_concurrent_account_ids(
    paths: &Paths,
    state: &ManagerStateFile,
) -> Result<Vec<String>, String> {
    Ok(enabled_concurrent_account_ids(paths, state)?
        .into_iter()
        .filter(|account_id| {
            let custom_threshold_enabled = state.auto_switch_on_quota_exhaustion
                && state.custom_auto_switch_threshold_enabled;
            let threshold = custom_threshold_enabled.then(|| {
                effective_auto_switch_threshold(
                    load_auto_switch_threshold(&auto_switch_threshold_path(paths, account_id)),
                    state.global_auto_switch_threshold,
                    true,
                )
            });
            primary_quota_available_for_concurrent_routing(
                &load_usage(&usage_path(paths, account_id)),
                threshold,
            )
        })
        .collect())
}

fn concurrent_account_for_session(
    paths: &Paths,
    state: &ManagerStateFile,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let enabled_account_ids = available_concurrent_account_ids(paths, state)?;
    let no_available_account = || {
        "No enabled official account currently meets the configured usage threshold".to_string()
    };
    let Some(session_id) = session_id else {
        return enabled_account_ids
            .first()
            .cloned()
            .map(Some)
            .ok_or_else(no_available_account);
    };
    let account_id = concurrent_account_router()
        .lock()
        .map_err(|_| "Concurrent account router lock is poisoned".to_string())?
        .account_for_session(session_id, &enabled_account_ids)
        .ok_or_else(no_available_account)?;
    Ok(Some(account_id))
}

fn official_credentials<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    purpose: OfficialCredentialPurpose,
    session_id: Option<&str>,
) -> Result<OfficialProxyCredentials, String> {
    let paths = resolve_paths(app)?;
    // Bind the selected account to both coordinator generations. Requests that start
    // during a switch wait here and use the new account generation; requests from the
    // same failed attempt can later tell that another thread already handled it.
    let (active_account_generation, auto_switch_attempt_generation, state) =
        auto_switch_coordinator().account_snapshot(|| Ok(read_state(&paths)))?;
    let active_account_id = state
        .active_account_id
        .as_deref()
        .ok_or_else(|| "Select an official account before using the local proxy".to_string())?;
    let concurrent_account_id = if state.concurrent_account_routing_enabled
        && matches!(purpose, OfficialCredentialPurpose::Default)
    {
        concurrent_account_for_session(&paths, &state, session_id)?
    } else {
        None
    };
    let selected_account_id = concurrent_account_id
        .as_deref()
        .unwrap_or(active_account_id);
    let active_auth = read_json(&managed_auth_path(&paths, selected_account_id))?;
    validate_auth(&active_auth)?;
    let credential_account_id = if concurrent_account_id.is_some() {
        selected_account_id.to_string()
    } else {
        credential_account_id(&state, &active_auth, purpose)?
    };
    let auto_switch_eligible =
        concurrent_account_id.is_none() && credential_account_id == active_account_id;
    let mut auth = if credential_account_id == selected_account_id {
        active_auth
    } else {
        read_json(&managed_auth_path(&paths, &credential_account_id))?
    };
    validate_auth(&auth)?;
    let (_, _, _, auth_account_id) = account_fields(&auth)?;
    if auth_account_id != credential_account_id {
        return Err(format!(
            "Managed proxy credential does not match the selected account: selected={}, credential={}",
            credential_account_id, auth_account_id
        ));
    }
    let (email, _, account_id, id) = account_fields(&auth)?;
    if concurrent_account_id.is_some() {
        mark_proxy_session_concurrent_account(session_id, &id, &email);
    }
    let token_usage_account = TokenUsageAccount {
        account_id: id,
        account_email: email,
        active_account_generation,
        auto_switch_attempt_generation,
        auto_switch_eligible,
    };
    if matches!(purpose, OfficialCredentialPurpose::ImageGeneration)
        && is_agent_identity_auth(&auth)
    {
        return Err("Select a non-Agent Identity OAuth account for image generation".to_string());
    }
    if is_agent_identity_auth(&auth) {
        if agent_identity::ensure_task(client, &mut auth)? {
            write_managed_auth_if_changed(&paths, &credential_account_id, &auth)?;
        }
        return Ok(OfficialProxyCredentials {
            authentication: OfficialRequestAuthentication::AgentIdentity {
                active_account_id: credential_account_id,
                request_authentication: agent_identity::request_authentication(&auth)?,
                auth,
            },
            token_usage_account,
        });
    }
    if token_expiring(&auth) {
        refresh_tokens(client, &mut auth)?;
        // An old in-flight request must not overwrite Codex's watched auth.json after a
        // hot switch.  Refresh only the managed credential for the account it started with.
        write_managed_auth_if_changed(&paths, &credential_account_id, &auth)?;
    }
    let access_token = token_string(&auth, "access_token")
        .ok_or_else(|| "auth.json is missing tokens.access_token".to_string())?
        .to_string();
    Ok(OfficialProxyCredentials {
        authentication: OfficialRequestAuthentication::OAuth {
            access_token,
            chatgpt_account_id: account_id,
        },
        token_usage_account,
    })
}

fn credential_account_id(
    state: &ManagerStateFile,
    active_auth: &Value,
    purpose: OfficialCredentialPurpose,
) -> Result<String, String> {
    let active_account_id = state
        .active_account_id
        .as_deref()
        .ok_or_else(|| "Select an official account before using the local proxy".to_string())?;
    match purpose {
        OfficialCredentialPurpose::Default => return Ok(active_account_id.to_string()),
        OfficialCredentialPurpose::ImageInput => {
            if let Some(ImageModelTarget::Official { account_id }) = &state.image_input_target {
                return Ok(account_id.clone());
            }
            return Ok(active_account_id.to_string());
        }
        OfficialCredentialPurpose::ImageGeneration => {}
    }
    if let Some(ImageModelTarget::Official { account_id }) = &state.image_output_target {
        return Ok(account_id.clone());
    }
    if (state.concurrent_account_routing_enabled
        || state.active_provider_id.is_some()
        || state.active_provider_group.is_some())
        && state.image_generation_account_id.is_some()
    {
        let account_id = state
            .image_generation_account_id
            .as_ref()
            .cloned()
            .unwrap_or_default();
        return Ok(account_id);
    }
    if !is_agent_identity_auth(active_auth) {
        return Ok(active_account_id.to_string());
    }
    state
        .image_generation_account_id
        .clone()
        .ok_or_else(|| "Select a non-Agent Identity OAuth account for image generation".to_string())
}
