    #[test]
    fn saved_api_key_is_not_reused_for_a_different_endpoint() {
        let existing = provider();

        assert_eq!(
            retained_api_key(Some(&existing), &existing.base_url, None),
            existing.api_key
        );
        assert!(retained_api_key(Some(&existing), "https://other.example/v1", None).is_empty());
        assert_eq!(
            retained_api_key(
                Some(&existing),
                "https://other.example/v1",
                Some(" new-key ")
            ),
            "new-key"
        );
    }

    #[test]
    fn local_preset_sync_and_activation_policy_accepts_empty_keys() {
        for (name, base_url) in [
            ("Ollama", "http://localhost:11434/v1"),
            ("LM Studio", "http://localhost:1234/v1"),
        ] {
            let mut local = provider();
            local.name = name.to_string();
            local.base_url = base_url.to_string();
            local.api_key.clear();

            assert!(crate::preset_provider::allows_missing_api_key(&local));
            assert!(normalize_synced_provider(local).is_ok());
        }
    }

    #[test]
    fn preset_endpoints_models_and_api_formats_match_service_contracts() {
        use crate::preset_provider::{inspect_preset_for_test, PresetProviderId};

        let coding = inspect_preset_for_test(
            PresetProviderId::Bailian,
            "https://coding.dashscope.aliyuncs.com/v1",
            None,
        )
        .unwrap();
        assert_eq!(coding.0, ProviderApiFormat::OpenaiChat);
        assert!(coding.2.contains(&"glm-5".to_string()));

        let payg = inspect_preset_for_test(
            PresetProviderId::Bailian,
            "https://llm-abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
            None,
        )
        .unwrap();
        assert_eq!(payg.0, ProviderApiFormat::OpenaiResponses);
        assert_eq!(payg.2[0], "qwen3.7-max");
        assert!(inspect_preset_for_test(
            PresetProviderId::Bailian,
            "https://evil.example/compatible-mode/v1",
            None,
        )
        .is_err());

        let ollama =
            inspect_preset_for_test(PresetProviderId::Ollama, "http://[::1]:11434/v1", None)
                .unwrap();
        assert!(ollama.1.ends_with("/v1/models"));
        let payload = json!({"models": [
            {"key": "plain", "type": "llm", "trained_for_tool_use": false},
            {"key": "embed", "type": "embedding"},
            {"key": "tools", "type": "llm", "trained_for_tool_use": true}
        ]});
        let studio = inspect_preset_for_test(
            PresetProviderId::LmStudio,
            "http://localhost:1234/v1",
            Some(&payload),
        )
        .unwrap();
        assert!(studio.1.ends_with("/api/v1/models"));
        assert_eq!(studio.2, vec!["tools", "plain"]);
    }

    #[test]
    fn remote_preset_contracts_match_catalog_and_filter_unusable_models() {
        use crate::preset_provider::{inspect_preset_for_test, PresetProviderId};

        for endpoint in [
            "https://ark.cn-beijing.volces.com/api/plan/v3",
            "https://ark.cn-beijing.volces.com/api/coding/v3",
        ] {
            let volcengine =
                inspect_preset_for_test(PresetProviderId::Volcengine, endpoint, None).unwrap();
            assert_eq!(volcengine.0, ProviderApiFormat::OpenaiResponses);
            assert!(volcengine.1.ends_with("/models"));
        }

        let glm =
            inspect_preset_for_test(PresetProviderId::Glm, "https://api.z.ai/api/paas/v4", None)
                .unwrap();
        assert_eq!(glm.0, ProviderApiFormat::OpenaiChat);

        let minimax =
            inspect_preset_for_test(PresetProviderId::MiniMax, "https://api.minimax.io/v1", None)
                .unwrap();
        assert_eq!(minimax.0, ProviderApiFormat::OpenaiChat);
        let minimax_payload = json!({"data": [
            {"id": "MiniMax-M2.7"},
            {"id": "speech-2.8-hd"}
        ]});
        let minimax = inspect_preset_for_test(
            PresetProviderId::MiniMax,
            "https://api.minimax.io/v1",
            Some(&minimax_payload),
        )
        .unwrap();
        assert_eq!(minimax.2, vec!["MiniMax-M2.7"]);

        let payload = json!({"data": [
            {"id": "tool-chat", "archived": false, "capabilities": {
                "completion_chat": true, "function_calling": true
            }},
            {"id": "no-tools", "archived": false, "capabilities": {
                "completion_chat": true, "function_calling": false
            }},
            {"id": "archived", "archived": true, "capabilities": {
                "completion_chat": true, "function_calling": true
            }}
        ]});
        let mistral = inspect_preset_for_test(
            PresetProviderId::Mistral,
            "https://api.mistral.ai/v1",
            Some(&payload),
        )
        .unwrap();
        assert_eq!(mistral.2, vec!["tool-chat"]);
    }

    #[test]
    fn saved_optional_token_is_reused_only_for_the_same_local_preset_endpoint() {
        use crate::preset_provider::{reusable_api_key_for_test, PresetProviderId};

        let mut studio = provider();
        studio.name = "LM Studio".to_string();
        studio.base_url = "http://localhost:1234/v1".to_string();
        studio.api_key = "lm-secret".to_string();
        assert_eq!(
            reusable_api_key_for_test(
                &studio,
                PresetProviderId::LmStudio,
                "http://localhost:1234/v1/",
            ),
            Some("lm-secret".to_string())
        );
        assert!(reusable_api_key_for_test(
            &studio,
            PresetProviderId::LmStudio,
            "http://localhost:4321/v1",
        )
        .is_none());
        assert!(reusable_api_key_for_test(
            &studio,
            PresetProviderId::Ollama,
            "http://localhost:1234/v1",
        )
        .is_none());
    }

    #[test]
    fn synced_custom_provider_still_requires_api_key() {
        let mut provider = provider();
        provider.api_key.clear();

        let error = normalize_synced_provider(provider).unwrap_err();

        assert_eq!(error, "Provider API key is empty");
    }

    #[test]
    fn normalize_openai_provider_enforces_official_behavior() {
        let mut provider = provider();
        provider.kind = ProviderKind::OpenAi;
        provider.model.clear();
        provider.models.clear();
        provider.model_selection_controlled_by_codex = false;
        provider.api_format = ProviderApiFormat::OpenaiChat;

        let profile = normalize_provider_profile(provider).unwrap();

        assert_eq!(profile.model, DEFAULT_OFFICIAL_MODEL);
        assert_eq!(profile.models, vec![DEFAULT_OFFICIAL_MODEL]);
        assert!(profile.model_selection_controlled_by_codex);
        assert_eq!(profile.api_format, ProviderApiFormat::OpenaiResponses);
    }

    #[test]
    fn normalize_provider_profile_keeps_legacy_model_as_model_list() {
        let profile = normalize_provider_profile(ProviderProfile {
            id: "p".to_string(),
            kind: ProviderKind::Custom,
            name: "Gateway".to_string(),
            group: String::new(),
            base_url: "https://gateway.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4.1".to_string(),
            models: Vec::new(),
            model_reasoning_efforts: ModelReasoningEfforts::new(),
            model_context_windows: ModelContextWindows::new(),
            model_api_formats: ModelApiFormats::new(),
            image_input_models: vec!["missing-model".to_string()],
            image_input_models_configured: true,
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
        })
        .unwrap();

        assert_eq!(profile.model, "gpt-4.1");
        assert_eq!(profile.models, vec!["gpt-4.1"]);
        assert!(profile.image_input_models.is_empty());
    }

    #[test]
    fn normalize_deepseek_preset_keeps_model_control_setting() {
        let mut profile = provider();
        profile.name = "DeepSeek".to_string();
        profile.base_url = "https://api.deepseek.com".to_string();
        profile.model = "deepseek-v4-pro".to_string();
        profile.models = vec!["deepseek-v4-pro".to_string()];
        profile.api_format = ProviderApiFormat::OpenaiResponses;
        profile.model_selection_controlled_by_codex = false;
        profile.balance_platform = Some(ProviderBalancePlatform::DeepSeek);
        profile.balance_query_url = Some("https://api.deepseek.com/user/balance".to_string());

        let profile = normalize_provider_profile(profile).unwrap();

        assert_eq!(profile.api_format, ProviderApiFormat::OpenaiChat);
        assert!(!profile.model_selection_controlled_by_codex);
    }

    #[test]
    fn normalize_deepseek_preset_rejects_non_official_upstream() {
        let mut profile = provider();
        profile.balance_platform = Some(ProviderBalancePlatform::DeepSeek);
        profile.balance_query_url = Some("https://api.deepseek.com/user/balance".to_string());

        assert!(normalize_provider_profile(profile).is_err());
    }

    #[test]
    fn normalize_model_selection_trims_and_deduplicates_models() {
        let (model, models) = normalize_model_selection(
            " deepseek-chat ",
            vec![
                "deepseek-chat".to_string(),
                " deepseek-reasoner ".to_string(),
                String::new(),
                "deepseek-chat".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(model, "deepseek-chat");
        assert_eq!(models, vec!["deepseek-chat", "deepseek-reasoner"]);
    }

    #[test]
    fn gpt_reasoning_profiles_match_official_model_families_case_insensitively() {
        assert_eq!(
            reasoning_effort_profile_for_model("GPT-5.4", ReasoningEffortProfile::Standard),
            ReasoningEffortProfile::OpenAi
        );
        assert_eq!(
            reasoning_effort_profile_for_model("gpt-5.6-luna", ReasoningEffortProfile::Standard),
            ReasoningEffortProfile::OpenAiMax
        );
        assert_eq!(
            reasoning_effort_profile_for_model("GPT-5.6-SOL", ReasoningEffortProfile::Standard),
            ReasoningEffortProfile::OpenAiUltra
        );
        assert_eq!(
            reasoning_effort_profile_for_model("claude-sonnet", ReasoningEffortProfile::Standard),
            ReasoningEffortProfile::Standard
        );
        assert_eq!(
            reasoning_effort_profile_for_model("gpt-5.6-sol", ReasoningEffortProfile::DeepSeek),
            ReasoningEffortProfile::DeepSeek
        );
    }

    #[test]
    fn provider_model_catalog_uses_model_specific_reasoning_levels() {
        let models = vec![
            "gpt-5.6-sol".to_string(),
            "GPT-5.6-LUNA".to_string(),
            "gpt-5.4".to_string(),
            "claude-sonnet".to_string(),
        ];
        let catalog = model_catalog_for_models(
            &models,
            ModelCatalogOptions {
                image_input_models: &[],
                reasoning_efforts: &ModelReasoningEfforts::new(),
                context_windows: &ModelContextWindows::new(),
                default_context_window: DEFAULT_MODEL_CONTEXT_WINDOW,
                reasoning_profile: ReasoningEffortProfile::Standard,
                fast_mode_enabled: false,
            },
        );
        let entries = catalog["models"].as_array().unwrap();
        let efforts = |index: usize| {
            entries[index]["supported_reasoning_levels"]
                .as_array()
                .unwrap()
                .iter()
                .map(|level| level["effort"].as_str().unwrap())
                .collect::<Vec<_>>()
        };

        assert_eq!(
            efforts(0),
            vec!["low", "medium", "high", "xhigh", "max", "ultra"]
        );
        assert_eq!(efforts(1), vec!["low", "medium", "high", "xhigh", "max"]);
        assert_eq!(efforts(2), vec!["low", "medium", "high", "xhigh"]);
        assert_eq!(efforts(3), vec!["none", "high"]);
    }

    #[test]
    fn configured_reasoning_levels_override_defaults_and_are_normalized() {
        let configured = [
            (
                " gpt-5.6-sol ".to_string(),
                vec![
                    ReasoningEffort::Low,
                    ReasoningEffort::High,
                    ReasoningEffort::High,
                ],
            ),
            ("missing".to_string(), vec![ReasoningEffort::Ultra]),
        ]
        .into();
        let normalized =
            normalize_model_reasoning_efforts(&["gpt-5.6-sol".to_string()], configured);
        let catalog = model_catalog_for_models(
            &["gpt-5.6-sol".to_string()],
            ModelCatalogOptions {
                image_input_models: &[],
                reasoning_efforts: &normalized,
                context_windows: &ModelContextWindows::new(),
                default_context_window: DEFAULT_MODEL_CONTEXT_WINDOW,
                reasoning_profile: ReasoningEffortProfile::Standard,
                fast_mode_enabled: false,
            },
        );
        let efforts = catalog["models"][0]["supported_reasoning_levels"]
            .as_array()
            .unwrap()
            .iter()
            .map(|level| level["effort"].as_str().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(efforts, vec!["low", "high"]);
        assert!(!normalized.contains_key("missing"));
    }
