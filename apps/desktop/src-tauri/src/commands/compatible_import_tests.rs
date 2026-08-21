    #[test]
    fn accepts_cockpit_style_account_arrays() {
        let token = access_token();
        let input = json!([{
            "email": "compatible@example.com",
            "tokens": {
                "idToken": token,
                "accessToken": token,
                "refreshToken": "refresh-token"
            }
        }])
        .to_string();

        let values = parse_compatible_json_auth_values(&input).expect("parse compatible array");
        assert_eq!(values.len(), 1);
        let auth = normalize_compatible_json_auth(&values[0]).expect("normalize account");

        assert_eq!(
            auth.pointer("/tokens/access_token").and_then(Value::as_str),
            Some(token.as_str())
        );
        assert_eq!(
            auth.pointer("/tokens/refresh_token")
                .and_then(Value::as_str),
            Some("refresh-token")
        );
        assert_eq!(auth["auth_mode"], "chatgpt");
        assert!(auth["OPENAI_API_KEY"].is_null());
        assert!(
            chrono::DateTime::parse_from_rfc3339(auth["last_refresh"].as_str().unwrap()).is_ok()
        );
    }

    #[test]
    fn unwraps_json_encoded_session_values() {
        let token = access_token();
        let session = json!({
            "idToken": token,
            "accessToken": token,
        });
        let input = json!({ "session_json": session.to_string() }).to_string();

        let values = parse_compatible_json_auth_values(&input).expect("parse session wrapper");
        let auth = normalize_compatible_json_auth(&values[0]).expect("normalize session");

        assert_eq!(
            auth.pointer("/tokens/access_token").and_then(Value::as_str),
            Some(token.as_str())
        );
        assert_eq!(auth["tokens"]["refresh_token"], "");
    }

    #[test]
    fn converts_sub2api_agent_identity_exports_to_auth_json() {
        let input = json!({
            "type": "sub2api-data",
            "version": 1,
            "exported_at": "2026-07-22T01:42:51Z",
            "proxies": [],
            "accounts": [{
                "name": "agent@example.com",
                "platform": "openai",
                "type": "oauth",
                "credentials": {
                    "auth_mode": "agentIdentity",
                    "agent_runtime_id": "agent-runtime",
                    "agent_private_key": base64::engine::general_purpose::STANDARD.encode([9_u8; 48]),
                    "account_id": "workspace-1",
                    "chatgpt_user_id": "user-1",
                    "email": "agent@example.com",
                    "plan_type": "business",
                    "chatgpt_account_is_fedramp": false
                }
            }]
        })
        .to_string();

        let values = parse_sub2api_auth_values(&input).expect("parse sub2api export");
        assert_eq!(values.len(), 1);
        let auth = normalize_sub2api_auth(&values[0]).expect("normalize sub2api account");
        assert_eq!(auth["auth_mode"], "agentIdentity");
        assert_eq!(auth["agent_identity"]["account_id"], "workspace-1");
        assert_eq!(auth["agent_identity"]["email"], "agent@example.com");
        assert!(auth.get("tokens").is_none());
    }

    #[test]
    fn converts_sub2api_oauth_exports_with_opaque_access_tokens() {
        let input = json!({
            "type": "sub2api-data",
            "version": 1,
            "exported_at": "2026-07-23T06:05:26Z",
            "proxies": [],
            "accounts": [{
                "name": "person@example.com",
                "platform": "openai",
                "type": "oauth",
                "credentials": {
                    "access_token": "at-opaque-personal-access-token",
                    "chatgpt_account_id": "account-1",
                    "chatgpt_user_id": "user-1",
                    "email": "person@example.com",
                    "plan_type": "team",
                    "organization_id": "org-1",
                    "expires_at": "2026-10-21T02:37:37Z",
                    "id_token": "",
                    "refresh_token": ""
                }
            }]
        })
        .to_string();

        let values = parse_sub2api_auth_values(&input).expect("parse sub2api export");
        let auth = normalize_sub2api_auth(&values[0]).expect("normalize sub2api oauth account");

        assert_eq!(auth["auth_mode"], "chatgpt");
        assert_eq!(
            auth["tokens"]["access_token"],
            "at-opaque-personal-access-token"
        );
        assert_eq!(auth["tokens"]["account_id"], "account-1");
        assert_eq!(auth["tokens"]["chatgpt_user_id"], "user-1");
        assert_eq!(auth["tokens"]["email"], "person@example.com");
        assert_eq!(auth["tokens"]["plan_type"], "team");
        assert_eq!(auth["tokens"]["refresh_token"], "");
        crate::auth::validate_auth(&auth).unwrap();
    }

    #[test]
    fn accepts_headerless_sub2api_account_exports() {
        let input = json!({
            "exported_at": "2026-08-12T06:34:28Z",
            "proxies": [],
            "accounts": [{
                "name": "person@example.com",
                "platform": "openai",
                "type": "oauth",
                "credentials": {
                    "chatgpt_account_id": "workspace-1",
                    "chatgpt_account_is_fedramp": false,
                    "chatgpt_user_id": "user-1",
                    "plan_type": "team",
                    "access_token": "at-opaque-personal-access-token",
                    "auth_mode": "personalAccessToken",
                    "email": "person@example.com",
                    "openai_auth_mode": "personal_access_token",
                    "token_type": "Bearer"
                },
                "concurrency": 10,
                "priority": 1
            }]
        });

        assert!(is_sub2api_export(&input));
        let values = parse_sub2api_auth_values(&input.to_string())
            .expect("parse headerless sub2api account export");
        let auth = normalize_sub2api_auth(&values[0]).expect("normalize personal access token");

        assert_eq!(auth["auth_mode"], "chatgpt");
        assert_eq!(auth["tokens"]["account_id"], "workspace-1");
        assert_eq!(auth["tokens"]["chatgpt_user_id"], "user-1");
        assert_eq!(auth["tokens"]["email"], "person@example.com");
        assert_eq!(auth["tokens"]["plan_type"], "team");
        assert_eq!(auth["tokens"]["refresh_token"], "");
        crate::auth::validate_auth(&auth).unwrap();
    }

    #[test]
    fn preserves_explicit_identity_from_compatible_access_only_accounts() {
        let input = json!({
            "token": {
                "accessToken": "at-opaque-personal-access-token"
            },
            "user": {
                "id": "user-1",
                "email": "person@example.com"
            },
            "account": {
                "id": "workspace-1",
                "planType": "team"
            }
        });

        let auth = normalize_compatible_json_auth(&input).expect("normalize access-only account");

        assert_eq!(
            auth["tokens"]["access_token"],
            "at-opaque-personal-access-token"
        );
        assert_eq!(auth["tokens"]["account_id"], "workspace-1");
        assert_eq!(auth["tokens"]["chatgpt_user_id"], "user-1");
        assert_eq!(auth["tokens"]["email"], "person@example.com");
        assert_eq!(auth["tokens"]["plan_type"], "team");
        crate::auth::validate_auth(&auth).unwrap();
    }

    #[test]
    fn recursively_finds_accounts_and_parses_json_embedded_in_text() {
        let token = access_token();
        let nested = json!({
            "data": {
                "items": [{
                    "session": {
                        "accessToken": token,
                        "user": { "id": "nested-user", "email": "nested@example.com" },
                        "account": { "id": "nested-account" }
                    }
                }]
            }
        });
        let values = parse_compatible_json_auth_values(&nested.to_string()).unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0]["user"]["id"], "nested-user");

        let mixed = format!("card data: {} trailing text", nested);
        let values = parse_compatible_json_auth_values(&mixed).unwrap();
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn imports_reference_page_metadata_aliases() {
        let token = jwt(json!({ "sub": "metadata-user", "exp": 1_800_000_000_i64 }));
        let input = json!({
            "provider": "codex",
            "id": "router-account",
            "accessToken": token,
            "remark": "imported note",
            "priority": 42,
            "isActive": false
        });
        let auth = normalize_compatible_json_auth(&input).unwrap();
        let metadata = compatible_json_account_metadata(&input);

        assert_eq!(auth["tokens"]["account_id"], "router-account");
        assert_eq!(metadata.note.as_deref(), Some("imported note"));
        assert_eq!(metadata.expires_at.as_deref(), Some("2027-01-15"));
        assert_eq!(metadata.auto_switch_priority, Some(42));
        assert_eq!(metadata.disabled, Some(true));
    }

    #[test]
    fn discards_axonhub_refresh_token_placeholder() {
        let token = access_token();
        let auth = normalize_compatible_json_auth(&json!({
            "access_token": token,
            "refresh_token": "__missing_refresh_token__"
        }))
        .unwrap();
        assert_eq!(auth["tokens"]["refresh_token"], "");
    }
