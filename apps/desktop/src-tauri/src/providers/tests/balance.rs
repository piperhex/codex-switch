    #[test]
    fn provider_group_catalog_normalizes_and_deduplicates_names() {
        let groups = normalize_provider_groups(vec![
            " Work ".to_string(),
            "Personal".to_string(),
            "Work".to_string(),
        ])
        .expect("valid group names should normalize");
        assert_eq!(groups, vec!["Work", "Personal"]);
    }

    #[test]
    fn provider_group_catalog_rejects_empty_names() {
        assert!(normalize_provider_groups(vec!["  ".to_string()]).is_err());
    }

    #[test]
    fn provider_group_catalog_uses_api_and_model_names() {
        let mut first = provider();
        first.name = "API One".to_string();
        first.group = "Work".to_string();
        first.model_selection_controlled_by_codex = true;
        first.models = vec!["model-a".to_string(), "model-b".to_string()];
        first.model = "model-a".to_string();
        let mut second = provider();
        second.id = "p2".to_string();
        second.name = "API Two".to_string();
        second.group = "Work".to_string();
        second.model = "model-c".to_string();
        second.models = vec!["model-c".to_string()];

        let catalog = model_catalog_for_provider_group(&[first.clone(), second.clone()]);
        let slugs = catalog["models"]
            .as_array()
            .expect("group catalog should contain models")
            .iter()
            .filter_map(|entry| entry["slug"].as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            slugs,
            vec!["API One-model-a", "API One-model-b", "API Two-model-c"]
        );
        let selected =
            provider_for_group_model(&[first.clone(), second.clone()], Some("API Two-model-c"))
                .expect("group model should resolve to its API");
        assert_eq!(selected.id, "p2");
        assert_eq!(selected.model, "model-c");
        assert!(!selected.model_selection_controlled_by_codex);
        assert!(provider_for_group_model(&[provider()], Some("unknown-model")).is_err());

        second.name = first.name.clone();
        second.model = "model-a".to_string();
        second.models = vec!["model-a".to_string()];
        assert!(validate_provider_group_models(&[first, second]).is_err());
    }

    #[test]
    fn parses_new_api_remaining_quota_as_usd() {
        let balance = parse_provider_api_balance(
            ProviderBalancePlatform::NewApi,
            &json!({
                "data": {
                    "total_available": 54_040_000,
                    "unlimited_quota": false
                }
            }),
        )
        .unwrap();
        assert_eq!(balance.amount, Some(108.08));
        assert_eq!(balance.unit, "USD");
        assert!(!balance.unlimited);
    }

    #[test]
    fn parses_sub2api_remaining_balance() {
        let balance = parse_provider_api_balance(
            ProviderBalancePlatform::Sub2Api,
            &json!({
                "mode": "quota_limited",
                "remaining": 12.5,
                "unit": "USD"
            }),
        )
        .unwrap();
        assert_eq!(balance.amount, Some(12.5));
        assert_eq!(balance.unit, "USD");
        assert!(!balance.unlimited);
    }

    #[test]
    fn parses_deepseek_multi_currency_balance() {
        let balance = parse_provider_api_balance(
            ProviderBalancePlatform::DeepSeek,
            &json!({
                "is_available": true,
                "balance_infos": [
                    { "currency": "CNY", "total_balance": "88.80" },
                    { "currency": "USD", "total_balance": "12.50" }
                ]
            }),
        )
        .unwrap();

        assert_eq!(balance.amount, Some(88.8));
        assert_eq!(balance.unit, "CNY");
        assert!(!balance.unlimited);
        assert_eq!(balance.balance_items.len(), 2);
        assert_eq!(balance.balance_items[1].unit, "USD");
        assert_eq!(balance.balance_items[1].amount, 12.5);
    }

    #[test]
    fn parses_and_deduplicates_deepseek_models() {
        let models = parse_deepseek_models(&json!({
            "object": "list",
            "data": [
                { "id": "deepseek-v4-flash", "object": "model" },
                { "id": "deepseek-v4-pro", "object": "model" },
                { "id": "deepseek-v4-flash", "object": "model" }
            ]
        }))
        .unwrap();

        assert_eq!(models, vec!["deepseek-v4-flash", "deepseek-v4-pro"]);
    }

    #[test]
    fn deepseek_endpoints_strip_optional_v1_prefix() {
        assert_eq!(
            deepseek_endpoint_url("https://api.deepseek.com/v1", "/models")
                .unwrap()
                .as_str(),
            "https://api.deepseek.com/models"
        );
        assert_eq!(
            deepseek_endpoint_url("https://api.deepseek.com", "/models")
                .unwrap()
                .as_str(),
            "https://api.deepseek.com/models"
        );
        assert!(deepseek_endpoint_url("https://example.com", "/models").is_err());
        assert!(deepseek_endpoint_url("https://api.deepseek.com:444", "/models").is_err());
        assert!(deepseek_endpoint_url("https://api.deepseek.com/custom", "/models").is_err());
    }

    #[test]
    fn parses_sub2api_unrestricted_key_as_api_unlimited_and_wallet_balance() {
        let balance = parse_provider_api_balance(
            ProviderBalancePlatform::Sub2Api,
            &json!({
                "mode": "unrestricted",
                "remaining": 21.75,
                "balance": 21.75,
                "unit": "USD"
            }),
        )
        .unwrap();
        assert_eq!(balance.amount, None);
        assert!(balance.unlimited);
        assert_eq!(balance.embedded_wallet_amount, Some(21.75));
        assert_eq!(balance.embedded_wallet_unit, "USD");
    }

    #[test]
    fn parses_new_api_wallet_quota_as_usd() {
        let (amount, unit) = parse_provider_wallet_balance(
            ProviderBalancePlatform::NewApi,
            &json!({ "data": { "quota": 6_250_000 } }),
        )
        .unwrap();
        assert_eq!(amount, 12.5);
        assert_eq!(unit, "USD");
    }

    #[test]
    fn parses_current_new_api_login_bundle() {
        let auth = parse_new_api_login_auth(&json!({
            "success": true,
            "data": {
                "access_token": "login-token",
                "user": { "id": 42 }
            }
        }))
        .unwrap();

        assert_eq!(auth.access_token.as_deref(), Some("login-token"));
        assert_eq!(auth.user_id, "42");
    }

    #[test]
    fn parses_legacy_new_api_login_user() {
        let auth = parse_new_api_login_auth(&json!({
            "success": true,
            "data": {
                "id": 7,
                "access_token": "legacy-token"
            }
        }))
        .unwrap();

        assert_eq!(auth.access_token.as_deref(), Some("legacy-token"));
        assert_eq!(auth.user_id, "7");
    }

    #[test]
    fn new_api_wallet_login_falls_back_to_session_cookie() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let wallet_url = format!("http://{}/api/user/self", server.server_addr());
        let worker = std::thread::spawn(move || {
            let login = server.recv().unwrap();
            assert_eq!(login.url(), "/api/user/login");
            login
                .respond(
                    Response::from_string(r#"{"success":true,"data":{"id":42}}"#)
                        .with_header(
                            Header::from_bytes(
                                "Set-Cookie",
                                "session=test-session; Path=/; HttpOnly",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            Header::from_bytes("Content-Type", "application/json").unwrap(),
                        ),
                )
                .unwrap();

            let wallet = server.recv().unwrap();
            assert_eq!(wallet.url(), "/api/user/self");
            assert!(wallet
                .headers()
                .iter()
                .any(|header| header.field.equiv("Cookie")
                    && header.value.as_str().contains("session=test-session")));
            wallet
                .respond(
                    Response::from_string(r#"{"success":true,"data":{"quota":6250000}}"#)
                        .with_header(
                            Header::from_bytes("Content-Type", "application/json").unwrap(),
                        ),
                )
                .unwrap();
        });
        let client = Client::builder().cookie_store(true).build().unwrap();

        let (amount, unit) =
            query_new_api_wallet_with_login(&client, &wallet_url, "user", "password", None)
                .unwrap();

        assert_eq!(amount, 12.5);
        assert_eq!(unit, "USD");
        worker.join().unwrap();
    }

    #[test]
    fn new_api_wallet_login_supplies_user_id_to_saved_token() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let wallet_url = format!("http://{}/api/user/self", server.server_addr());
        let worker = std::thread::spawn(move || {
            let login = server.recv().unwrap();
            assert_eq!(login.url(), "/api/user/login");
            login
                .respond(
                    Response::from_string(r#"{"success":true,"data":{"id":42}}"#).with_header(
                        Header::from_bytes("Content-Type", "application/json").unwrap(),
                    ),
                )
                .unwrap();

            let wallet = server.recv().unwrap();
            assert_eq!(wallet.url(), "/api/user/self");
            assert!(wallet.headers().iter().any(|header| {
                header.field.equiv("Authorization")
                    && header.value.as_str() == "Bearer saved-wallet-token"
            }));
            assert!(wallet.headers().iter().any(|header| {
                header.field.equiv("New-Api-User") && header.value.as_str() == "42"
            }));
            wallet
                .respond(
                    Response::from_string(r#"{"success":true,"data":{"quota":6250000}}"#)
                        .with_header(
                            Header::from_bytes("Content-Type", "application/json").unwrap(),
                        ),
                )
                .unwrap();
        });
        let client = Client::builder().cookie_store(true).build().unwrap();

        let (amount, unit) = query_new_api_wallet_with_login(
            &client,
            &wallet_url,
            "user",
            "password",
            Some("saved-wallet-token"),
        )
        .unwrap();

        assert_eq!(amount, 12.5);
        assert_eq!(unit, "USD");
        worker.join().unwrap();
    }

    #[test]
    fn parses_sub2api_wallet_balance() {
        let (amount, unit) = parse_provider_wallet_balance(
            ProviderBalancePlatform::Sub2Api,
            &json!({ "code": 0, "data": { "balance": 8.25 } }),
        )
        .unwrap();
        assert_eq!(amount, 8.25);
        assert_eq!(unit, "USD");
    }

    fn test_auth() -> Value {
        let claims = json!({
            "email": "first@example.com",
            "sub": "first-user",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "first-account"
            }
        });
        let token = format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
        );
        json!({
            "auth_mode": "chatgpt",
            "tokens": {
                "id_token": token,
                "access_token": "header.payload.signature",
                "refresh_token": "refresh-token",
                "account_id": "first-account"
            }
        })
    }

    fn test_agent_identity_auth() -> Value {
        json!({
            "auth_mode": "agentIdentity",
            "agent_identity": {
                "agent_runtime_id": "agent-runtime",
                "agent_private_key": base64::engine::general_purpose::STANDARD.encode([8_u8; 48]),
                "account_id": "agent-workspace",
                "chatgpt_user_id": "agent-user",
                "email": "agent@example.com"
            }
        })
    }

    fn test_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-provider-test-{}",
            uuid::Uuid::new_v4()
        ));
        let codex_home = root.join("codex-home");
        let app_data = root.join("app-data");
        Paths {
            current_auth: codex_home.join("auth.json"),
            current_config: codex_home.join("config.toml"),
            codex_home,
            accounts: app_data.join("accounts"),
            providers: app_data.join("providers"),
            config_backup: app_data.join("config-before-provider.toml"),
            state_file: app_data.join("state.json"),
        }
    }
