    use super::*;

    #[test]
    fn validates_theme_ids() {
        assert!(valid_theme_id("preset-rose-reverie"));
        assert!(valid_theme_id("20260719-120000-deadbeef"));
        assert!(!valid_theme_id("../escape"));
        assert!(!valid_theme_id(""));
    }

    #[test]
    fn only_saved_theme_ids_can_be_deleted() {
        assert!(validate_deletable_theme_id("community-theme").is_ok());
        assert!(validate_deletable_theme_id("../escape").is_err());
        assert!(validate_deletable_theme_id("preset-rose-reverie").is_err());
    }

    #[test]
    fn native_marker_identifies_rust_runtime() {
        let marker = InstallationMarker {
            schema_version: 1,
            runtime: "rust-native".to_string(),
            version: NATIVE_RUNTIME_VERSION.to_string(),
        };
        let value = serde_json::to_value(marker).unwrap();
        assert_eq!(value["runtime"], "rust-native");
    }

    #[test]
    fn bundled_css_collapses_the_codex_26_721_home_banner_wrapper() {
        let windows_css = include_str!("../../resources/dream-skin/assets/windows/dream-skin.css");
        let macos_css = include_str!("../../resources/dream-skin/assets/macos/dream-skin.css");

        for css in [windows_css, macos_css] {
            assert!(css.contains("div:first-child:has(> .home-banners)"));
            assert!(css.contains("flex: 0 1 auto !important;"));
            assert!(css.contains("min-height: 0 !important;"));
        }
    }

    #[test]
    fn windows_dark_skin_rebinds_native_foregrounds() {
        let css = include_str!("../../resources/dream-skin/assets/windows/dream-skin.css");

        assert!(css.contains("dream-theme-dark main.main-surface"));
        assert!(css.contains("--color-token-text-primary: var(--dream-text);"));
        assert!(css.contains("--color-token-text-tertiary: var(--dream-text-muted);"));
        assert!(css.contains("aside.app-shell-left-panel .sidebar-foreground-muted"));
        assert!(css.contains("[class~=\"group/turn-diff-header\"]"));
        assert!(css.contains("--color-token-dropdown-background: var(--dream-surface-raised);"));
        assert!(css.contains("--color-token-button-tertiary-foreground: var(--dream-text);"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_payload_replaces_all_renderer_placeholders() {
        let template = include_str!("../../resources/dream-skin/assets/macos/renderer-inject.js");
        let payload = render_payload(
            template,
            "html { color: red; }",
            "data:image/png;base64,AA==",
            &json!({ "id": "test-theme" }),
        )
        .unwrap();

        for placeholder in [
            "__DREAM_SKIN_CSS_JSON__",
            "__DREAM_SKIN_ART_JSON__",
            "__DREAM_SKIN_THEME_JSON__",
            "__DREAM_SKIN_VERSION_JSON__",
            "__DREAM_SKIN_STYLE_REVISION_JSON__",
            "__DREAM_SKIN_PAYLOAD_REVISION_JSON__",
        ] {
            assert!(!payload.source.contains(placeholder));
        }
        assert_eq!(payload.revision.len(), 20);
        assert!(payload.source.contains("test-theme"));
    }

    #[test]
    fn cdp_target_rejects_remote_hosts() {
        let target = CdpTarget {
            id: "page-1".to_string(),
            kind: "page".to_string(),
            url: "app://codex/".to_string(),
            web_socket_debugger_url: "ws://example.com:9335/devtools/page/page-1".to_string(),
        };
        assert!(validate_target(&target, 9335).is_err());
    }

    #[test]
    fn cdp_command_deadline_is_absolute() {
        let error = cdp_command_remaining(Instant::now(), "Runtime.enable").unwrap_err();
        assert!(error.contains("CDP command timed out: Runtime.enable"));
        assert!(
            cdp_command_remaining(Instant::now() + Duration::from_secs(1), "Runtime.enable")
                .is_ok()
        );
    }

    #[test]
    fn verification_accepts_one_primary_target_among_auxiliary_targets() {
        let auxiliary = json!({ "result": { "pass": false } });
        let primary = json!({ "result": { "pass": true } });

        assert!(verification_succeeded(&[auxiliary.clone(), primary]));
        assert!(!verification_succeeded(&[auxiliary]));
        assert!(!verification_succeeded(&[]));
    }

    #[test]
    fn codex_probe_rejects_auxiliary_renderer_targets() {
        assert!(codex_probe_succeeded(&json!({ "codex": true })));
        assert!(!codex_probe_succeeded(&json!({ "codex": false })));
        assert!(!codex_probe_succeeded(&json!({})));
    }

    #[test]
    fn codex_model_refresh_only_matches_model_list_queries() {
        assert!(is_codex_model_query_key(&json!([
            "models", "list", "local", "chatgpt", 100
        ])));
        assert!(!is_codex_model_query_key(&json!(["models", "details"])));
        assert!(!is_codex_model_query_key(&json!(["threads", "list"])));
        let expression = codex_model_refresh_expression(
            &["deepseek-chat".to_string(), "deepseek-reasoner".to_string()],
            &[],
            &["deepseek-reasoner".to_string()],
            &Default::default(),
            "deepseek-chat",
            crate::providers::ReasoningEffortProfile::DeepSeek,
        )
        .unwrap();
        assert!(expression.contains("query.queryKey[0] === \"models\""));
        assert!(expression.contains("query.queryKey[1] === \"list\""));
        assert!(expression.contains("query.queryKey[0] === \"user-saved-config\""));
        assert!(expression.contains("no-auth-model-query-created"));
        assert!(expression.contains("models-query-not-found"));
        assert!(expression.contains("deepseek-reasoner"));
        assert!(
            expression.contains("imageInputModels.has(model) ? [\"text\", \"image\"] : [\"text\"]")
        );
        assert!(expression.contains("\"reasoningEffort\":\"low\""));
        assert!(expression.contains("\"reasoningEffort\":\"medium\""));
        assert!(expression.contains("\"reasoningEffort\":\"xhigh\""));
        assert!(expression.contains("\"reasoningEffort\":\"max\""));
    }

    #[test]
    fn codex_model_refresh_uses_model_specific_reasoning_efforts() {
        let expression = codex_model_refresh_expression(
            &["gpt-5.6-sol".to_string(), "claude-sonnet".to_string()],
            &[],
            &[],
            &Default::default(),
            "gpt-5.6-sol",
            crate::providers::ReasoningEffortProfile::Standard,
        )
        .unwrap();

        assert!(expression.contains("supportedReasoningEffortsByModel[model]"));
        assert!(expression.contains("\"gpt-5.6-sol\":[{\"description\""));
        assert!(expression.contains("\"reasoningEffort\":\"ultra\""));
        assert!(expression.contains("\"claude-sonnet\":[{\"description\":\"Disable Thinking\""));
    }

    #[test]
    fn codex_model_refresh_uses_configured_reasoning_efforts() {
        let configured = [(
            "gpt-5.6-sol".to_string(),
            vec![
                crate::models::ReasoningEffort::Low,
                crate::models::ReasoningEffort::High,
            ],
        )]
        .into();
        let expression = codex_model_refresh_expression(
            &["gpt-5.6-sol".to_string()],
            &[],
            &[],
            &configured,
            "gpt-5.6-sol",
            crate::providers::ReasoningEffortProfile::Standard,
        )
        .unwrap();

        assert!(expression.contains("\"reasoningEffort\":\"low\""));
        assert!(expression.contains("\"reasoningEffort\":\"high\""));
        assert!(!expression.contains("\"reasoningEffort\":\"ultra\""));
    }

    #[test]
    fn codex_model_refresh_falls_back_to_the_no_auth_query() {
        assert_eq!(
            codex_model_fallback_query_key(),
            json!(["models", "list", "local", "no-auth", 100])
        );

        let expression = codex_model_refresh_expression(
            &["deepseek-chat".to_string()],
            &[],
            &[],
            &Default::default(),
            "deepseek-chat",
            crate::providers::ReasoningEffortProfile::DeepSeek,
        )
        .unwrap();

        assert!(expression.contains(
            "currentQueries.length > 0\n    ? currentQueries.map(query => query.queryKey)"
        ));
        assert!(expression.contains("[\"models\",\"list\",\"local\",\"no-auth\",100]"));
    }

    #[test]
    fn codex_model_refresh_injects_fast_service_tier() {
        let expression = codex_model_refresh_expression(
            &["gpt-5.6-sol".to_string()],
            &["gpt-5.6-sol".to_string()],
            &[],
            &Default::default(),
            "gpt-5.6-sol",
            crate::providers::ReasoningEffortProfile::Standard,
        )
        .unwrap();

        assert!(expression.contains("additionalSpeedTiers"));
        assert!(expression.contains("id: \"priority\""));
        assert!(expression.contains("defaultServiceTier"));
    }

    #[test]
    fn codex_model_refresh_bypasses_the_renderer_available_model_filter() {
        let expression = codex_model_refresh_expression(
            &["deepseek-chat".to_string()],
            &[],
            &[],
            &Default::default(),
            "deepseek-chat",
            crate::providers::ReasoningEffortProfile::DeepSeek,
        )
        .unwrap();

        assert!(expression.contains("__CODEX_SWITCH_MODEL_QUERY_PATCH__"));
        assert!(expression.contains("observer.setOptions = options =>"));
        assert!(expression.contains("query.addObserver = observer =>"));
        assert!(expression.contains("models,\n        defaultModel:"));
        assert!(expression.contains("if (expectedModels.length === 0) {"));
    }

    #[test]
    fn codex_model_refresh_unlocks_service_tier_for_local_proxy() {
        let expression = codex_model_refresh_expression(
            &["gpt-5.6-sol".to_string()],
            &["gpt-5.6-sol".to_string()],
            &[],
            &Default::default(),
            "gpt-5.6-sol",
            crate::providers::ReasoningEffortProfile::Standard,
        )
        .unwrap();

        assert!(expression.contains("authMethod"));
        assert!(expression.contains("hasChatGptToken"));
        assert!(expression.contains("authMethod = \"chatgpt\""));
        assert!(expression.contains("use_hidden_models"));
        assert!(expression.contains("useHiddenModels"));
        assert!(
            expression.find("patchRendererCapabilities").unwrap()
                < expression.find("if (!queryClient)").unwrap()
        );
    }

    #[test]
    fn validates_theme_overlay_opacity() {
        let normalized =
            normalize_theme_document(json!({ "art": { "overlayOpacity": 0.45 } }), "preset-test")
                .unwrap();
        assert_eq!(normalized["art"]["overlayOpacity"], json!(0.45));

        for invalid in [-0.1, 1.1] {
            let document = json!({ "art": { "overlayOpacity": invalid } });
            assert!(normalize_theme_document(document, "preset-test").is_err());
        }
    }

    #[test]
    fn official_model_refresh_clears_injected_candidates_before_refetching() {
        let expression = codex_model_refresh_expression(
            &[],
            &[],
            &[],
            &Default::default(),
            "gpt-5.6-sol",
            crate::providers::ReasoningEffortProfile::Standard,
        )
        .unwrap();

        assert!(expression.contains("clearModelQueryPatch();"));
        assert!(expression.contains("queryClient.resetQueries({ predicate: matchesModelsQuery }"));
        assert!(expression.contains("refetchType: \"all\""));
        assert!(expression.contains("official-model-queries-reset"));
    }

    #[test]
    fn codex_model_refresh_normalizes_switch_control_display() {
        let expression = codex_model_refresh_expression(
            &[crate::providers::CODEX_SWITCH_CONTROL_MODEL.to_string()],
            &[crate::providers::CODEX_SWITCH_CONTROL_MODEL.to_string()],
            &[crate::providers::CODEX_SWITCH_CONTROL_MODEL.to_string()],
            &Default::default(),
            crate::providers::CODEX_SWITCH_CONTROL_MODEL,
            crate::providers::ReasoningEffortProfile::Standard,
        )
        .unwrap();

        assert!(expression.contains("Codex Switch Control"));
        assert!(expression.contains("isDefault:"));
    }

    #[test]
    fn renderer_recovery_does_not_depend_on_dream_skin() {
        assert!(renderer_recovery_required(false, true));
        assert!(renderer_recovery_required(true, false));
        assert!(!renderer_recovery_required(false, false));
    }
