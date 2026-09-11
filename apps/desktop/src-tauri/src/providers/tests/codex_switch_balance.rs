fn codex_switch_quota_payload(remaining: Value, unlimited: bool) -> Value {
    json!({
        "object": "codex_switch_quota",
        "quotaUsd": if unlimited { Value::Null } else { json!(10.0) },
        "usedCostUsd": 2.5,
        "remainingUsd": remaining,
        "usedTokens": 12_345,
        "unlimited": unlimited,
        "unit": "USD"
    })
}

#[test]
fn codex_switch_quota_urls_preserve_prefixes_without_duplicate_api_versions() {
    for (base_url, expected) in [
        (
            "http://192.168.1.2:15721",
            "http://192.168.1.2:15721/v1/codex-switch/quota",
        ),
        (
            "http://192.168.1.2:15721/v1/",
            "http://192.168.1.2:15721/v1/codex-switch/quota",
        ),
        (
            "https://relay.test/team/api/v1",
            "https://relay.test/team/v1/codex-switch/quota",
        ),
        (
            "https://relay.test/team/v1?key=private#fragment",
            "https://relay.test/team/v1/codex-switch/quota",
        ),
        (
            "https://relay.test/team/api",
            "https://relay.test/team/api/v1/codex-switch/quota",
        ),
    ] {
        assert_eq!(codex_switch_quota_url(base_url).unwrap(), expected);
    }
    assert!(codex_switch_quota_url("file:///tmp/quota").is_err());
}

#[test]
fn codex_switch_reports_remaining_exhausted_and_unlimited_key_quotas() {
    for remaining in [7.5_f64, 0.0, -0.01] {
        let parsed = parse_provider_api_balance(
            ProviderBalancePlatform::CodexSwitch,
            &codex_switch_quota_payload(json!(remaining), false),
        )
        .unwrap();
        assert_eq!(parsed.amount, Some(remaining.max(0.0)));
        assert_eq!(parsed.unit, "USD");
        assert!(!parsed.unlimited);
        assert!(parsed.embedded_wallet_amount.is_none());
    }
    let parsed = parse_provider_api_balance(
        ProviderBalancePlatform::CodexSwitch,
        &codex_switch_quota_payload(Value::Null, true),
    )
    .unwrap();
    assert!(parsed.unlimited);
    assert!(parsed.amount.is_none());
}

#[test]
fn codex_switch_rejects_missing_remaining_and_unrelated_payloads() {
    assert!(!is_codex_switch_quota_payload(&codex_switch_quota_payload(
        Value::Null,
        false
    )));
    assert!(!is_codex_switch_quota_payload(
        &json!({ "remaining": 10, "unit": "USD" })
    ));
    let mut payload = codex_switch_quota_payload(json!(5), false);
    payload["object"] = json!("unrelated_quota");
    assert!(!is_codex_switch_quota_payload(&payload));
    payload["object"] = json!("codex_switch_quota");
    payload["unit"] = json!("CNY");
    assert!(!is_codex_switch_quota_payload(&payload));
}

#[test]
fn codex_switch_pending_usage_blocks_limited_balance_without_hiding_the_platform() {
    let mut payload = codex_switch_quota_payload(json!(7.5), false);
    payload["usageIncomplete"] = json!(true);
    assert!(is_codex_switch_quota_payload(&payload));
    let parsed = parse_provider_api_balance(ProviderBalancePlatform::CodexSwitch, &payload);
    assert_eq!(parsed.err().as_deref(), Some("部分用量待确认，请联系上游管理员核对额度。"));
    payload["remainingUsd"] = Value::Null;
    assert!(!is_codex_switch_quota_payload(&payload));
}

#[test]
fn codex_switch_pending_usage_keeps_unlimited_keys_available_and_detectable() {
    let mut payload = codex_switch_quota_payload(Value::Null, true);
    payload["usageIncomplete"] = json!(true);
    assert!(is_codex_switch_quota_payload(&payload));
    let parsed = parse_provider_api_balance(ProviderBalancePlatform::CodexSwitch, &payload).unwrap();
    assert!(parsed.unlimited);
    assert!(parsed.amount.is_none());
}

#[test]
fn codex_switch_quota_uses_the_provider_key_and_has_no_separate_wallet() {
    let mut profile = provider();
    profile.balance_platform = Some(ProviderBalancePlatform::CodexSwitch);
    profile.balance_query_url = Some("https://unrelated.test/quota".to_string());
    profile.balance_query_token = Some("unrelated-key".to_string());
    profile.wallet_query_url = Some("https://unrelated.test/wallet".to_string());
    profile.wallet_query_token = Some("wallet-key".to_string());
    let normalized = normalize_provider_profile(profile).unwrap();
    assert_eq!(
        normalized.balance_query_url.as_deref(),
        Some("https://gateway.example.com/v1/codex-switch/quota")
    );
    assert!(normalized.balance_query_token.is_none());
    assert!(normalized.wallet_query_url.is_none());
    assert!(normalized.wallet_query_token.is_none());
}

#[test]
fn codex_switch_preset_detects_quota_with_saved_key_even_when_exhausted() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let base_url = format!("http://{}/v1", server.server_addr());
    let worker = std::thread::spawn(move || {
        let request = server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        assert_eq!(request.url(), "/v1/codex-switch/quota");
        assert!(request.headers().iter().any(|header| {
            header.field.equiv("Authorization") && header.value.as_str() == "Bearer saved-key"
        }));
        request
            .respond(Response::from_string(
                codex_switch_quota_payload(json!(0), false).to_string(),
            ))
            .unwrap();
    });
    let configured = resolve_codex_switch_balance_settings(
        &base_url,
        "saved-key",
        ProviderKind::OpenAi,
        (None, None),
    );
    worker.join().unwrap();
    assert_eq!(configured.0, Some(ProviderBalancePlatform::CodexSwitch));
    assert_eq!(configured.1, Some(format!("{base_url}/codex-switch/quota")));
}

#[test]
fn codex_switch_quota_settings_do_not_probe_unrelated_providers() {
    assert_eq!(
        resolve_codex_switch_balance_settings(
            "https://unreachable.invalid/v1",
            "key",
            ProviderKind::Custom,
            (None, None),
        ),
        (None, None)
    );
    let configured = (
        Some(ProviderBalancePlatform::NewApi),
        Some("https://relay.test/usage".to_string()),
    );
    assert_eq!(
        resolve_codex_switch_balance_settings(
            "https://unreachable.invalid/v1",
            "key",
            ProviderKind::OpenAi,
            configured.clone(),
        ),
        configured
    );
}
