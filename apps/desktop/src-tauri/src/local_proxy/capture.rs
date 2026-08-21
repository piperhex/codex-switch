fn attach_token_usage_capture<R: Runtime + 'static>(
    app: &tauri::AppHandle<R>,
    context: Option<TokenUsageContext>,
    result: Result<UpstreamPayload, String>,
) -> Result<UpstreamPayload, String> {
    let mut payload = result?;
    let Some(mut context) = context else {
        return Ok(payload);
    };
    if !status_ok(payload.status) {
        return Ok(payload);
    }
    if context.provider_id.is_none() && payload.token_usage_account.is_none() {
        if let Ok(paths) = resolve_paths(app) {
            if let Some(provider_id) = read_state(&paths).active_provider_id {
                if let Ok(provider) = providers::read_provider(&paths, &provider_id) {
                    context.provider = provider.name.clone();
                    context.provider_id = Some(provider.id.clone());
                    if !provider.model_selection_controlled_by_codex
                        || !provider.models.iter().any(|model| model == &context.model)
                    {
                        context.model = provider.model.clone();
                    }
                    update_proxy_session_target(
                        context.session_id.as_deref(),
                        context.session_request_id,
                        &context.provider,
                        &context.model,
                    );
                }
            }
        }
    }
    context.content_type = payload.content_type.clone();
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
    payload.body = match payload.body {
        UpstreamBody::Buffered(body) => {
            let usage = extract_token_usage_from_bytes(
                &body,
                context.content_type.as_deref(),
                context.expects_event_stream,
            );
            record_token_usage_entry(app, &context, usage);
            UpstreamBody::Buffered(body)
        }
        UpstreamBody::Streaming(reader) => UpstreamBody::Streaming(Box::new(
            TokenUsageCaptureReader::new(reader, app.clone(), context),
        )),
    };
    Ok(payload)
}

struct TokenUsageCaptureReader<R: Runtime> {
    inner: Box<dyn Read + Send>,
    app: tauri::AppHandle<R>,
    context: TokenUsageContext,
    body: Vec<u8>,
    sse_buffer: String,
    usage: Option<TokenUsageValues>,
    recorded: bool,
}

impl<R: Runtime> TokenUsageCaptureReader<R> {
    fn new(
        inner: Box<dyn Read + Send>,
        app: tauri::AppHandle<R>,
        context: TokenUsageContext,
    ) -> Self {
        Self {
            inner,
            app,
            context,
            body: Vec::new(),
            sse_buffer: String::new(),
            usage: None,
            recorded: false,
        }
    }

    fn observe(&mut self, bytes: &[u8]) {
        if self.captures_event_stream() {
            let chunk = String::from_utf8_lossy(bytes).replace("\r\n", "\n");
            self.sse_buffer.push_str(&chunk);
            self.process_sse_blocks();
            return;
        }
        let remaining = TOKEN_USAGE_CAPTURE_MAX_BYTES.saturating_sub(self.body.len());
        if remaining > 0 {
            self.body
                .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        }
    }

    fn process_sse_blocks(&mut self) {
        while let Some(index) = self.sse_buffer.find("\n\n") {
            let block = self.sse_buffer[..index].to_string();
            self.sse_buffer.drain(..index + 2);
            self.process_sse_block(&block);
        }
    }

    fn process_sse_block(&mut self, block: &str) {
        let data = block
            .lines()
            .filter_map(|line| line.trim_start().strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.trim().is_empty() || data.trim() == "[DONE]" {
            return;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&data) {
            if let Some(usage) = extract_token_usage_from_value(&value) {
                self.usage = Some(usage);
            }
        }
    }

    fn captures_event_stream(&self) -> bool {
        self.context.expects_event_stream || is_event_stream(self.context.content_type.as_deref())
    }

    fn finish(&mut self) {
        if self.recorded {
            return;
        }
        self.recorded = true;
        if self.captures_event_stream() {
            self.process_sse_blocks();
            if !self.sse_buffer.trim().is_empty() {
                let block = std::mem::take(&mut self.sse_buffer);
                self.process_sse_block(&block);
            }
        } else if self.usage.is_none() {
            self.usage = extract_token_usage_from_bytes(
                &self.body,
                self.context.content_type.as_deref(),
                self.context.expects_event_stream,
            );
        }
        record_token_usage_entry(&self.app, &self.context, self.usage.clone());
    }
}

impl<R: Runtime> Read for TokenUsageCaptureReader<R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        match self.inner.read(target) {
            Ok(0) => {
                self.finish();
                Ok(0)
            }
            Ok(count) => {
                self.observe(&target[..count]);
                Ok(count)
            }
            Err(error) => {
                self.finish();
                Err(error)
            }
        }
    }
}

