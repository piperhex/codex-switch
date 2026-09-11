const LAN_HTTP_TEST_TIMEOUT: Duration = Duration::from_secs(10);

fn lan_http_test_app() -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = format!("com.codex-switch.lan-test.{}", uuid::Uuid::new_v4());
    tauri::test::mock_builder().build(context).unwrap()
}

fn lan_http_test_keys() -> Vec<crate::models::LocalProxyLanApiKey> {
    [
        ("exhausted", "first-http-test-secret", Some(0.0)),
        ("available", "second-http-test-secret", Some(12.5)),
    ]
    .into_iter()
    .map(|(id, secret, quota)| crate::models::LocalProxyLanApiKey {
        id: id.into(),
        name: id.into(),
        api_key: secret.into(),
        enabled: true,
        quota_usd: quota,
    })
    .collect()
}

fn assert_lan_http_quota(client: &Client, base: &str, key: &str, remaining: f64) {
    let response = client
        .get(format!("{base}/v1/codex-switch/quota"))
        .bearer_auth(key)
        .send()
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    let body = response.text().unwrap();
    assert!(
        !body.contains(key),
        "quota responses must not include the secret"
    );
    let quota: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(quota["object"], "codex_switch_quota");
    assert_eq!(quota["remainingUsd"], remaining);
    assert_eq!(quota["usedTokens"], 0);
    assert_eq!(quota["unit"], "USD");
}

fn assert_lan_missing_usage_blocks(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    client: &Client,
    base: &str,
) {
    let _scope = lan_keys::RequestKeyScope::enter(Some("available".into()));
    let target = ActiveTarget::Provider(Box::new(openai_provider(
        "https://fixture.invalid/v1".into(),
    )));
    let context = token_usage_context(TokenUsageRequest {
        method: &Method::Post,
        path: "/v1/responses",
        body: br#"{"input":"hello"}"#,
        headers: &[],
        target: &target,
        started_at: Instant::now(),
        session_id: None,
        session_request_id: None,
    });
    attach_token_usage_capture(app, context, Ok(json_payload(200, json!({"output": []})))).unwrap();
    let quota: Value = client
        .get(format!("{base}/v1/codex-switch/quota"))
        .bearer_auth("second-http-test-secret")
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(quota["usageIncomplete"], true);
    assert_eq!(quota["remainingUsd"], 12.5);
    let response = client
        .post(format!("{base}/v1/responses"))
        .bearer_auth("second-http-test-secret")
        .json(&json!({ "input": "hello" }))
        .send()
        .unwrap();
    assert_eq!(response.status().as_u16(), 503);
}

fn assert_lan_http_denials(client: &Client, base: &str) {
    for key in ["", "unrecognized-http-secret"] {
        let response = client
            .get(format!("{base}/codex-switch/quota"))
            .bearer_auth(key)
            .send()
            .unwrap();
        assert_eq!(response.status().as_u16(), 401);
    }
    let response = client
        .post(format!("{base}/v1/responses"))
        .bearer_auth("first-http-test-secret")
        .json(&json!({ "input": "hello" }))
        .send()
        .unwrap();
    assert_eq!(response.status().as_u16(), 429);
    let response = client
        .get(format!("{base}/v1/codex-switch/quota"))
        .bearer_auth("first-http-test-secret")
        .header("x-api-key", "second-http-test-secret")
        .send()
        .unwrap();
    assert_eq!(response.status().as_u16(), 401);
}

#[test]
fn lan_http_quota_is_private_and_exhausted_keys_cannot_generate() {
    let app = lan_http_test_app();
    let paths = resolve_paths(app.handle()).unwrap();
    let state = ManagerStateFile {
        local_proxy_listen_on_all_interfaces: true,
        local_proxy_lan_api_keys: lan_http_test_keys(),
        ..Default::default()
    };
    write_state(&paths, &state).unwrap();
    let server = Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr());
    let request_app = app.handle().clone();
    let worker = thread::spawn(move || {
        for _ in 0..8 {
            let request = server.recv_timeout(LAN_HTTP_TEST_TIMEOUT).unwrap().unwrap();
            handle_request(request_app.clone(), request);
        }
    });
    let client = Client::builder()
        .no_proxy()
        .timeout(LAN_HTTP_TEST_TIMEOUT)
        .build()
        .unwrap();
    assert_lan_http_quota(&client, &base, "first-http-test-secret", 0.0);
    assert_lan_http_quota(&client, &base, "second-http-test-secret", 12.5);
    assert_lan_http_denials(&client, &base);
    assert_lan_missing_usage_blocks(app.handle(), &client, &base);
    worker.join().unwrap();
    fs::remove_dir_all(paths.state_file.parent().unwrap()).unwrap();
}
