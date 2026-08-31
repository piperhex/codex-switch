    #[test]
    fn image_account_pool_prefers_the_configured_account_and_deduplicates_candidates() {
        let account_ids = ordered_image_account_ids(
            Some("image-primary".to_string()),
            vec![
                "account-b".to_string(),
                "image-primary".to_string(),
                "account-a".to_string(),
            ],
        );

        assert_eq!(
            account_ids,
            vec!["image-primary", "account-b", "account-a"]
        );
    }

    #[test]
    fn image_account_pool_rotates_only_the_request_that_received_429() {
        let candidates = vec!["account-a".to_string(), "account-b".to_string()];
        let mut first_request = ImageAccountPool::new(candidates.clone()).unwrap();
        let second_request = ImageAccountPool::new(candidates).unwrap();

        assert_eq!(
            first_request.advance_after_429("account-a"),
            Some("account-b")
        );
        assert_eq!(first_request.current_account_id(), "account-b");
        assert_eq!(second_request.current_account_id(), "account-a");
        assert_eq!(first_request.advance_after_429("account-a"), None);
    }

    #[test]
    fn image_429_response_advances_the_request_pool() {
        let mut pool = ImageAccountPool::new(vec![
            "account-a".to_string(),
            "account-b".to_string(),
        ]);
        let response = UpstreamPayload {
            status: 429,
            content_type: None,
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(Vec::new()),
            token_usage_account: Some(TokenUsageAccount {
                account_id: "account-a".to_string(),
                account_email: "a@example.com".to_string(),
                active_account_generation: 0,
                auto_switch_attempt_generation: 0,
                auto_switch_eligible: false,
            }),
        };

        advance_image_account_after_429(&mut pool, &response);

        assert_eq!(pool.unwrap().current_account_id(), "account-b");
    }

    #[test]
    fn configured_official_image_account_does_not_require_an_active_main_account() {
        let state = ManagerStateFile {
            active_provider_id: Some("provider".to_string()),
            image_output_target: Some(ImageModelTarget::Official {
                account_id: "image-account".to_string(),
            }),
            ..ManagerStateFile::default()
        };

        assert_eq!(
            preferred_image_account_id(&state, OfficialCredentialPurpose::ImageGeneration),
            Some("image-account".to_string())
        );
    }

    #[test]
    fn image_credentials_never_trigger_global_automatic_switching() {
        assert!(!credential_is_auto_switch_eligible(
            OfficialCredentialPurpose::ImageInput,
            None,
            "active-account",
            Some("active-account"),
        ));
        assert!(!credential_is_auto_switch_eligible(
            OfficialCredentialPurpose::ImageGeneration,
            None,
            "active-account",
            Some("active-account"),
        ));
        assert!(credential_is_auto_switch_eligible(
            OfficialCredentialPurpose::Default,
            None,
            "active-account",
            Some("active-account"),
        ));
    }

    #[test]
    fn unconfigured_images_follow_only_the_active_account_outside_concurrent_mode() {
        let state = ManagerStateFile {
            active_account_id: Some("active-account".to_string()),
            ..ManagerStateFile::default()
        };

        assert!(!image_account_failover_enabled(
            &state,
            OfficialCredentialPurpose::ImageInput,
        ));
        assert!(!image_account_failover_enabled(
            &state,
            OfficialCredentialPurpose::ImageGeneration,
        ));
        assert_eq!(
            preferred_image_account_id(&state, OfficialCredentialPurpose::ImageInput),
            Some("active-account".to_string())
        );
    }

    #[test]
    fn concurrent_mode_enables_image_failover_without_a_dedicated_account() {
        let state = ManagerStateFile {
            active_account_id: Some("active-account".to_string()),
            concurrent_account_routing_enabled: true,
            ..ManagerStateFile::default()
        };

        assert!(image_account_failover_enabled(
            &state,
            OfficialCredentialPurpose::ImageInput,
        ));
        assert!(image_account_failover_enabled(
            &state,
            OfficialCredentialPurpose::ImageGeneration,
        ));
    }

    #[test]
    fn image_generation_pool_excludes_agent_identity_credentials() {
        let oauth = json!({ "tokens": { "access_token": "oauth-token" } });
        let agent_identity = json!({
            "auth_mode": "agentIdentity",
            "agent_identity": {}
        });

        assert!(image_auth_supports_purpose(
            &oauth,
            OfficialCredentialPurpose::ImageGeneration,
        ));
        assert!(!image_auth_supports_purpose(
            &agent_identity,
            OfficialCredentialPurpose::ImageGeneration,
        ));
        assert!(image_auth_supports_purpose(
            &agent_identity,
            OfficialCredentialPurpose::ImageInput,
        ));
    }
