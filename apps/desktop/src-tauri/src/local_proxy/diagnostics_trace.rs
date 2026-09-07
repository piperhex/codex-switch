// Proxy requests run synchronously on dedicated request workers. The scope never crosses an await;
// stream readers retain an owned context in case transport consumption moves to another thread.
thread_local! {
    static REQUEST_DIAGNOSTIC: std::cell::RefCell<Option<DiagnosticContext>> = const {
        std::cell::RefCell::new(None)
    };
}

#[derive(Clone)]
struct DiagnosticContext {
    path: PathBuf,
    request_id: String,
    started_at: Instant,
}

impl DiagnosticContext {
    fn emit(&self, mut entry: Value) {
        self.annotate(&mut entry);
        if append_diagnostic_entry(&self.path, &entry).is_err() {
            // Do not recurse into proxy error logging when the diagnostic destination fails.
            eprintln!("Could not write proxy diagnostic event");
        }
    }

    fn annotate(&self, entry: &mut Value) {
        entry["ts"] = json!(unix_now());
        entry["requestId"] = json!(self.request_id);
        entry["elapsedMs"] = json!(self.started_at.elapsed().as_millis() as u64);
        entry["schemaVersion"] = json!(DIAGNOSTIC_SCHEMA_VERSION);
    }
}

struct DiagnosticScope(Option<DiagnosticContext>);

impl DiagnosticScope {
    fn enter(path: PathBuf) -> Self {
        let context = DiagnosticContext {
            path,
            request_id: uuid::Uuid::new_v4().to_string(),
            started_at: Instant::now(),
        };
        Self(REQUEST_DIAGNOSTIC.with(|current| current.replace(Some(context))))
    }
}

impl Drop for DiagnosticScope {
    fn drop(&mut self) {
        diagnostic_event(json!({ "event": "request_finished" }));
        drop(REQUEST_DIAGNOSTIC.with(|current| current.replace(self.0.take())));
    }
}

fn current_diagnostic_context() -> Option<DiagnosticContext> {
    REQUEST_DIAGNOSTIC.with(|current| current.borrow().clone())
}

fn diagnostic_event(entry: Value) {
    if let Some(context) = current_diagnostic_context() {
        context.emit(entry);
    }
}

fn diagnostic_account(account: &TokenUsageAccount) -> Value {
    json!({
        "idHash": short_hash_str(&account.account_id),
        "activeGeneration": account.active_account_generation,
        "switchGeneration": account.auto_switch_attempt_generation,
        "autoSwitchEligible": account.auto_switch_eligible,
        "concurrentAssignment": account.concurrent_request_started_at.is_some()
    })
}

fn diagnostic_payload(payload: &UpstreamPayload) -> Value {
    let mut result = json!({
        "status": payload.status,
        "ok": status_ok(payload.status),
        "contentType": payload.content_type,
        "serviceTier": payload.token_usage_service_tier,
        "account": payload.token_usage_account.as_ref().map(diagnostic_account),
        "streaming": matches!(payload.body, UpstreamBody::Streaming(_))
    });
    if !status_ok(payload.status) {
        if let UpstreamBody::Buffered(body) = &payload.body {
            result["responseBody"] =
                diagnostic_response_body(body, payload.content_type.as_deref());
        }
    }
    result
}

fn diagnostic_attempt(result: &Result<UpstreamPayload, String>, attempt: u64, started: Instant) {
    let result = match result {
        Ok(payload) => diagnostic_payload(payload),
        Err(error) => json!({ "error": crate::error_logs::sanitize_diagnostic_message(error) }),
    };
    diagnostic_event(json!({
        "event": "upstream_attempt", "attempt": attempt,
        "durationMs": started.elapsed().as_millis() as u64, "result": result
    }));
}

fn diagnostic_retry(reason: &str, delay: Duration) {
    diagnostic_event(json!({
        "event": "upstream_retry", "reason": reason, "delayMs": delay.as_millis() as u64
    }));
}

fn diagnostic_http_result(result: &Result<ReqwestResponse, reqwest::Error>, attempt: usize) {
    let result = match result {
        Ok(response) => json!({
            "status": response.status().as_u16(),
            "headers": diagnostic_upstream_headers(response.headers())
        }),
        Err(error) => json!({
            "timeout": error.is_timeout(), "connect": error.is_connect(),
            "error": crate::error_logs::sanitize_diagnostic_message(&error.to_string()),
            "causes": diagnostic_error_causes(error)
        }),
    };
    diagnostic_event(
        json!({ "event": "upstream_http_result", "attempt": attempt, "result": result }),
    );
}

fn diagnostic_error_causes(error: &dyn std::error::Error) -> Vec<String> {
    const MAX_ERROR_CAUSES: usize = 4;
    let mut causes = Vec::new();
    let mut source = error.source();
    while let Some(error) = source {
        causes.push(crate::error_logs::sanitize_diagnostic_message(
            &error.to_string(),
        ));
        if causes.len() == MAX_ERROR_CAUSES {
            break;
        }
        source = error.source();
    }
    causes
}

fn diagnostic_upstream_headers(headers: &reqwest::header::HeaderMap) -> Value {
    let mut result = serde_json::Map::new();
    for name in [
        "x-request-id",
        "request-id",
        "cf-ray",
        "retry-after",
        "x-codex-rate-limit-reached-type",
    ] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) {
            result.insert(
                name.to_string(),
                json!(crate::error_logs::sanitize_diagnostic_message(value)),
            );
        }
    }
    Value::Object(result)
}

fn diagnostic_request_options(body: &[u8]) -> Value {
    let value = serde_json::from_slice::<Value>(body).unwrap_or(Value::Null);
    let mut result = serde_json::Map::new();
    for (name, pointer) in [
        ("model", "/model"),
        ("serviceTier", "/service_tier"),
        ("reasoningEffort", "/reasoning/effort"),
    ] {
        if let Some(value) = value.pointer(pointer).and_then(Value::as_str) {
            result.insert(
                name.to_string(),
                json!(crate::error_logs::sanitize_diagnostic_message(
                    &truncate_for_log(value, DIAGNOSTIC_REQUEST_OPTION_MAX_CHARS)
                )),
            );
        }
    }
    Value::Object(result)
}
