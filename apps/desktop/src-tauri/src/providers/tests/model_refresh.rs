    #[test]
    fn upstream_refresh_uses_live_catalog_instead_of_saved_default_model() {
        let mut upstream = provider();
        upstream.kind = ProviderKind::OpenAi;
        upstream.model.clear();
        upstream.models.clear();
        let upstream = normalize_provider_profile(upstream).unwrap();
        assert_eq!(upstream.model, "gpt-6-astra");
        assert_eq!(upstream.models, vec!["gpt-6-astra"]);

        let crate::codex_runtime::ModelRefreshSource::Upstream { selected_model } =
            provider_model_refresh_request(&test_paths(), &upstream)
        else {
            panic!("Upstream Providers must load their live model catalog");
        };

        assert_eq!(selected_model, "gpt-6-astra");
    }

    #[test]
    fn custom_refresh_preserves_configured_models_and_selection_control() {
        let mut custom = provider();
        custom.models = vec!["gpt-5.6-sol".to_string(), "gpt-5.6-terra".to_string()];
        custom.model = custom.models[1].clone();
        custom.model_selection_controlled_by_codex = true;
        let crate::codex_runtime::ModelRefreshSource::Configured(request) =
            provider_model_refresh_request(&test_paths(), &custom)
        else {
            panic!("Custom Providers must keep their configured model catalog");
        };
        assert_eq!(request.models, custom.models);

        custom.model_selection_controlled_by_codex = false;
        let crate::codex_runtime::ModelRefreshSource::Configured(request) =
            provider_model_refresh_request(&test_paths(), &custom)
        else {
            panic!("Switch-controlled Providers must keep their configured model catalog");
        };
        assert_eq!(request.models, vec![CODEX_SWITCH_CONTROL_MODEL]);
    }
