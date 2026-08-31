    #[test]
    fn official_token_usage_tracks_codex_selected_model() {
        let target = ActiveTarget::Official {
            model: "gpt-5.5".to_string(),
        };
        let body = serde_json::to_vec(&json!({
            "model": "gpt-5.6-sol",
            "input": "ping"
        }))
        .unwrap();

        let context = token_usage_context(
            &Method::Post,
            "/v1/responses",
            &body,
            &target,
            Instant::now(),
            Some("session-test"),
            None,
        )
        .unwrap();

        assert_eq!(context.model, "gpt-5.6-sol");
        assert_eq!(context.session_id.as_deref(), Some("session-test"));
    }

    #[test]
    fn streaming_token_usage_does_not_require_response_content_type() {
        let target = ActiveTarget::Official {
            model: "gpt-5.6-sol".to_string(),
        };
        let body = serde_json::to_vec(&json!({
            "model": "gpt-5.6-sol",
            "input": "ping",
            "stream": true
        }))
        .unwrap();
        let context = token_usage_context(
            &Method::Post,
            "/v1/responses",
            &body,
            &target,
            Instant::now(),
            None,
            None,
        )
        .unwrap();
        let sse = concat!(
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-1\",\"usage\":{\"input_tokens\":120,\"input_tokens_details\":{\"cached_tokens\":80},\"output_tokens\":30,\"output_tokens_details\":{\"reasoning_tokens\":12},\"total_tokens\":150}}}\n\n",
            "data: [DONE]\n\n"
        );

        assert!(context.expects_event_stream);
        assert_eq!(
            extract_token_usage_from_bytes(sse.as_bytes(), None, context.expects_event_stream),
            Some(TokenUsageValues {
                input_tokens: Some(120),
                output_tokens: Some(30),
                reasoning_tokens: Some(12),
                cached_tokens: Some(80),
                total_tokens: Some(150),
            })
        );
    }

    #[test]
    fn provider_models_response_matches_codex_model_info_shape() {
        let provider = ProviderProfile {
            id: "deepseek".to_string(),
            kind: ProviderKind::Custom,
            name: "DeepSeek".to_string(),
            group: String::new(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-chat".to_string(),
            models: vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()],
            model_reasoning_efforts: Default::default(),
            model_context_windows: Default::default(),
            model_api_formats: Default::default(),
            image_input_models: vec!["deepseek-reasoner".to_string()],
            image_input_models_configured: true,
            context_window: Some(256_000),
            model_selection_controlled_by_codex: true,
            api_format: ProviderApiFormat::OpenaiResponses,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        };
        let catalog = providers::model_catalog_for_provider(&provider);
        let models = catalog["models"].as_array().unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["slug"], "deepseek-chat");
        assert_eq!(models[1]["slug"], "deepseek-reasoner");
        assert_eq!(
            models[0]["context_window"],
            providers::DEFAULT_DEEPSEEK_MODEL_CONTEXT_WINDOW
        );
        for model in models {
            for key in [
                "supported_reasoning_levels",
                "shell_type",
                "visibility",
                "supported_in_api",
                "priority",
                "base_instructions",
                "supports_reasoning_summaries",
                "support_verbosity",
                "truncation_policy",
                "supports_parallel_tool_calls",
                "experimental_supported_tools",
            ] {
                assert!(model.get(key).is_some(), "missing Codex model field {key}");
            }
        }
    }

    #[test]
    fn switch_control_catalog_exposes_only_fixed_model_name() {
        let provider = ProviderProfile {
            id: "deepseek".to_string(),
            kind: ProviderKind::Custom,
            name: "DeepSeek".to_string(),
            group: String::new(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-chat".to_string(),
            models: vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()],
            model_reasoning_efforts: Default::default(),
            model_context_windows: Default::default(),
            model_api_formats: Default::default(),
            image_input_models: Vec::new(),
            image_input_models_configured: false,
            context_window: None,
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiResponses,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        };

        let catalog = providers::model_catalog_for_provider(&provider);
        assert_eq!(
            catalog["models"][0]["slug"],
            providers::CODEX_SWITCH_CONTROL_MODEL
        );
        assert_eq!(
            selected_provider_model(
                &json!({ "model": providers::CODEX_SWITCH_CONTROL_MODEL }),
                &provider,
            ),
            "deepseek-chat"
        );
    }

    #[test]
    fn provider_models_payload_etag_changes_with_the_model_list() {
        let mut provider = ProviderProfile {
            id: "deepseek".to_string(),
            kind: ProviderKind::Custom,
            name: "DeepSeek".to_string(),
            group: String::new(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-chat".to_string(),
            models: vec!["deepseek-chat".to_string()],
            model_reasoning_efforts: Default::default(),
            model_context_windows: Default::default(),
            model_api_formats: Default::default(),
            image_input_models: Vec::new(),
            image_input_models_configured: false,
            context_window: None,
            model_selection_controlled_by_codex: true,
            api_format: ProviderApiFormat::OpenaiChat,
            balance_platform: Some(ProviderBalancePlatform::DeepSeek),
            balance_query_url: Some("https://api.deepseek.com/user/balance".to_string()),
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        };
        let first = provider_models_payload(&provider);
        provider.models.push("deepseek-reasoner".to_string());
        let second = provider_models_payload(&provider);
        let routed = provider_models_payload_with_image_route(&provider, true);
        assert_ne!(first.response_headers, second.response_headers);
        assert_ne!(second.response_headers, routed.response_headers);
        assert!(first.response_headers[0].1.starts_with("\"codex-switch-"));

        let UpstreamBody::Buffered(body) = routed.body else {
            panic!("provider model catalog should be buffered");
        };
        let catalog: Value = serde_json::from_slice(&body).unwrap();
        assert!(catalog["models"]
            .as_array()
            .unwrap()
            .iter()
            .all(|model| model["input_modalities"] == json!(["text", "image"])));
    }

    #[test]
    fn non_success_upstream_response_is_buffered_for_diagnostics() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            let response = Response::from_string("{\"error\":\"bad upstream key\"}")
                .with_status_code(StatusCode(401))
                .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
            request.respond(response).unwrap();
        });

        let response = Client::new()
            .get(format!("http://{addr}/fail"))
            .send()
            .unwrap();
        let payload = stream_response(response).unwrap();
        handle.join().unwrap();

        assert_eq!(payload.status, 401);
        let body = match payload.body {
            UpstreamBody::Buffered(body) => body,
            UpstreamBody::Streaming(_) => panic!("non-success responses should be buffered"),
        };
        let diagnostic = diagnostic_response_body(&body, payload.content_type.as_deref());
        assert_eq!(diagnostic["captured"], true);
        assert_eq!(diagnostic["text"], "{\"error\":\"bad upstream key\"}");
        assert_eq!(diagnostic["truncated"], false);
    }

    #[test]
    fn official_models_response_preserves_full_5_6_catalog_and_etag() {
        let catalog = json!({
            "models": [
                {
                    "slug": "gpt-5.6-sol",
                    "tool_mode": "code_mode_only",
                    "multi_agent_version": "v2",
                    "use_responses_lite": true,
                    "context_window": 372000
                },
                {
                    "slug": "gpt-5.6-terra",
                    "tool_mode": "code_mode_only",
                    "multi_agent_version": "v2",
                    "use_responses_lite": true,
                    "context_window": 372000
                },
                {
                    "slug": "gpt-5.6-luna",
                    "tool_mode": "code_mode_only",
                    "multi_agent_version": "v1",
                    "use_responses_lite": true,
                    "context_window": 372000
                }
            ]
        });
        let expected = serde_json::to_vec(&catalog).unwrap();
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let upstream_body = expected.clone();
        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            let response = Response::from_data(upstream_body)
                .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
                .with_header(Header::from_bytes("ETag", "\"models-5.6\"").unwrap());
            request.respond(response).unwrap();
        });

        let response = Client::new()
            .get(format!("http://{addr}/models?client_version=0.144.0"))
            .send()
            .unwrap();
        let mut payload = stream_response(response).unwrap();
        handle.join().unwrap();
        let mut actual = Vec::new();
        match &mut payload.body {
            UpstreamBody::Buffered(body) => actual.extend_from_slice(body),
            UpstreamBody::Streaming(reader) => {
                reader.read_to_end(&mut actual).unwrap();
            }
        }

        assert_eq!(actual, expected);
        assert_eq!(
            payload.response_headers,
            vec![("etag".to_string(), "\"models-5.6\"".to_string())]
        );
    }

    #[test]
    fn upstream_model_headers_are_allowlisted() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::ETAG, "\"models-5.6\"".parse().unwrap());
        headers.insert("x-models-etag", "models-refresh".parse().unwrap());
        headers.insert(
            "x-codex-rate-limit-reached-type",
            "workspace_member_usage_limit_reached".parse().unwrap(),
        );
        headers.insert(reqwest::header::SET_COOKIE, "secret=value".parse().unwrap());

        let forwarded = forwarded_response_headers(&headers);

        assert_eq!(
            forwarded,
            vec![
                ("etag".to_string(), "\"models-5.6\"".to_string()),
                ("x-models-etag".to_string(), "models-refresh".to_string()),
                (
                    "x-codex-rate-limit-reached-type".to_string(),
                    "workspace_member_usage_limit_reached".to_string(),
                ),
            ]
        );
    }

    #[test]
    fn respond_payload_preserves_model_cache_headers() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            respond_payload(
                request,
                UpstreamPayload {
                    status: 200,
                    content_type: Some("application/json".to_string()),
                    response_headers: vec![
                        ("etag".to_string(), "\"models-5.6\"".to_string()),
                        ("x-models-etag".to_string(), "models-refresh".to_string()),
                    ],
                    body: UpstreamBody::Buffered(b"{\"models\":[]}".to_vec()),
                    token_usage_account: None,
                },
            );
        });

        let response = Client::new()
            .get(format!("http://{addr}/models"))
            .send()
            .unwrap();

        assert_eq!(
            response
                .headers()
                .get("etag")
                .and_then(|value| value.to_str().ok()),
            Some("\"models-5.6\"")
        );
        assert_eq!(
            response
                .headers()
                .get("x-models-etag")
                .and_then(|value| value.to_str().ok()),
            Some("models-refresh")
        );
        assert_eq!(response.text().unwrap(), "{\"models\":[]}");
        handle.join().unwrap();
    }

    #[test]
    fn inbound_official_auth_routing_headers_are_not_forwarded() {
        for header in [
            "authorization",
            "x-api-key",
            "openai-api-key",
            "api-key",
            "chatgpt-account-id",
            "cookie",
            "proxy-authorization",
            "originator",
            LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER,
        ] {
            assert!(
                should_skip_header(header, true),
                "header should be blocked: {header}"
            );
        }
        assert!(should_skip_header(
            LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER,
            false
        ));
        assert!(!should_skip_header("x-request-id", true));
    }

    #[test]
    fn token_usage_database_lists_recent_entries_with_limit() {
        let connection = Connection::open_in_memory().unwrap();
        init_token_usage_schema(&connection).unwrap();
        for index in 0..(TOKEN_USAGE_LIST_LIMIT + 2) {
            insert_token_usage_entry(
                &connection,
                &TokenUsageEntry {
                    id: format!("entry-{index:03}"),
                    ts: index as u64,
                    provider: "Provider".to_string(),
                    provider_id: Some("provider-1".to_string()),
                    account_id: Some("account-123".to_string()),
                    account_email: Some("person@example.com".to_string()),
                    model: "gpt-test".to_string(),
                    duration_ms: Some(10),
                    input_tokens: Some(index as u64),
                    output_tokens: Some(1),
                    reasoning_tokens: Some(0),
                    cached_tokens: Some(0),
                    total_tokens: Some(index as u64 + 1),
                    model_context_window: None,
                },
            )
            .unwrap();
        }

        let entries =
            list_token_usage_entries_from_db(&connection, TOKEN_USAGE_LIST_LIMIT).unwrap();

        assert_eq!(entries.len(), TOKEN_USAGE_LIST_LIMIT);
        assert_eq!(entries[0].id, "entry-501");
        assert_eq!(entries[0].account_id.as_deref(), Some("account-123"));
        assert_eq!(
            entries[0].account_email.as_deref(),
            Some("person@example.com")
        );
        assert_eq!(entries[TOKEN_USAGE_LIST_LIMIT - 1].id, "entry-002");
        assert!(entries.iter().all(|entry| entry.id != "entry-001"));
    }

    #[test]
    fn token_usage_database_lists_all_entries_since_start_without_display_limit() {
        let connection = Connection::open_in_memory().unwrap();
        init_token_usage_schema(&connection).unwrap();
        for index in 0..(TOKEN_USAGE_LIST_LIMIT + 2) {
            insert_token_usage_entry(
                &connection,
                &TokenUsageEntry {
                    id: format!("entry-{index:03}"),
                    ts: index as u64,
                    provider: "Provider".to_string(),
                    provider_id: None,
                    account_id: None,
                    account_email: None,
                    model: "gpt-test".to_string(),
                    duration_ms: None,
                    input_tokens: Some(1),
                    output_tokens: Some(1),
                    reasoning_tokens: None,
                    cached_tokens: None,
                    total_tokens: Some(2),
                    model_context_window: None,
                },
            )
            .unwrap();
        }

        let entries = list_token_usage_entries_since_from_db(&connection, 1).unwrap();

        assert_eq!(entries.len(), TOKEN_USAGE_LIST_LIMIT + 1);
        assert_eq!(entries[0].id, "entry-501");
        assert_eq!(entries.last().map(|entry| entry.id.as_str()), Some("entry-001"));
    }
