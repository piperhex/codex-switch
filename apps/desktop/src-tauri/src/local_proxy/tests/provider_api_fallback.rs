fn fallback_test_provider() -> ProviderProfile {
    let mut provider = openai_provider("http://127.0.0.1/v1".into());
    provider.id = uuid::Uuid::new_v4().to_string();
    provider.kind = ProviderKind::Custom;
    provider.models.push("gpt-6-sol".into());
    provider
}

fn fallback_error_response(status: u16, message: &str) -> UpstreamPayload {
    json_payload(status, json!({"error": {"message": message}}))
}

#[test]
fn provider_api_transport_failures_never_replay_or_forget_a_working_format() {
    let timeout = upstream_transport::Error::Timeout {
        phase: upstream_transport::Phase::ResponseHeaders,
        sent_bytes: 651_796,
    }
    .to_string();
    for error in [
        timeout.as_str(),
        "connection reset",
        "TLS handshake failed",
        "unsupported endpoint",
    ] {
        let provider = fallback_test_provider();
        remember_provider_api_format(
            &provider,
            &provider.model,
            ProviderApiFormat::OpenaiResponses,
        );
        let mut attempts = Vec::new();
        let result = forward_provider_api(&provider, b"{}", |format| {
            attempts.push(format);
            Err(error.to_string())
        });
        assert_eq!(result.err().as_deref(), Some(error));
        assert_eq!(attempts, [ProviderApiFormat::OpenaiResponses]);
        assert_eq!(
            provider_api_cache::cached_format(&provider.id, &provider.base_url, &provider.model),
            Some(ProviderApiFormat::OpenaiResponses)
        );
        provider_api_cache::forget_format(&provider.id, &provider.model);
    }
}

#[test]
fn provider_api_request_and_transient_errors_never_trigger_protocol_fallback() {
    for (status, message) in [
        (400, "invalid tool schema"),
        (400, "Not Implemented"),
        (401, "invalid API key"),
        (403, "access denied"),
        (404, "model not found"),
        (404, "Not Found"),
        (408, "request timed out"),
        (422, "context length exceeded"),
        (429, "rate limit exceeded"),
        (500, "unsupported endpoint"),
        (502, "bad gateway"),
        (503, "overloaded"),
        (504, "gateway timeout"),
    ] {
        let provider = fallback_test_provider();
        let mut attempts = 0;
        let payload = forward_provider_api(&provider, b"{}", |_| {
            attempts += 1;
            Ok(fallback_error_response(status, message))
        })
        .unwrap();
        assert_eq!(payload.status, status);
        assert_eq!(attempts, 1, "{status}: {message}");
    }
}

#[test]
fn provider_api_explicit_endpoint_rejections_allow_both_fallback_directions() {
    for preferred in [
        ProviderApiFormat::OpenaiResponses,
        ProviderApiFormat::OpenaiChat,
    ] {
        for (status, message) in [
            (400, "Responses API is not supported"),
            (404, "unsupported endpoint"),
            (405, "Method Not Allowed"),
            (501, "Not Implemented"),
        ] {
            let mut provider = fallback_test_provider();
            provider.api_format = preferred;
            let mut attempts = Vec::new();
            let payload = forward_provider_api(&provider, b"{}", |format| {
                attempts.push(format);
                Ok(if attempts.len() == 1 {
                    fallback_error_response(status, message)
                } else {
                    json_payload(200, json!({"output": []}))
                })
            })
            .unwrap();
            assert_eq!(payload.status, 200);
            assert_eq!(attempts, [preferred, alternate_api_format(preferred)]);
            assert_eq!(
                provider_api_cache::cached_format(
                    &provider.id,
                    &provider.base_url,
                    &provider.model
                ),
                Some(alternate_api_format(preferred))
            );
            provider_api_cache::forget_format(&provider.id, &provider.model);
        }
    }
}

#[test]
fn provider_api_detection_accepts_endpoint_codes_but_not_model_errors() {
    let unsupported = json_payload(400, json!({"error": {"code": "unsupported_endpoint"}}));
    assert!(unsupported_provider_endpoint(&unsupported));
    let missing_model = json_payload(404, json!({"error": {"code": "model_not_found"}}));
    assert!(!unsupported_provider_endpoint(&missing_model));
    let mut plain_text = json_payload(404, Value::Null);
    plain_text.body = UpstreamBody::Buffered(b"404 page not found\n".to_vec());
    assert!(unsupported_provider_endpoint(&plain_text));
    plain_text.body = UpstreamBody::Buffered(Vec::new());
    assert!(!unsupported_provider_endpoint(&plain_text));
}

