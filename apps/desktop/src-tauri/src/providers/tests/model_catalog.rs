    #[test]
    fn model_api_formats_are_limited_to_available_models() {
        let configured = [
            (" gpt-5.6-sol ".to_string(), ProviderApiFormat::OpenaiChat),
            ("missing".to_string(), ProviderApiFormat::OpenaiResponses),
        ]
        .into();

        let normalized = normalize_model_api_formats(&["gpt-5.6-sol".to_string()], configured);

        assert_eq!(
            normalized.get("gpt-5.6-sol"),
            Some(&ProviderApiFormat::OpenaiChat)
        );
        assert!(!normalized.contains_key("missing"));
    }

    #[test]
    fn switch_control_inherits_the_selected_gpt_model_reasoning_levels() {
        let mut provider = provider();
        provider.model = "GPT-5.6-SOL".to_string();
        provider
            .model_context_windows
            .insert(provider.model.clone(), 400_000);
        let model_context_windows = codex_model_context_windows(&provider);
        let catalog = model_catalog_for_models(
            &[CODEX_SWITCH_CONTROL_MODEL.to_string()],
            ModelCatalogOptions {
                image_input_models: &[],
                reasoning_efforts: &ModelReasoningEfforts::new(),
                context_windows: &model_context_windows,
                default_context_window: provider_context_window(&provider),
                reasoning_profile: reasoning_effort_profile(&provider),
                fast_mode_enabled: false,
            },
        );
        let efforts = catalog["models"][0]["supported_reasoning_levels"]
            .as_array()
            .unwrap()
            .iter()
            .map(|level| level["effort"].as_str().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(
            efforts,
            vec!["low", "medium", "high", "xhigh", "max", "ultra"]
        );
        assert_eq!(catalog["models"][0]["context_window"], 400_000);
    }

    #[test]
    fn provider_model_catalog_contains_codex_visible_models() {
        let mut provider = provider();
        provider.models = vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()];
        provider.image_input_models = vec!["deepseek-reasoner".to_string()];
        provider.context_window = Some(256_000);
        provider
            .model_context_windows
            .insert("deepseek-reasoner".to_string(), 400_000);
        provider.model_selection_controlled_by_codex = true;
        let catalog = model_catalog_for_models(
            &provider.models,
            ModelCatalogOptions {
                image_input_models: &provider.image_input_models,
                reasoning_efforts: &ModelReasoningEfforts::new(),
                context_windows: &provider.model_context_windows,
                default_context_window: provider_context_window(&provider),
                reasoning_profile: ReasoningEffortProfile::DeepSeek,
                fast_mode_enabled: false,
            },
        );
        let models = catalog["models"].as_array().unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["slug"], "deepseek-chat");
        assert_eq!(models[0]["display_name"], "deepseek-chat");
        assert!(models[0]["base_instructions"]
            .as_str()
            .unwrap()
            .contains("You are Codex"));
        assert!(models[0].get("default_verbosity").is_some());
        assert!(models[0].get("apply_patch_tool_type").is_some());
        assert_eq!(models[0]["use_responses_lite"], false);
        assert!(models[0].get("tool_mode").is_some());
        assert!(models[0].get("multi_agent_version").is_some());
        assert_eq!(
            models[0]["context_window"],
            DEFAULT_DEEPSEEK_MODEL_CONTEXT_WINDOW
        );
        assert_eq!(
            models[0]["max_context_window"],
            DEFAULT_DEEPSEEK_MODEL_CONTEXT_WINDOW
        );
        assert_eq!(models[1]["context_window"], 400_000);
        assert_eq!(models[1]["max_context_window"], 400_000);
        assert_eq!(models[0]["input_modalities"], json!(["text"]));
        assert_eq!(models[1]["input_modalities"], json!(["text", "image"]));
        assert_eq!(
            models[0]["supported_reasoning_levels"]
                .as_array()
                .unwrap()
                .iter()
                .map(|level| level["effort"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["none", "low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(models[1]["slug"], "deepseek-reasoner");
    }

    #[test]
    fn switch_control_defaults_deepseek_context_window() {
        let mut provider = provider();
        provider.model = "deepseek-chat".to_string();
        provider.models = vec![provider.model.clone()];
        provider.model_selection_controlled_by_codex = false;

        let context_windows = codex_model_context_windows(&provider);
        assert_eq!(
            context_windows.get(CODEX_SWITCH_CONTROL_MODEL),
            Some(&DEFAULT_DEEPSEEK_MODEL_CONTEXT_WINDOW)
        );
    }

    #[test]
    fn switch_control_uses_the_active_models_image_capability() {
        let mut provider = provider();
        provider.image_input_models = vec![provider.model.clone()];

        assert_eq!(
            codex_image_input_models(&provider),
            vec![CODEX_SWITCH_CONTROL_MODEL.to_string()]
        );

        provider.image_input_models.clear();
        assert!(codex_image_input_models(&provider).is_empty());
    }

    #[test]
    fn image_input_route_marks_all_visible_models_as_image_capable() {
        let mut provider = provider();
        provider.models = vec!["text-model".to_string(), "vision-model".to_string()];
        provider.model = "text-model".to_string();
        provider.image_input_models = vec!["vision-model".to_string()];
        provider.model_selection_controlled_by_codex = true;

        let catalog = model_catalog_for_provider_with_image_route(&provider, true);
        let models = catalog["models"].as_array().unwrap();

        assert_eq!(models[0]["input_modalities"], json!(["text", "image"]));
        assert_eq!(models[1]["input_modalities"], json!(["text", "image"]));
    }

    #[test]
    fn provider_refresh_request_applies_image_route_before_switch_returns() {
        let paths = test_paths();
        let state = crate::models::ManagerStateFile {
            image_input_target: Some(ImageModelTarget::Official {
                account_id: "image-account".to_string(),
            }),
            ..Default::default()
        };
        write_state(&paths, &state).unwrap();
        let mut provider = provider();
        provider.models = vec!["text-model".to_string(), "vision-model".to_string()];
        provider.model_selection_controlled_by_codex = true;

        let request = provider_model_refresh_request(&paths, &provider);

        assert_eq!(request.models, request.image_input_models);
    }

    #[test]
    fn provider_context_window_defaults_and_rejects_zero() {
        let provider = provider();
        assert_eq!(
            provider_context_window(&provider),
            DEFAULT_MODEL_CONTEXT_WINDOW
        );

        let mut invalid = provider;
        invalid.context_window = Some(0);
        assert_eq!(
            normalize_provider_profile(invalid).unwrap_err(),
            "Context window must be greater than zero"
        );
    }

    #[test]
    fn provider_base_url_rejects_local_proxy_endpoint() {
        assert!(normalize_base_url("http://127.0.0.1:15722/v1")
            .unwrap_err()
            .contains("local proxy"));
        assert!(normalize_base_url("http://localhost:15722/v1")
            .unwrap_err()
            .contains("local proxy"));
        assert!(normalize_base_url("https://api.deepseek.com/v1").is_ok());
    }

    #[test]
    fn provider_usage_url_follows_the_configured_proxy_base_path() {
        assert_eq!(
            provider_usage_url("https://switch.example.com/v1")
                .unwrap()
                .as_str(),
            "https://switch.example.com/v1/usage"
        );
        assert_eq!(
            provider_usage_url("https://switch.example.com/codex/v1/?ignored=true")
                .unwrap()
                .as_str(),
            "https://switch.example.com/codex/v1/usage"
        );
    }

    #[test]
    fn official_local_proxy_uses_the_default_official_model_after_provider() {
        let paths = test_paths();
        let backup = r#"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
"#;
        let provider_options = LocalProxyConfigOptions {
            name: "DeepSeek",
            model: Some("deepseek-v4-flash"),
            include_model_catalog: true,
            requires_openai_auth: false,
            token_command: "csw",
        };
        let provider_proxy = merge_local_proxy_config(backup, &provider_options).unwrap();
        write_text_atomic(&paths.config_backup, backup).unwrap();
        write_text_atomic(&paths.current_config, &provider_proxy).unwrap();

        write_official_local_proxy_config(&paths).unwrap();

        let official_proxy = fs::read_to_string(&paths.current_config).unwrap();
        let first_model = codex_config::root_model(&official_proxy).unwrap();

        assert_eq!(first_model, DEFAULT_OFFICIAL_MODEL);
        assert!(!official_proxy.contains("deepseek-v4-flash"));
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn restoring_default_official_config_replaces_the_backed_up_model() {
        let paths = test_paths();
        let backup = "model = \"gpt-5.5\"\n";
        let provider_options = LocalProxyConfigOptions {
            name: "DeepSeek",
            model: Some("deepseek-v4-flash"),
            include_model_catalog: true,
            requires_openai_auth: false,
            token_command: "csw",
        };
        let provider_proxy = merge_local_proxy_config(backup, &provider_options).unwrap();
        write_text_atomic(&paths.config_backup, backup).unwrap();
        write_text_atomic(&paths.current_config, &provider_proxy).unwrap();

        restore_default_official_config(&paths).unwrap();

        let restored = fs::read_to_string(&paths.current_config).unwrap();
        assert_eq!(
            codex_config::root_model(&restored).as_deref(),
            Some(DEFAULT_OFFICIAL_MODEL)
        );
        assert!(!paths.config_backup.exists());
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }
