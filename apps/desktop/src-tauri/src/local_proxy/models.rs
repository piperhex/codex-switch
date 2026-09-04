const MAX_OFFICIAL_MODEL_CATALOG_BYTES: u64 = 2 * 1024 * 1024;

pub(crate) struct OfficialModelCatalogFetch {
    pub(crate) catalog: Value,
    pub(crate) etag: Option<String>,
}

pub(crate) fn fetch_official_model_catalog<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account_id: &str,
    client_version: &str,
) -> Result<OfficialModelCatalogFetch, String> {
    let url = format!("/v1/models?client_version={client_version}");
    let payload = forward_official(OfficialForwardRequest {
        app,
        method: &Method::Get,
        url: &url,
        headers: &[],
        body: Vec::new(),
        model: providers::DEFAULT_OFFICIAL_MODEL,
        session_id: None,
        account_id_override: Some(account_id),
    })?;
    parse_official_model_catalog_payload(payload)
}

fn parse_official_model_catalog_payload(
    mut payload: UpstreamPayload,
) -> Result<OfficialModelCatalogFetch, String> {
    if !(200..300).contains(&payload.status) {
        return Err(format!(
            "Official model catalog returned HTTP {}",
            payload.status
        ));
    }
    let etag = payload
        .response_headers
        .iter()
        .find(|(name, _)| matches!(name.to_ascii_lowercase().as_str(), "etag" | "x-models-etag"))
        .map(|(_, value)| value.clone());
    let body = read_official_model_catalog_body(&mut payload.body)?;
    let catalog = serde_json::from_slice(&body)
        .map_err(|error| format!("Official model catalog is invalid: {error}"))?;
    Ok(OfficialModelCatalogFetch { catalog, etag })
}

fn read_official_model_catalog_body(body: &mut UpstreamBody) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    match body {
        UpstreamBody::Buffered(value) => bytes.extend_from_slice(value),
        UpstreamBody::Streaming(reader) => {
            reader
                .take(MAX_OFFICIAL_MODEL_CATALOG_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| format!("Failed to read the official model catalog: {error}"))?;
        }
    };
    if bytes.len() as u64 > MAX_OFFICIAL_MODEL_CATALOG_BYTES {
        return Err("Official model catalog is too large".to_string());
    }
    Ok(bytes)
}

fn models_payload<R: Runtime>(
    app: &tauri::AppHandle<R>,
    url: &str,
    headers: &[(String, String)],
    target: &ActiveTarget,
) -> Result<UpstreamPayload, String> {
    let upstream_headers = unconditional_model_catalog_headers(headers);
    let image_input_route_enabled = image_input_route_enabled(app);
    let payload = match target {
        ActiveTarget::Official { model } => forward_official(OfficialForwardRequest {
            app,
            method: &Method::Get,
            url,
            headers: &upstream_headers,
            body: Vec::new(),
            model,
            session_id: None,
            account_id_override: None,
        })?,
        ActiveTarget::Provider(provider) if providers::uses_upstream_official_models(provider) => {
            forward_provider(&Method::Get, url, &upstream_headers, Vec::new(), provider)?
        }
        ActiveTarget::Provider(provider) => {
            return Ok(provider_models_payload_with_image_route(
                provider,
                image_input_route_enabled,
            ));
        }
        ActiveTarget::ProviderGroup(group_providers) => {
            return Ok(provider_group_models_payload_with_image_route(
                group_providers,
                image_input_route_enabled,
            ));
        }
        ActiveTarget::Aggregate(target) => {
            return aggregate_models_payload(target, image_input_route_enabled);
        }
    };
    let payload = override_model_image_input(payload, image_input_route_enabled)?;
    if !matches!(target, ActiveTarget::Official { .. }) {
        return Ok(payload);
    }
    let settings = read_app_settings(app)?;
    override_official_model_context_windows(
        payload,
        settings.gpt_5_6_sol_context_window,
        &settings.official_model_context_windows,
    )
}