#[test]
fn provider_api_failed_fallback_preserves_original_response_and_traces_both_attempts() {
    for transport_failure in [false, true] {
        let provider = fallback_test_provider();
        let directory = DiagnosticTestDirectory::new();
        let scope = DiagnosticScope::enter(directory.log());
        let mut attempts = 0;
        let payload = forward_provider_api(&provider, b"{}", |_| {
            attempts += 1;
            match attempts {
                1 => Ok(fallback_error_response(404, "unsupported endpoint")),
                _ if transport_failure => Err("response headers timed out".into()),
                _ => Ok(fallback_error_response(400, "tools require Responses")),
            }
        })
        .unwrap();
        assert_eq!(payload.status, 404);
        assert!(String::from_utf8(read_upstream_payload(payload))
            .unwrap()
            .contains("unsupported endpoint"));
        assert_eq!(attempts, 2);
        assert!(provider_api_cache::cached_format(
            &provider.id,
            &provider.base_url,
            &provider.model
        )
        .is_none());
        drop(scope);
        let events = directory.events();
        let finished: Vec<_> = events
            .iter()
            .filter(|event| event["event"] == "provider_api_attempt_finished")
            .collect();
        assert_eq!(finished.len(), 2);
        assert_eq!(finished[0]["endpoint"], "/responses");
        assert_eq!(finished[0]["apiFormat"], "openaiResponses");
        assert_eq!(finished[0]["result"]["status"], 404);
        assert_eq!(finished[1]["endpoint"], "/chat/completions");
        assert_eq!(finished[1]["apiFormat"], "openaiChat");
        assert_eq!(finished[1]["attempt"], 2);
        assert_eq!(finished[0]["requestId"], finished[1]["requestId"]);
        if transport_failure {
            assert_eq!(finished[1]["result"]["error"], "response headers timed out");
        } else {
            assert_eq!(finished[1]["result"]["status"], 400);
        }
    }
}

#[test]
fn provider_api_tool_compatibility_accounts_for_reasoning_and_tool_history() {
    for model in ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-6.1-sol"] {
        assert!(!tool_request_requires_responses(
            model,
            &json!({"input": "hello"})
        ));
        for tools in [
            json!({"tools": [{"type": "function", "name": "test"}]}),
            json!({"input": [{"type": "function_call_output", "call_id": "test", "output": "ok"}]}),
        ] {
            assert!(tool_request_requires_responses(model, &tools));
            let mut request = tools;
            request["reasoning"] = json!({"effort": "xhigh"});
            assert!(tool_request_requires_responses(model, &request));
            request["reasoning"]["effort"] = json!("none");
            assert_eq!(
                tool_request_requires_responses(model, &request),
                matches!(model, "gpt-6-astra" | "gpt-6.1-sol")
            );
        }
    }
    assert!(!tool_request_requires_responses(
        "deepseek-reasoner",
        &json!({"tools": [{"type": "function"}], "reasoning": {"effort": "high"}})
    ));
}

#[test]
fn provider_api_reasoning_tools_ignore_chat_cache_and_never_downgrade() {
    let provider = fallback_test_provider();
    let model = "gpt-6-sol";
    remember_provider_api_format(&provider, model, ProviderApiFormat::OpenaiChat);
    let body = serde_json::to_vec(&json!({"model": model, "reasoning": {"effort": "xhigh"},
        "tools": [{"type": "function", "name": "test"}]}))
    .unwrap();
    let mut attempts = Vec::new();
    let payload = forward_provider_api(&provider, &body, |format| {
        attempts.push(format);
        Ok(fallback_error_response(404, "unsupported endpoint"))
    })
    .unwrap();
    assert_eq!(payload.status, 404);
    assert_eq!(attempts, [ProviderApiFormat::OpenaiResponses]);
    provider_api_cache::forget_format(&provider.id, model);
}

#[test]
fn provider_api_explicit_model_override_remains_authoritative() {
    let mut provider = fallback_test_provider();
    provider
        .model_api_formats
        .insert("gpt-6-sol".into(), ProviderApiFormat::OpenaiChat);
    let body = serde_json::to_vec(
        &json!({"model": "gpt-6-sol", "reasoning": {"effort": "high"},
        "tools": [{"type": "function", "name": "test"}]}),
    )
    .unwrap();
    let mut attempts = Vec::new();
    let payload = forward_provider_api(&provider, &body, |format| {
        attempts.push(format);
        Ok(fallback_error_response(400, "tools require Responses"))
    })
    .unwrap();
    assert_eq!(payload.status, 400);
    assert_eq!(attempts, [ProviderApiFormat::OpenaiChat]);
}

#[test]
fn provider_api_pending_request_keeps_session_polling_responsive() {
    let session_id = format!("provider-pending-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".into(), session_id.clone())];
    let guard = begin_proxy_session_request(&headers, None, b"{}", None);
    let provider = fallback_test_provider();
    let (started_tx, started_rx) = mpsc::channel();
    let (finish_tx, finish_rx) = mpsc::channel();
    let request = thread::spawn(move || {
        forward_provider_api(&provider, b"{}", |_| {
            started_tx.send(()).unwrap();
            finish_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            Err("response headers timed out".into())
        })
        .err()
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    for _ in 0..3 {
        assert!(active_proxy_session_ids().unwrap().contains(&session_id));
        let pending = list_proxy_session_requests_blocking(&session_id).unwrap();
        assert_eq!(pending.len(), 1);
        assert!(pending[0].response_time_ms.is_none());
    }
    finish_tx.send(()).unwrap();
    assert_eq!(
        request.join().unwrap().as_deref(),
        Some("response headers timed out")
    );
    drop(guard);
    proxy_sessions().lock().unwrap().remove(&session_id);
}