impl<R: Runtime> Drop for TokenUsageCaptureReader<R> {
    fn drop(&mut self) {
        self.finish();
    }
}

fn extract_token_usage_from_bytes(
    bytes: &[u8],
    content_type: Option<&str>,
    expects_event_stream: bool,
) -> Option<TokenUsageValues> {
    if expects_event_stream || is_event_stream(content_type) {
        let text = String::from_utf8_lossy(bytes).replace("\r\n", "\n");
        let mut usage = None;
        for block in text.split("\n\n") {
            let data = block
                .lines()
                .filter_map(|line| line.trim_start().strip_prefix("data:"))
                .map(str::trim_start)
                .collect::<Vec<_>>()
                .join("\n");
            if data.trim().is_empty() || data.trim() == "[DONE]" {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&data) {
                if let Some(next) = extract_token_usage_from_value(&value) {
                    usage = Some(next);
                }
            }
        }
        return usage;
    }

    serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| extract_token_usage_from_value(&value))
}

fn extract_token_usage_from_value(value: &Value) -> Option<TokenUsageValues> {
    let usage = value
        .get("usage")
        .filter(|usage| !usage.is_null())
        .or_else(|| {
            value
                .pointer("/response/usage")
                .filter(|usage| !usage.is_null())
        })
        .or_else(|| {
            value
                .pointer("/choices/0/usage")
                .filter(|usage| !usage.is_null())
        })?;
    Some(token_usage_values_from_usage(usage))
}

fn token_usage_values_from_usage(usage: &Value) -> TokenUsageValues {
    let input_tokens = first_usage_number(usage, &[&["input_tokens"], &["prompt_tokens"]]);
    let output_tokens = first_usage_number(usage, &[&["output_tokens"], &["completion_tokens"]]);
    let reasoning_tokens = first_usage_number(
        usage,
        &[
            &["output_tokens_details", "reasoning_tokens"],
            &["completion_tokens_details", "reasoning_tokens"],
            &["reasoning_tokens"],
        ],
    );
    let cached_tokens = first_usage_number(
        usage,
        &[
            &["input_tokens_details", "cached_tokens"],
            &["prompt_tokens_details", "cached_tokens"],
            &["cache_read_input_tokens"],
            &["cached_tokens"],
            &["prompt_cache_hit_tokens"],
        ],
    );
    let total_tokens = first_usage_number(usage, &[&["total_tokens"]]).or_else(|| {
        input_tokens
            .zip(output_tokens)
            .map(|(input, output)| input + output)
    });

    TokenUsageValues {
        input_tokens,
        output_tokens,
        reasoning_tokens,
        cached_tokens,
        total_tokens,
    }
}

fn first_usage_number(usage: &Value, paths: &[&[&str]]) -> Option<u64> {
    paths
        .iter()
        .find_map(|path| usage_number_at_path(usage, path))
}

fn usage_number_at_path(value: &Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current
        .as_u64()
        .or_else(|| current.as_i64().and_then(|value| u64::try_from(value).ok()))
}

fn record_token_usage_entry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    context: &TokenUsageContext,
    usage: Option<TokenUsageValues>,
) {
    let usage = usage.unwrap_or_default();
    update_proxy_session_request_usage(
        context.session_id.as_deref(),
        context.session_request_id,
        &usage,
    );
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
        Some(&usage),
    );
    let duration_ms = context.started_at.elapsed().as_millis() as u64;
    let id = short_hash_str(&format!(
        "{}:{}:{}:{}:{}:{}",
        context.ts,
        context.provider,
        context.model,
        context.request_hash,
        duration_ms,
        unix_millis()
    ));
    let entry = TokenUsageEntry {
        id,
        ts: context.ts,
        provider: context.provider.clone(),
        provider_id: context.provider_id.clone(),
        account_id: context
            .account
            .as_ref()
            .map(|account| account.account_id.clone()),
        account_email: context
            .account
            .as_ref()
            .map(|account| account.account_email.clone()),
        model: context.model.clone(),
        duration_ms: Some(duration_ms),
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        reasoning_tokens: usage.reasoning_tokens,
        cached_tokens: usage.cached_tokens,
        total_tokens: usage.total_tokens,
        model_context_window: None,
    };
    if let Err(error) = append_token_usage_entry(app, &entry) {
        eprintln!("failed to write token usage entry: {error}");
    } else {
        let _ = app.emit("token-usage-updated", ());
        crate::cloud::report_device_activity_after_usage(app.clone());
    }
}
