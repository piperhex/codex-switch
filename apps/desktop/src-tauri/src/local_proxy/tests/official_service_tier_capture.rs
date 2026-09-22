#[derive(Clone, Copy)]
enum TierCaptureTransport {
    BufferedJson,
    StreamedJson,
    BufferedSse,
    StreamedSse,
}

fn tier_capture_response(transport: TierCaptureTransport) -> (UpstreamBody, &'static str) {
    let response = json!({"service_tier": "default", "usage": {
        "input_tokens": 20_000, "input_tokens_details": {"cached_tokens": 10_000},
        "output_tokens": 1_000, "total_tokens": 21_000
    }});
    let (bytes, content_type) = match transport {
        TierCaptureTransport::BufferedJson | TierCaptureTransport::StreamedJson => {
            (serde_json::to_vec(&response).unwrap(), "application/json")
        }
        TierCaptureTransport::BufferedSse | TierCaptureTransport::StreamedSse => (
            service_tier_sse(&[
                json!({"type": "response.created", "response": {"service_tier": "default"}}),
                json!({"type": "response.completed", "response": response}),
            ]),
            "text/event-stream",
        ),
    };
    let body = match transport {
        TierCaptureTransport::BufferedJson | TierCaptureTransport::BufferedSse => {
            UpstreamBody::Buffered(bytes)
        }
        TierCaptureTransport::StreamedJson | TierCaptureTransport::StreamedSse => {
            UpstreamBody::Streaming(Box::new(io::Cursor::new(bytes)))
        }
    };
    (body, content_type)
}

fn tier_capture_account() -> TokenUsageAccount {
    TokenUsageAccount {
        account_id: "tier-capture-account".into(),
        account_email: "tier-capture@example.com".into(),
        active_account_generation: 0,
        auto_switch_attempt_generation: 0,
        auto_switch_eligible: false,
        concurrent_request_started_at: None,
    }
}

fn capture_tier_usage(
    fixture: &CaptureUsageFixture,
    official_account: bool,
    requested: &str,
    transport: TierCaptureTransport,
) -> TokenUsageEntry {
    let (body, content_type) = tier_capture_response(transport);
    let mut context = fixture.context();
    context.model = "gpt-6-astra".into();
    if official_account {
        context.provider = "Official Codex".into();
        context.provider_id = None;
    }
    let payload = UpstreamPayload {
        status: 200,
        content_type: Some(content_type.into()),
        response_headers: Vec::new(),
        body,
        token_usage_account: official_account.then(tier_capture_account),
        token_usage_service_tier: Some(requested.into()),
    };
    let captured =
        attach_token_usage_capture(fixture.app.handle(), Some(context), Ok(payload)).unwrap();
    let body = read_upstream_payload(captured);
    assert_eq!(
        extract_service_tier_from_bytes(&body, Some(content_type), true).as_deref(),
        Some("default"),
        "estimating subscription usage must not rewrite upstream response metadata"
    );
    let entries = fixture.entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(fixture.notifications.load(AtomicOrdering::Relaxed), 1);
    entries.into_iter().next().unwrap()
}

#[test]
fn official_fast_mode_capture_persists_the_multiplier_used_by_gui_costs() {
    let rates = crate::codex_usage_cost_rates::CostRates::default();
    for transport in [
        TierCaptureTransport::BufferedJson,
        TierCaptureTransport::StreamedJson,
        TierCaptureTransport::BufferedSse,
        TierCaptureTransport::StreamedSse,
    ] {
        for (official, requested, expected_tier, expected_cost) in [
            (true, "priority", "priority", 0.4),
            (true, "fast", "fast", 0.4),
            (true, "default", "default", 0.16),
            (false, "priority", "default", 0.16),
        ] {
            let fixture = CaptureUsageFixture::new();
            let entry = capture_tier_usage(&fixture, official, requested, transport);
            assert_eq!(entry.service_tier.as_deref(), Some(expected_tier));
            assert_eq!(entry.input_tokens, Some(20_000));
            assert_eq!(entry.cached_tokens, Some(10_000));
            assert_eq!(entry.output_tokens, Some(1_000));
            assert_eq!(entry.total_tokens, Some(21_000));
            assert!((rates.estimate_cost(&entry, None) - expected_cost).abs() < 1e-10);
        }
    }
}
