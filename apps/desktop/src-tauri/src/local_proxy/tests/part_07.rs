    #[test]
    fn chat_bridge_uses_provider_key_and_chat_endpoint() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let base_url = format!("http://{addr}");
        let (tx, rx) = mpsc::channel();

        let handle = thread::spawn(move || {
            let mut request = server.recv().unwrap();
            let path = request.url().to_string();
            let authorization = request
                .headers()
                .iter()
                .find(|header| {
                    header
                        .field
                        .as_str()
                        .as_str()
                        .eq_ignore_ascii_case("authorization")
                })
                .map(|header| header.value.as_str().to_string());
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            tx.send((path, authorization, body)).unwrap();

            let response = Response::from_string(
                json!({
                    "id": "chatcmpl_test",
                    "object": "chat.completion",
                    "model": "deepseek-v4-flash",
                    "choices": [{
                        "index": 0,
                        "message": { "role": "assistant", "content": "ok" },
                        "finish_reason": "stop"
                    }],
                    "usage": {
                        "prompt_tokens": 1,
                        "completion_tokens": 1,
                        "total_tokens": 2
                    }
                })
                .to_string(),
            )
            .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
            request.respond(response).unwrap();
        });

        let provider = ProviderProfile {
            id: "deepseek".to_string(),
            kind: ProviderKind::Custom,
            name: "DeepSeek".to_string(),
            group: String::new(),
            base_url,
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-v4-flash".to_string(),
            models: vec!["deepseek-v4-flash".to_string()],
            model_reasoning_efforts: Default::default(),
            model_context_windows: Default::default(),
            model_api_formats: Default::default(),
            image_input_models: Vec::new(),
            image_input_models_configured: false,
            context_window: None,
            model_selection_controlled_by_codex: false,
            fast_mode_enabled: false,
            api_format: ProviderApiFormat::OpenaiChat,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        };
        let body = serde_json::to_vec(&json!({
            "model": "client-placeholder",
            "input": "ping",
            "stream": false
        }))
        .unwrap();

        let payload = forward_chat_bridge(&Method::Post, "/v1/responses", &[], body, &provider)
            .expect("chat bridge request should succeed");

        let (path, authorization, upstream_body) = rx.recv().unwrap();
        handle.join().unwrap();
        assert_eq!(path, "/v1/chat/completions");
        assert_eq!(authorization.as_deref(), Some("Bearer sk-provider-test"));
        let upstream_json: Value = serde_json::from_str(&upstream_body).unwrap();
        assert_eq!(upstream_json["model"], "deepseek-v4-flash");
        assert_eq!(upstream_json["messages"][0]["content"], "ping");

        assert_eq!(payload.status, 200);
        let response_body = match payload.body {
            UpstreamBody::Buffered(body) => body,
            UpstreamBody::Streaming(_) => panic!("non-stream chat bridge should be buffered"),
        };
        let response_json: Value = serde_json::from_slice(&response_body).unwrap();
        assert_eq!(response_json["output"][0]["content"][0]["text"], "ok");
        assert_eq!(
            response_json["usage"],
            json!({
                "input_tokens": 1,
                "input_tokens_details": { "cached_tokens": 0 },
                "output_tokens": 1,
                "output_tokens_details": { "reasoning_tokens": 0 },
                "total_tokens": 2
            })
        );
    }

    fn spawn_api_detection_server() -> (String, mpsc::Receiver<String>, thread::JoinHandle<()>) {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            for request_index in 0..4 {
                let mut request = server.recv().unwrap();
                let path = request.url().to_string();
                let mut request_body = String::new();
                request
                    .as_reader()
                    .read_to_string(&mut request_body)
                    .unwrap();
                tx.send(path).unwrap();

                let response = match request_index {
                    0 => Response::from_string(
                        json!({ "error": { "message": "unsupported endpoint" } }).to_string(),
                    )
                    .with_status_code(StatusCode(404)),
                    1 | 2 => Response::from_string(
                        json!({
                            "id": "chatcmpl_auto",
                            "object": "chat.completion",
                            "model": "model-a",
                            "choices": [{
                                "index": 0,
                                "message": { "role": "assistant", "content": "ok" },
                                "finish_reason": "stop"
                            }]
                        })
                        .to_string(),
                    )
                    .with_header(Header::from_bytes("Content-Type", "application/json").unwrap()),
                    _ => Response::from_string(
                        json!({ "id": "resp_model_b", "model": "model-b" }).to_string(),
                    )
                    .with_header(Header::from_bytes("Content-Type", "application/json").unwrap()),
                };
                request.respond(response).unwrap();
            }
        });
        (format!("http://{addr}/v1"), rx, handle)
    }

    fn spawn_single_chat_api_server() -> (String, mpsc::Receiver<String>, thread::JoinHandle<()>) {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            tx.send(request.url().to_string()).unwrap();
            let response = Response::from_string(
                json!({
                    "id": "chatcmpl_fixed",
                    "object": "chat.completion",
                    "model": "model-a",
                    "choices": [{
                        "index": 0,
                        "message": { "role": "assistant", "content": "ok" },
                        "finish_reason": "stop"
                    }]
                })
                .to_string(),
            )
            .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
            request.respond(response).unwrap();
        });
        (format!("http://{addr}/v1"), rx, handle)
    }

    fn api_detection_provider(base_url: String) -> ProviderProfile {
        let mut provider = openai_provider(base_url);
        provider.id = "provider-api-detection-by-model".to_string();
        provider.kind = ProviderKind::Custom;
        provider.model = "model-a".to_string();
        provider.models = vec!["model-a".to_string(), "model-b".to_string()];
        provider
    }

    fn api_detection_body(model: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "model": model,
            "input": "ping",
            "stream": false
        }))
        .unwrap()
    }

    #[test]
    fn provider_api_detection_is_cached_independently_for_each_model() {
        let (base_url, rx, handle) = spawn_api_detection_server();
        let provider = api_detection_provider(base_url);
        let model_a_body = api_detection_body("model-a");
        let model_b_body = api_detection_body("model-b");

        for body in [model_a_body.clone(), model_a_body, model_b_body] {
            let payload =
                forward_provider_request(&Method::Post, "/v1/responses", &[], body, &provider)
                    .unwrap();
            assert_eq!(payload.status, 200);
            read_upstream_payload(payload);
        }

        handle.join().unwrap();
        let paths = rx.into_iter().collect::<Vec<_>>();
        assert_eq!(
            paths,
            vec![
                "/v1/responses",
                "/v1/chat/completions",
                "/v1/chat/completions",
                "/v1/responses"
            ]
        );
        assert_eq!(
            provider_api_cache::cached_format(&provider.id, &provider.base_url, "model-a"),
            Some(ProviderApiFormat::OpenaiChat)
        );
        assert_eq!(
            provider_api_cache::cached_format(&provider.id, &provider.base_url, "model-b"),
            Some(ProviderApiFormat::OpenaiResponses)
        );
    }

    #[test]
    fn aggregate_retryability_only_includes_transient_failures() {
        assert!(aggregate_result_is_retryable(&Ok(json_payload(
            503,
            json!({ "error": "busy" })
        ))));
        assert!(aggregate_result_is_retryable(&Err(
            "Provider proxy request failed: connection reset".to_string()
        )));
        assert!(!aggregate_result_is_retryable(&Ok(json_payload(
            401,
            json!({ "error": "unauthorized" })
        ))));
        assert!(!aggregate_result_is_retryable(&Err(
            "Request body is invalid".to_string()
        )));
    }

    #[test]
    fn configured_model_api_format_skips_automatic_fallback() {
        let (base_url, rx, handle) = spawn_single_chat_api_server();
        let mut provider = api_detection_provider(base_url);
        provider
            .model_api_formats
            .insert("model-a".to_string(), ProviderApiFormat::OpenaiChat);
        provider_api_cache::remember_format(
            &provider.id,
            &provider.base_url,
            "model-a",
            ProviderApiFormat::OpenaiResponses,
        );

        let payload = forward_provider_request(
            &Method::Post,
            "/v1/responses",
            &[],
            api_detection_body("model-a"),
            &provider,
        )
        .unwrap();
        assert_eq!(payload.status, 200);
        read_upstream_payload(payload);

        handle.join().unwrap();
        assert_eq!(rx.recv().unwrap(), "/v1/chat/completions");
        assert_eq!(
            provider_api_cache::cached_format(&provider.id, &provider.base_url, "model-a"),
            None
        );
    }
    #[test]
    fn concurrent_routing_blocks_global_automatic_switches() {
        let state = ManagerStateFile {
            auto_switch_on_quota_exhaustion: true,
            concurrent_account_routing_enabled: true,
            ..ManagerStateFile::default()
        };

        assert!(automatic_switch_is_blocked(&state));
    }

    #[test]
    fn automatic_switches_remain_available_outside_concurrent_routing() {
        let state = ManagerStateFile {
            auto_switch_on_quota_exhaustion: true,
            active_account_id: Some("official-account".to_string()),
            ..ManagerStateFile::default()
        };

        assert!(!automatic_switch_is_blocked(&state));
    }