fn image_input_route_enabled<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    resolve_paths(app)
        .map(|paths| read_state(&paths).image_input_target.is_some())
        .unwrap_or(false)
}

fn unconditional_model_catalog_headers(headers: &[(String, String)]) -> Vec<(String, String)> {
    headers
        .iter()
        .filter(|(name, _)| {
            !matches!(
                name.to_ascii_lowercase().as_str(),
                "if-none-match" | "if-modified-since"
            )
        })
        .cloned()
        .collect()
}

fn override_official_model_context_windows(
    mut payload: UpstreamPayload,
    global_context_window: u64,
    model_context_windows: &std::collections::BTreeMap<String, u64>,
) -> Result<UpstreamPayload, String> {
    if payload.status != 200 {
        return Ok(payload);
    }
    let mut body = Vec::new();
    match payload.body {
        UpstreamBody::Buffered(buffered) => body = buffered,
        UpstreamBody::Streaming(mut reader) => {
            reader
                .read_to_end(&mut body)
                .map_err(|error| format!("Failed to read upstream model catalog: {error}"))?;
        }
    }
    let mut catalog = serde_json::from_slice::<Value>(&body)
        .map_err(|error| format!("Upstream model catalog is not valid JSON: {error}"))?;
    if apply_official_context_windows(
        &mut catalog,
        global_context_window,
        model_context_windows,
    ) {
        body = serde_json::to_vec(&catalog)
            .map_err(|error| format!("Failed to encode model catalog: {error}"))?;
        replace_model_catalog_etags(&mut payload.response_headers, &body);
    }
    payload.body = UpstreamBody::Buffered(body);
    Ok(payload)
}

fn apply_official_context_windows(
    catalog: &mut Value,
    global_context_window: u64,
    model_context_windows: &std::collections::BTreeMap<String, u64>,
) -> bool {
    let Some(models) = catalog.get_mut("models").and_then(Value::as_array_mut) else {
        return false;
    };
    let mut changed = false;
    for entry in models {
        let model = ["slug", "id"].into_iter().find_map(|field| {
            entry.get(field).and_then(Value::as_str)
        });
        let Some(model) = model else { continue };
        let context_window = effective_official_context_window(
            global_context_window,
            model_context_windows,
            model,
        );
        if context_window == 0 { continue }
        entry["context_window"] = json!(context_window);
        entry["max_context_window"] = json!(context_window);
        changed = true;
    }
    changed
}

fn effective_official_context_window(
    global_context_window: u64,
    model_context_windows: &std::collections::BTreeMap<String, u64>,
    model: &str,
) -> u64 {
    model_context_windows
        .get(model)
        .copied()
        .map_or(global_context_window, |override_window| {
            global_context_window.min(override_window)
        })
}

#[cfg(test)]
fn override_model_context_window(
    payload: UpstreamPayload,
    model: &str,
    context_window: u64,
) -> Result<UpstreamPayload, String> {
    let overrides = std::collections::BTreeMap::from([(model.to_string(), context_window)]);
    override_official_model_context_windows(payload, context_window, &overrides)
}

fn override_model_image_input(
    mut payload: UpstreamPayload,
    enabled: bool,
) -> Result<UpstreamPayload, String> {
    if payload.status != 200 || !enabled {
        return Ok(payload);
    }
    let mut body = Vec::new();
    match payload.body {
        UpstreamBody::Buffered(buffered) => body = buffered,
        UpstreamBody::Streaming(mut reader) => {
            reader
                .read_to_end(&mut body)
                .map_err(|error| format!("Failed to read upstream model catalog: {error}"))?;
        }
    }
    let mut catalog = serde_json::from_slice::<Value>(&body)
        .map_err(|error| format!("Upstream model catalog is not valid JSON: {error}"))?;
    let Some(models) = catalog.get_mut("models").and_then(Value::as_array_mut) else {
        payload.body = UpstreamBody::Buffered(body);
        return Ok(payload);
    };
    for model in models {
        model["input_modalities"] = json!(["text", "image"]);
    }
    body = serde_json::to_vec(&catalog)
        .map_err(|error| format!("Failed to encode model catalog: {error}"))?;
    replace_model_catalog_etags(&mut payload.response_headers, &body);
    payload.body = UpstreamBody::Buffered(body);
    Ok(payload)
}

