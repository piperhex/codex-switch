    use super::*;

    #[test]
    fn manager_state_defaults_local_proxy_to_disabled() {
        let state: ManagerStateFile =
            serde_json::from_str(r#"{"active_account_id":"account-1"}"#).unwrap();

        assert_eq!(state.active_account_id.as_deref(), Some("account-1"));
        assert!(state.auto_switch_provider_id.is_none());
        assert!(!state.local_proxy_enabled);
        assert!(!state.auto_switch_on_quota_exhaustion);
        assert!(!state.concurrent_account_routing_enabled);
        assert!(state.concurrent_account_group.is_none());
        assert!(!state.custom_auto_switch_priority_enabled);
        assert!(!state.custom_auto_switch_threshold_enabled);
        assert_eq!(state.global_auto_switch_threshold, 0.0);
        assert!(!state.auto_disable_unreachable_accounts);
        assert!(!state.local_proxy_listen_on_all_interfaces);
        assert!(state.local_proxy_lan_api_key.is_none());
        assert!(state.image_generation_account_id.is_none());
        assert!(state.image_input_target.is_none());
        assert!(state.image_output_target.is_none());
        assert!(state.disabled_account_ids.is_empty());
    }

    #[test]
    fn image_model_targets_use_camel_case_at_the_ipc_boundary() {
        let official = serde_json::to_value(ImageModelTarget::Official {
            account_id: "account-1".to_string(),
        })
        .unwrap();
        let provider: ImageModelTarget = serde_json::from_value(serde_json::json!({
            "kind": "provider",
            "providerId": "provider-1",
            "model": "vision-model"
        }))
        .unwrap();

        assert_eq!(official["accountId"], "account-1");
        assert_eq!(
            provider,
            ImageModelTarget::Provider {
                provider_id: "provider-1".to_string(),
                model: "vision-model".to_string(),
            }
        );
    }

    #[test]
    fn app_settings_default_to_the_hosted_cloud_server() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_disabled: AppSettings =
            serde_json::from_str(r#"{"cloudBaseUrl":null}"#).unwrap();

        assert_eq!(
            defaults.cloud_base_url.as_deref(),
            Some(DEFAULT_CLOUD_BASE_URL)
        );
        assert_eq!(
            migrated.cloud_base_url.as_deref(),
            Some(DEFAULT_CLOUD_BASE_URL)
        );
        assert!(explicitly_disabled.cloud_base_url.is_none());
    }

    #[test]
    fn app_settings_default_to_writing_codex_only() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let all: AppSettings = serde_json::from_str(r#"{"claudeCodeWriteTarget":"all"}"#).unwrap();

        assert_eq!(defaults.claude_code_write_target, ClaudeCodeWriteTarget::Codex);
        assert_eq!(migrated.claude_code_write_target, ClaudeCodeWriteTarget::Codex);
        assert_eq!(all.claude_code_write_target, ClaudeCodeWriteTarget::All);
    }

    #[test]
    fn third_party_app_write_settings_use_camel_case_and_default_safely() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str(
            r#"{"thirdPartyAppWrite":{"enabled":true,"writeCodex":false,"apps":{"openCode":true}}}"#,
        )
        .unwrap();

        assert!(defaults.third_party_app_write.is_none());
        let settings = migrated.third_party_app_write.unwrap();
        assert!(settings.enabled);
        assert!(!settings.write_codex);
        assert!(settings.apps.open_code);
        assert!(!settings.apps.open_claw);
        assert_eq!(settings.claude_subagent_model, "sol");
        let serialized = serde_json::to_value(settings).unwrap();
        assert_eq!(serialized["writeCodex"], false);
        assert_eq!(serialized["apps"]["deepSeekHarness"], false);
        let terra: ThirdPartyAppWriteSettings = serde_json::from_str(
            r#"{"claudeSubagentModel":"terra"}"#,
        )
        .unwrap();
        assert_eq!(terra.claude_subagent_model, "terra");
    }

    #[test]
    fn app_settings_default_gpt_5_6_sol_context_window_is_272k() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let serialized = serde_json::to_value(&defaults).unwrap();

        assert_eq!(defaults.gpt_5_6_sol_context_window, 272_000);
        assert_eq!(migrated.gpt_5_6_sol_context_window, 272_000);
        assert_eq!(serialized["gpt56SolContextWindow"], 272_000);
    }

    #[test]
    fn app_settings_hide_custom_cloud_server_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_visible: AppSettings =
            serde_json::from_str(r#"{"showCustomCloudServer":true}"#).unwrap();

        assert!(!defaults.show_custom_cloud_server);
        assert!(!migrated.show_custom_cloud_server);
        assert!(explicitly_visible.show_custom_cloud_server);
    }

    #[test]
    fn app_settings_enable_the_floating_bubble_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_disabled: AppSettings =
            serde_json::from_str(r#"{"floatingBubbleEnabled":false}"#).unwrap();

        assert!(defaults.floating_bubble_enabled);
        assert!(migrated.floating_bubble_enabled);
        assert!(!explicitly_disabled.floating_bubble_enabled);
    }

    #[test]
    fn app_settings_minimize_to_tray_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_disabled: AppSettings =
            serde_json::from_str(r#"{"closeToTray":false}"#).unwrap();

        assert!(defaults.close_to_tray);
        assert!(migrated.close_to_tray);
        assert!(!explicitly_disabled.close_to_tray);
    }

    #[test]
    fn app_settings_enable_launch_at_startup_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_disabled: AppSettings =
            serde_json::from_str(r#"{"launchAtStartup":false}"#).unwrap();

        assert!(defaults.launch_at_startup);
        assert!(migrated.launch_at_startup);
        assert!(!explicitly_disabled.launch_at_startup);
    }

    #[test]
    fn app_settings_show_account_notes_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_hidden: AppSettings =
            serde_json::from_str(r#"{"hideAccountNotes":true}"#).unwrap();

        assert!(!defaults.hide_account_notes);
        assert!(!migrated.hide_account_notes);
        assert!(explicitly_hidden.hide_account_notes);
    }

    #[test]
    fn app_settings_default_the_bubble_style_to_classic() {
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let glass: AppSettings = serde_json::from_str(r#"{"bubbleStyle":"glass"}"#).unwrap();

        assert!(matches!(migrated.bubble_style, BubbleStyle::Classic));
        assert!(matches!(glass.bubble_style, BubbleStyle::Glass));
    }

    #[test]
    fn app_settings_default_the_web_version_to_disabled() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let enabled: AppSettings =
            serde_json::from_str(r#"{"webProxyPort":18765,"webProxyListenOnAllInterfaces":true}"#)
                .unwrap();

        assert!(defaults.web_proxy_port.is_none());
        assert!(migrated.web_proxy_port.is_none());
        assert!(!defaults.web_proxy_listen_on_all_interfaces);
        assert!(!migrated.web_proxy_listen_on_all_interfaces);
        assert_eq!(enabled.web_proxy_port, Some(18_765));
        assert!(enabled.web_proxy_listen_on_all_interfaces);
    }

    #[test]
    fn app_settings_default_the_network_proxy_to_disabled() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();

        assert_eq!(defaults.network_proxy, NetworkProxySettings::default());
        assert_eq!(migrated.network_proxy, NetworkProxySettings::default());
    }

    #[test]
    fn app_settings_default_auto_disable_status_codes_to_access_rejections() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let customized: AppSettings =
            serde_json::from_str(r#"{"autoDisableStatusCodes":[401,429]}"#).unwrap();

        assert_eq!(defaults.auto_disable_status_codes, [401, 402, 403, 429]);
        assert_eq!(migrated.auto_disable_status_codes, [401, 402, 403, 429]);
        assert_eq!(customized.auto_disable_status_codes, [401, 429]);
    }

    #[test]
    fn app_settings_defaults_upstream_429_retry_timeout_to_one_minute() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let customized: AppSettings =
            serde_json::from_str(r#"{"upstream429RetryTimeoutSeconds":90}"#).unwrap();

        assert_eq!(defaults.upstream_429_retry_timeout_seconds, 60);
        assert_eq!(migrated.upstream_429_retry_timeout_seconds, 60);
        assert_eq!(customized.upstream_429_retry_timeout_seconds, 90);
    }

    #[test]
    fn app_settings_hide_usage_network_errors_by_default() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let enabled: AppSettings =
            serde_json::from_str(r#"{"showUsageNetworkErrors":true}"#).unwrap();

        assert!(!defaults.show_usage_network_errors);
        assert!(!migrated.show_usage_network_errors);
        assert!(enabled.show_usage_network_errors);
    }
