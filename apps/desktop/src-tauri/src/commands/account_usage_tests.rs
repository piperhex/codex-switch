    #[test]
    fn synchronizes_agent_identity_auth_to_local_codex_auth_json() {
        let paths = test_paths();
        let auth = agent_identity_auth();
        let (_, _, _, id) = crate::auth::account_fields(&auth).unwrap();
        write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();

        write_managed_auth_to_current(&paths, &id).unwrap();

        assert_eq!(read_json(&paths.current_auth).unwrap(), auth);
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn allows_agent_identity_switches_only_while_local_proxy_is_running() {
        let auth = agent_identity_auth();
        ensure_account_switch_allowed(&auth, true).unwrap();
        let error = ensure_account_switch_allowed(&auth, false).unwrap_err();
        assert!(error.contains("本地代理模式"));
    }

    #[test]
    fn background_auth_sync_defers_writes_while_client_is_running() {
        let paths = test_paths();
        let old_auth = json!({ "credential": "old" });
        let new_auth = json!({ "credential": "new" });
        write_json_atomic(&paths.current_auth, &old_auth).unwrap();

        assert!(!sync_current_auth_with_client_state(&paths, &new_auth, true).unwrap());
        assert_eq!(read_json(&paths.current_auth).unwrap(), old_auth);

        assert!(sync_current_auth_with_client_state(&paths, &new_auth, false).unwrap());
        assert_eq!(read_json(&paths.current_auth).unwrap(), new_auth);

        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn selected_managed_auth_replaces_stale_current_auth() {
        let paths = test_paths();
        let token = access_token();
        let selected = json!({
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": null,
            "tokens": {
                "id_token": token,
                "access_token": token,
                "refresh_token": "refresh-token"
            },
            "last_refresh": "2026-07-21T00:00:00Z"
        });
        write_json_atomic(&managed_auth_path(&paths, "selected"), &selected).unwrap();
        write_json_atomic(&paths.current_auth, &json!({ "credential": "stale" })).unwrap();

        write_managed_auth_to_current(&paths, "selected").unwrap();

        assert_eq!(
            read_json(&paths.current_auth).unwrap(),
            read_json(&managed_auth_path(&paths, "selected")).unwrap()
        );
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn in_flight_refresh_reloads_a_newer_login_instead_of_overwriting_it() {
        let paths = test_paths();
        let token = access_token();
        let stale = json!({
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": null,
            "tokens": {
                "id_token": token,
                "access_token": "stale-access",
                "refresh_token": "stale-refresh"
            },
            "last_refresh": "2026-08-30T01:00:00Z"
        });
        let (_, _, _, id) = crate::auth::account_fields(&stale).unwrap();
        let mut fresh = stale.clone();
        fresh["tokens"]["access_token"] = Value::String("fresh-login-access".to_string());
        fresh["tokens"]["refresh_token"] = Value::String("fresh-login-refresh".to_string());
        fresh["last_refresh"] = Value::String("2026-08-30T02:00:00Z".to_string());
        write_json_atomic(&managed_auth_path(&paths, &id), &fresh).unwrap();

        let mut request = RequestAuth::new(stale);
        request.value["tokens"]["access_token"] =
            Value::String("refreshed-stale-access".to_string());
        assert!(!request.persist(&paths, &id).unwrap());
        assert_eq!(request.value, fresh);
        assert_eq!(read_json(&managed_auth_path(&paths, &id)).unwrap(), fresh);

        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn updates_disabled_account_ids_without_duplicates() {
        let mut state = ManagerStateFile::default();

        assert!(update_disabled_account_ids(&mut state, "account-b", false));
        assert!(update_disabled_account_ids(&mut state, "account-a", false));
        assert!(!update_disabled_account_ids(&mut state, "account-a", false));
        assert_eq!(state.disabled_account_ids, ["account-a", "account-b"]);

        assert!(update_disabled_account_ids(&mut state, "account-a", true));
        assert!(!update_disabled_account_ids(&mut state, "account-a", true));
        assert_eq!(state.disabled_account_ids, ["account-b"]);
    }

    #[test]
    fn usage_refresh_failures_only_disable_enabled_access_rejections() {
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 401 Unauthorized",
            true,
            &[401, 402, 403],
        ));
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 403 Forbidden",
            true,
            &[401, 402, 403],
        ));
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 402 Payment Required",
            true,
            &[401, 402, 403],
        ));

        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 401 Unauthorized",
            false,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 403 Forbidden",
            false,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 402 Payment Required",
            false,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "failed to read Codex usage: error sending request",
            true,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "failed to read Codex usage: operation timed out",
            true,
            &[401, 402, 403],
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 503 Service Unavailable",
            true,
            &[401, 402, 403],
        ));
        assert!(should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 429 Too Many Requests",
            true,
            &[429],
        ));
        assert!(!should_disable_account_auto_switch(
            "Codex usage endpoint returned HTTP 401 Unauthorized",
            true,
            &[429],
        ));
    }

    #[test]
    fn usage_network_errors_exclude_explicit_http_statuses() {
        assert!(is_usage_network_error(
            "failed to read Codex usage: error sending request for url"
        ));
        assert!(is_usage_network_error(
            "failed to read Codex usage: operation timed out"
        ));
        assert!(is_usage_network_error("DNS lookup failed"));
        assert!(!is_usage_network_error(
            "Codex usage endpoint returned HTTP 503 Service Unavailable"
        ));
        assert!(!is_usage_network_error("failed to parse Codex usage"));
    }