fn replace_model_catalog_etags(headers: &mut Vec<(String, String)>, body: &[u8]) {
    let etag = format!("\"codex-switch-{}\"", short_hash_bytes(body));
    let mut found = false;
    for (name, value) in headers.iter_mut() {
        if matches!(name.to_ascii_lowercase().as_str(), "etag" | "x-models-etag") {
            value.clone_from(&etag);
            found = true;
        }
    }
    if !found {
        headers.push(("ETag".to_string(), etag));
    }
}

#[cfg(test)]
fn provider_models_payload(provider: &ProviderProfile) -> UpstreamPayload {
    provider_models_payload_with_image_route(provider, false)
}

fn provider_models_payload_with_image_route(
    provider: &ProviderProfile,
    image_input_route_enabled: bool,
) -> UpstreamPayload {
    let catalog =
        providers::model_catalog_for_provider_with_image_route(provider, image_input_route_enabled);
    let body = serde_json::to_vec(&catalog).unwrap_or_else(|_| b"{}".to_vec());
    let etag = provider_models_etag_with_image_route(provider, image_input_route_enabled);
    UpstreamPayload {
        status: 200,
        content_type: Some("application/json; charset=utf-8".to_string()),
        response_headers: vec![("ETag".to_string(), etag)],
        body: UpstreamBody::Buffered(body),
        token_usage_account: None,
    }
}

fn aggregate_models_payload(
    target: &AggregateTarget,
    image_input_route_enabled: bool,
) -> Result<UpstreamPayload, String> {
    let profile = aggregate_api::logical_profile(&target.config, &target.profiles)?;
    let catalog =
        providers::model_catalog_for_provider_with_image_route(&profile, image_input_route_enabled);
    let body = serde_json::to_vec(&catalog).unwrap_or_else(|_| b"{}".to_vec());
    Ok(UpstreamPayload {
        status: 200,
        content_type: Some("application/json; charset=utf-8".to_string()),
        response_headers: vec![(
            "ETag".to_string(),
            aggregate_models_etag(&target.config, image_input_route_enabled),
        )],
        body: UpstreamBody::Buffered(body),
        token_usage_account: None,
    })
}

fn aggregate_models_etag(config: &AggregateApiConfig, image_input_route_enabled: bool) -> String {
    format!(
        "\"aggregate-{}-{}\"",
        short_hash_str(&config.model),
        u8::from(image_input_route_enabled)
    )
}

fn provider_models_etag_with_image_route(
    provider: &ProviderProfile,
    image_input_route_enabled: bool,
) -> String {
    let catalog =
        providers::model_catalog_for_provider_with_image_route(provider, image_input_route_enabled);
    let body = serde_json::to_vec(&catalog).unwrap_or_default();
    format!("\"codex-switch-{}\"", short_hash_bytes(&body))
}

fn provider_group_models_payload_with_image_route(
    providers: &[ProviderProfile],
    image_input_route_enabled: bool,
) -> UpstreamPayload {
    let catalog = providers::model_catalog_for_provider_group_with_image_route(
        providers,
        image_input_route_enabled,
    );
    let body = serde_json::to_vec(&catalog).unwrap_or_else(|_| b"{}".to_vec());
    UpstreamPayload {
        status: 200,
        content_type: Some("application/json; charset=utf-8".to_string()),
        response_headers: vec![(
            "ETag".to_string(),
            provider_group_models_etag_with_image_route(providers, image_input_route_enabled),
        )],
        body: UpstreamBody::Buffered(body),
        token_usage_account: None,
    }
}

