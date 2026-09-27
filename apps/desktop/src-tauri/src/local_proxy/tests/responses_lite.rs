fn lite_test_headers() -> Vec<(String, String)> {
    vec![(
        "X-OpenAI-Internal-Codex-Responses-Lite".into(),
        "true".into(),
    )]
}

fn lite_upstream() -> (String, thread::JoinHandle<(Value, bool)>) {
    let server = Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.server_addr().to_ip().unwrap());
    let worker = thread::spawn(move || {
        let mut request = server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        let lite = request.headers().iter().any(|header| {
            header.field.equiv("x-openai-internal-codex-responses-lite")
                && header.value.as_str() == "true"
        });
        let body: Value = serde_json::from_reader(request.as_reader()).unwrap();
        request
            .respond(
                Response::from_string("{\"output\":[]}")
                    .with_header(Header::from_bytes("Content-Type", "application/json").unwrap()),
            )
            .unwrap();
        (body, lite)
    });
    (url, worker)
}

#[test]
fn responses_lite_provider_transport_repairs_every_continuation() {
    for kind in [ProviderKind::Custom, ProviderKind::OpenAi] {
        for path in [
            "/v1/responses",
            "/codex-gui/v1/responses",
            "/v1/responses/compact",
        ] {
            let (url, worker) = lite_upstream();
            let mut provider = openai_provider(url);
            provider.kind = kind;
            provider.api_format = ProviderApiFormat::OpenaiResponses;
            let request = json!({"model":"gpt-5.6-sol", "reasoning":{"effort":"xhigh"},
                "input":[{"type":"compaction", "encrypted_content":"opaque"}]});
            let response = forward_provider_request(
                &Method::Post,
                path,
                &lite_test_headers(),
                serde_json::to_vec(&request).unwrap(),
                &provider,
            )
            .unwrap();
            assert_eq!(response.status, 200);
            read_upstream_payload(response);
            let (sent, lite) = worker.join().unwrap();
            assert!(lite);
            assert_eq!(
                sent["reasoning"],
                json!({"effort":"xhigh", "context":"all_turns"})
            );
            assert_eq!(sent["input"], request["input"]);
        }
    }
}

#[test]
fn responses_lite_official_transport_also_repairs_context() {
    let (url, worker) = lite_upstream();
    let authentication = OfficialRequestAuthentication::OAuth {
        access_token: "fixture".into(),
        chatgpt_account_id: None,
    };
    let response = send_official_request(
        &Client::new(),
        &Method::Post,
        &format!("{url}/backend-api/codex/responses"),
        &lite_test_headers(),
        br#"{"reasoning":{"effort":"high"}}"#,
        &authentication,
    )
    .unwrap();
    read_upstream_payload(response);
    let (body, lite) = worker.join().unwrap();
    assert!(lite);
    assert_eq!(
        body["reasoning"],
        json!({"effort":"high","context":"all_turns"})
    );
}

#[test]
fn responses_lite_invalid_body_never_reaches_provider_or_api_fallback() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut provider = openai_provider(format!("http://{}", server.server_addr().to_ip().unwrap()));
    provider.kind = ProviderKind::Custom;
    let result = forward_provider_request(
        &Method::Post,
        "/v1/responses",
        &lite_test_headers(),
        br#"{"reasoning":[]}"#.to_vec(),
        &provider,
    );
    assert!(result.is_err());
    assert!(server.try_recv().unwrap().is_none());
}

#[test]
fn responses_lite_provider_catalog_refresh_keeps_compatibility_default() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let provider = openai_provider(format!("http://{}", server.server_addr().to_ip().unwrap()));
    let worker = thread::spawn(move || {
        for slug in ["first", "refreshed"] {
            let request = server
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap();
            request
                .respond(
                    Response::from_string(
                        json!({"models":[{
                            "slug":slug,"use_responses_lite":true,"custom_capability":"keep"
                        }]})
                        .to_string(),
                    )
                    .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
                    .with_header(Header::from_bytes("ETag", "upstream-etag").unwrap()),
                )
                .unwrap();
        }
    });
    for path in ["/v1/models", "/codex-gui/v1/models?client_version=0.157.1"] {
        let payload =
            forward_provider_request(&Method::Get, path, &[], Vec::new(), &provider).unwrap();
        assert!(payload.response_headers.iter().any(|(name, value)| {
            name.eq_ignore_ascii_case("etag") && value != "upstream-etag"
        }));
        let catalog: Value = serde_json::from_slice(&read_upstream_payload(payload)).unwrap();
        assert_eq!(catalog["models"][0]["use_responses_lite"], false);
        assert_eq!(catalog["models"][0]["custom_capability"], "keep");
    }
    worker.join().unwrap();
}

#[test]
fn responses_lite_diagnostics_record_repair_without_request_content() {
    let directory = DiagnosticTestDirectory::new();
    let scope = DiagnosticScope::enter(directory.log());
    let headers = lite_test_headers();
    let body = responses_lite::prepare(
        &Method::Post,
        "/responses",
        &headers,
        br#"{"input":"private content","reasoning":{"effort":"xhigh"}}"#.to_vec(),
    )
    .unwrap();
    let options = diagnostic_request_options(&body);
    assert_eq!(options["reasoningContext"], "all_turns");
    assert_eq!(diagnostic_header_summary(&headers)["responsesLite"], true);
    assert!(!options.to_string().contains("private"));
    drop(scope);
    assert!(directory
        .events()
        .iter()
        .any(|event| event["event"] == "responses_lite_context_repaired"));
    assert!(!fs::read_to_string(directory.log())
        .unwrap()
        .contains("private"));
}
