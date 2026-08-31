    #[test]
    fn token_usage_database_aggregates_all_account_entries_since_start() {
        let connection = Connection::open_in_memory().unwrap();
        init_token_usage_schema(&connection).unwrap();
        for entry in [
            TokenUsageEntry {
                id: "before".to_string(),
                ts: 99,
                provider: "Official Codex".to_string(),
                provider_id: None,
                account_id: Some("account-123".to_string()),
                account_email: Some("person@example.com".to_string()),
                model: "gpt-old".to_string(),
                duration_ms: None,
                input_tokens: Some(900),
                output_tokens: Some(100),
                reasoning_tokens: Some(0),
                cached_tokens: Some(0),
                total_tokens: Some(1_000),
                model_context_window: None,
            },
            TokenUsageEntry {
                id: "today-model-a".to_string(),
                ts: 100,
                provider: "Official Codex".to_string(),
                provider_id: None,
                account_id: Some("account-123".to_string()),
                account_email: Some("person@example.com".to_string()),
                model: "gpt-a".to_string(),
                duration_ms: None,
                input_tokens: Some(80),
                output_tokens: Some(20),
                reasoning_tokens: Some(5),
                cached_tokens: Some(50),
                total_tokens: Some(100),
                model_context_window: None,
            },
            TokenUsageEntry {
                id: "today-model-b".to_string(),
                ts: 101,
                provider: "Official Codex".to_string(),
                provider_id: None,
                account_id: Some("account-123".to_string()),
                account_email: Some("person@example.com".to_string()),
                model: "gpt-b".to_string(),
                duration_ms: None,
                input_tokens: Some(40),
                output_tokens: Some(10),
                reasoning_tokens: Some(3),
                cached_tokens: Some(20),
                total_tokens: None,
                model_context_window: None,
            },
        ] {
            insert_token_usage_entry(&connection, &entry).unwrap();
        }

        let totals = list_account_token_usage_from_db(&connection, 100).unwrap();

        assert_eq!(
            totals,
            vec![AccountTokenUsageTotals {
                account_id: Some("account-123".to_string()),
                account_email: Some("person@example.com".to_string()),
                total_tokens: 150,
                input_tokens: 120,
                output_tokens: 30,
                reasoning_tokens: 8,
                cached_tokens: 70,
            }]
        );
    }

    #[test]
    fn token_usage_database_aggregates_provider_today_and_total() {
        let connection = Connection::open_in_memory().unwrap();
        init_token_usage_schema(&connection).unwrap();
        for (id, ts, provider, total_tokens) in [
            ("relay-before", 99, "Relay A", Some(1_000)),
            ("relay-today", 100, "Relay A", Some(150)),
            ("relay-fallback", 101, "Relay B", None),
        ] {
            insert_token_usage_entry(
                &connection,
                &TokenUsageEntry {
                    id: id.to_string(),
                    ts,
                    provider: provider.to_string(),
                    provider_id: Some(provider.to_lowercase().replace(' ', "-")),
                    account_id: None,
                    account_email: None,
                    model: "gpt-test".to_string(),
                    duration_ms: None,
                    input_tokens: Some(40),
                    output_tokens: Some(10),
                    reasoning_tokens: Some(0),
                    cached_tokens: Some(0),
                    total_tokens,
                    model_context_window: None,
                },
            )
            .unwrap();
        }
        connection
            .execute(
                "DELETE FROM token_usage_entries WHERE id = 'relay-before'",
                [],
            )
            .unwrap();

        let totals = list_provider_token_usage_from_db(&connection, 100).unwrap();

        assert_eq!(
            totals,
            vec![
                ProviderTokenUsageTotals {
                    provider: "Relay A".to_string(),
                    provider_id: Some("relay-a".to_string()),
                    today_tokens: 150,
                    total_tokens: 1_150,
                },
                ProviderTokenUsageTotals {
                    provider: "Relay B".to_string(),
                    provider_id: Some("relay-b".to_string()),
                    today_tokens: 50,
                    total_tokens: 50,
                },
            ]
        );
    }

    #[test]
    fn model_context_windows_match_codex_effective_window_calculation() {
        let catalog = json!({
            "models": [
                {
                    "slug": "gpt-effective",
                    "context_window": 272_000,
                    "max_context_window": 1_000_000,
                    "effective_context_window_percent": 95
                },
                {
                    "slug": "gpt-max-fallback",
                    "context_window": null,
                    "max_context_window": 128_000
                }
            ]
        });

        assert_eq!(
            model_context_windows_from_catalog(&catalog),
            HashMap::from([
                ("gpt-effective".to_string(), 258_400),
                ("gpt-max-fallback".to_string(), 121_600),
            ])
        );
    }

    #[test]
    fn model_catalog_context_override_updates_limits_and_etag() {
        let catalog = json!({
            "models": [{
                "slug": GPT_5_6_SOL_MODEL,
                "context_window": 272_000,
                "max_context_window": 872_000,
                "effective_context_window_percent": 95
            }]
        });
        let payload = UpstreamPayload {
            status: 200,
            content_type: Some("application/json".to_string()),
            response_headers: vec![("x-models-etag".to_string(), "upstream".to_string())],
            body: UpstreamBody::Buffered(serde_json::to_vec(&catalog).unwrap()),
            token_usage_account: None,
        };

        let payload = override_model_context_window(payload, GPT_5_6_SOL_MODEL, 1_000_000).unwrap();
        let UpstreamBody::Buffered(body) = payload.body else {
            panic!("model catalog override must buffer the response");
        };
        let updated: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(updated["models"][0]["context_window"], 1_000_000);
        assert_eq!(updated["models"][0]["max_context_window"], 1_000_000);
        assert_eq!(updated["models"][0]["effective_context_window_percent"], 95);
        assert!(payload.response_headers[0].1.starts_with("\"codex-switch-"));
    }

    #[test]
    fn model_catalog_refresh_removes_conditional_request_headers() {
        let headers = vec![
            ("If-None-Match".to_string(), "cached".to_string()),
            ("If-Modified-Since".to_string(), "yesterday".to_string()),
            ("User-Agent".to_string(), "Codex".to_string()),
        ];

        assert_eq!(
            unconditional_model_catalog_headers(&headers),
            vec![("User-Agent".to_string(), "Codex".to_string())]
        );
    }

    #[test]
    fn gpt_5_6_sol_context_window_validation_uses_whole_k_increments() {
        assert!(validate_gpt_5_6_sol_context_window(272_000).is_ok());
        assert!(validate_gpt_5_6_sol_context_window(1_000_000).is_ok());
        assert!(validate_gpt_5_6_sol_context_window(272_001).is_err());
        assert!(validate_gpt_5_6_sol_context_window(1_051_000).is_err());
    }

    #[test]
    fn official_model_context_window_uses_the_lower_of_global_and_model_override() {
        let overrides = std::collections::BTreeMap::from([
            ("gpt-5.6-sol".to_string(), 128_000),
            ("gpt-5.5".to_string(), 400_000),
        ]);

        assert_eq!(effective_official_context_window(272_000, &overrides, "gpt-5.6-sol"), 128_000);
        assert_eq!(effective_official_context_window(272_000, &overrides, "gpt-5.5"), 272_000);
        assert_eq!(effective_official_context_window(1_050_000, &overrides, "gpt-5.6-sol"), 128_000);
        assert_eq!(effective_official_context_window(272_000, &overrides, "unknown"), 272_000);
    }

    #[test]
    fn token_usage_database_migrates_account_columns() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE token_usage_entries (
                    id TEXT PRIMARY KEY,
                    ts INTEGER NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    duration_ms INTEGER,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    reasoning_tokens INTEGER,
                    cached_tokens INTEGER,
                    total_tokens INTEGER,
                    created_at_ms INTEGER NOT NULL
                );
                "#,
            )
            .unwrap();

        init_token_usage_schema(&connection).unwrap();

        let columns = token_usage_table_columns(&connection).unwrap();
        assert!(columns.contains("provider_id"));
        assert!(columns.contains("account_id"));
        assert!(columns.contains("account_email"));
    }

    #[test]
    fn responses_request_converts_to_chat_messages() {
        let body = json!({
            "model": "deepseek-chat",
            "instructions": "Be brief",
            "input": [{ "role": "user", "content": [{ "type": "input_text", "text": "Hi" }] }],
            "stream": true
        });
        let chat = responses_to_chat_completions(&body);
        assert_eq!(chat["model"], "deepseek-chat");
        assert_eq!(chat["messages"][0]["role"], "system");
        assert_eq!(chat["messages"][1]["content"], "Hi");
        assert_eq!(chat["stream_options"]["include_usage"], true);
    }

    #[test]
    fn responses_request_converts_image_input_to_chat_content() {
        let body = json!({
            "model": "vision-model",
            "input": [{
                "role": "user",
                "content": [
                    { "type": "input_text", "text": "Describe this image" },
                    {
                        "type": "input_image",
                        "image_url": "data:image/png;base64,AA==",
                        "detail": "high"
                    }
                ]
            }]
        });

        let chat = responses_to_chat_completions(&body);

        assert_eq!(chat["messages"][0]["content"][0]["type"], "text");
        assert_eq!(chat["messages"][0]["content"][1]["type"], "image_url");
        assert_eq!(
            chat["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,AA=="
        );
        assert_eq!(
            chat["messages"][0]["content"][1]["image_url"]["detail"],
            "high"
        );
    }

    #[test]
    fn deepseek_reasoning_preserves_all_codex_effort_levels() {
        for effort in ["low", "medium", "high", "xhigh", "max"] {
            let responses = json!({ "reasoning": { "effort": effort } });
            let mut chat = json!({});

            apply_deepseek_reasoning(&responses, &mut chat);

            assert_eq!(chat["reasoning_effort"], effort);
            assert_eq!(chat["thinking"]["type"], "enabled");
        }
    }

    #[test]
    fn deepseek_none_disables_thinking_without_effort() {
        let responses = json!({ "reasoning": { "effort": "none" } });
        let mut chat = json!({});

        apply_deepseek_reasoning(&responses, &mut chat);

        assert_eq!(chat["thinking"]["type"], "disabled");
        assert!(chat.get("reasoning_effort").is_none());
    }

    #[test]
    fn provider_image_generation_request_preserves_gpt_image_model() {
        let provider = ProviderProfile {
            id: "images".to_string(),
            kind: ProviderKind::Custom,
            name: "Images".to_string(),
            group: String::new(),
            base_url: "https://images.example.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "provider-text-model".to_string(),
            models: vec!["provider-text-model".to_string()],
            model_reasoning_efforts: Default::default(),
            model_context_windows: Default::default(),
            model_api_formats: Default::default(),
            image_input_models: Vec::new(),
            image_input_models_configured: false,
            context_window: None,
            model_selection_controlled_by_codex: false,
            fast_mode_enabled: false,
            api_format: ProviderApiFormat::OpenaiResponses,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        };
        let body = serde_json::to_vec(&json!({
            "model": "gpt-image-2",
            "prompt": "a fox reading code"
        }))
        .unwrap();

        let forwarded =
            provider_body_for_upstream(&Method::Post, "/v1/images/generations", body, &provider);
        let forwarded: Value = serde_json::from_slice(&forwarded).unwrap();

        assert_eq!(forwarded["model"], "gpt-image-2");
        assert_eq!(forwarded["prompt"], "a fox reading code");
    }

    #[test]
    fn selected_image_output_model_overrides_json_requests() {
        let body = serde_json::to_vec(&json!({
            "model": "gpt-image-2",
            "prompt": "a fox reading code"
        }))
        .unwrap();

        let forwarded = body_with_selected_image_model(body, "provider-image", None);
        let forwarded: Value = serde_json::from_slice(&forwarded).unwrap();

        assert_eq!(forwarded["model"], "provider-image");
    }

    #[test]
    fn selected_image_output_model_overrides_multipart_edits() {
        let boundary = "codex-switch-boundary";
        let body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nold-model\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"a.png\"\r\n\r\nPNG\r\n\
             --{boundary}--\r\n"
        )
        .into_bytes();

        let forwarded = body_with_selected_image_model(
            body,
            "provider-image",
            Some(&format!("multipart/form-data; boundary={boundary}")),
        );
        let forwarded = String::from_utf8(forwarded).unwrap();

        assert!(forwarded.contains("name=\"model\"\r\n\r\nprovider-image\r\n"));
        assert!(forwarded.contains("filename=\"a.png\"\r\n\r\nPNG\r\n"));
    }