fn provider_group_models_etag_with_image_route(
    providers: &[ProviderProfile],
    image_input_route_enabled: bool,
) -> String {
    let catalog = providers::model_catalog_for_provider_group_with_image_route(
        providers,
        image_input_route_enabled,
    );
    let body = serde_json::to_vec(&catalog).unwrap_or_default();
    format!("\"codex-switch-{}\"", short_hash_bytes(&body))
}

fn active_provider_group_models_etag<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    let paths = resolve_paths(app).ok()?;
    let state = read_state(&paths);
    let group = state.active_provider_group.as_deref()?;
    let providers = providers::provider_group_profiles(&paths, group).ok()?;
    Some(provider_group_models_etag_with_image_route(
        &providers,
        state.image_input_target.is_some(),
    ))
}

fn provider_body_for_upstream(
    method: &Method,
    url: &str,
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Vec<u8> {
    let service_tier = provider_service_tier(provider);
    if providers::uses_upstream_official_models(provider) {
        return official_body_for_upstream_with_tier(method, url, body, &provider.model, service_tier);
    }
    if *method != Method::Post || !is_responses_endpoint(request_path(url)) {
        return body;
    }
    let Ok(mut value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    remove_local_reasoning_from_input(&mut value);
    value["model"] = Value::String(selected_provider_model(&value, provider));
    apply_proxy_service_tier(&mut value, service_tier);
    serde_json::to_vec(&value).unwrap_or(body)
}

fn provider_service_tier(provider: &ProviderProfile) -> Option<ProxyServiceTier> {
    if provider.fast_mode_enabled {
        return proxy_service_tier_override();
    }
    Some(ProxyServiceTier::Default)
}

fn body_with_selected_model(body: Vec<u8>, model: &str) -> Vec<u8> {
    let Ok(mut value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    if !value.is_object() {
        return body;
    }
    value["model"] = Value::String(model.to_string());
    serde_json::to_vec(&value).unwrap_or(body)
}

fn body_with_selected_image_model(
    body: Vec<u8>,
    model: &str,
    content_type: Option<&str>,
) -> Vec<u8> {
    if !content_type.is_some_and(|value| value.contains("multipart/form-data")) {
        return body_with_selected_model(body, model);
    }
    let Some(boundary) = content_type.and_then(multipart_boundary) else {
        return body;
    };
    replace_multipart_model(body, boundary, model)
}

fn multipart_boundary(content_type: &str) -> Option<&str> {
    content_type.split(';').find_map(|part| {
        part.trim()
            .strip_prefix("boundary=")
            .map(|value| value.trim_matches('"'))
            .filter(|value| !value.is_empty())
    })
}

fn replace_multipart_model(mut body: Vec<u8>, boundary: &str, model: &str) -> Vec<u8> {
    let field_marker = b"name=\"model\"";
    let Some(field_position) = find_bytes(&body, field_marker) else {
        return append_multipart_model(body, boundary, model);
    };
    let Some(header_offset) = find_bytes(&body[field_position..], b"\r\n\r\n") else {
        return body;
    };
    let value_start = field_position + header_offset + 4;
    let next_boundary = format!("\r\n--{boundary}");
    let Some(value_length) = find_bytes(&body[value_start..], next_boundary.as_bytes()) else {
        return body;
    };
    body.splice(value_start..value_start + value_length, model.bytes());
    body
}

fn append_multipart_model(mut body: Vec<u8>, boundary: &str, model: &str) -> Vec<u8> {
    let closing_boundary = format!("--{boundary}--");
    let Some(position) = find_bytes(&body, closing_boundary.as_bytes()) else {
        return body;
    };
    let part = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n"
    );
    body.splice(position..position, part.bytes());
    body
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    (!needle.is_empty())
        .then(|| {
            haystack
                .windows(needle.len())
                .position(|window| window == needle)
        })
        .flatten()
}
