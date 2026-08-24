    use super::*;
    use crate::models::UsageWindow;
    use serde_json::json;
    use std::io::{Cursor, Read};
    use std::sync::{
        atomic::{AtomicUsize, Ordering as AtomicOrdering},
        mpsc,
    };

    fn sse_event(output: &str, event_type: &str) -> Value {
        output
            .split("\n\n")
            .filter_map(|block| {
                let data = block
                    .lines()
                    .filter_map(|line| line.trim_start().strip_prefix("data:"))
                    .map(str::trim_start)
                    .collect::<Vec<_>>()
                    .join("\n");
                serde_json::from_str::<Value>(&data).ok()
            })
            .find(|value| value.get("type").and_then(Value::as_str) == Some(event_type))
            .unwrap_or_else(|| panic!("missing SSE event {event_type}"))
    }

    fn read_upstream_payload(mut payload: UpstreamPayload) -> Vec<u8> {
        let mut body = Vec::new();
        match &mut payload.body {
            UpstreamBody::Buffered(buffered) => body.extend_from_slice(buffered),
            UpstreamBody::Streaming(reader) => {
                reader.read_to_end(&mut body).unwrap();
            }
        }
        body
    }

    fn openai_provider(base_url: String) -> ProviderProfile {
        ProviderProfile {
            id: "openai".to_string(),
            kind: ProviderKind::OpenAi,
            name: "OpenAI".to_string(),
            group: String::new(),
            base_url,
            api_key: "sk-upstream".to_string(),
            model: "gpt-5.6-sol".to_string(),
            models: vec!["gpt-5.6-sol".to_string()],
            model_reasoning_efforts: Default::default(),
            model_context_windows: Default::default(),
            model_api_formats: Default::default(),
            image_input_models: vec!["gpt-5.6-sol".to_string()],
            image_input_models_configured: true,
            context_window: None,
            model_selection_controlled_by_codex: true,
            api_format: ProviderApiFormat::OpenaiResponses,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        }
    }

    #[test]
    fn proxy_bind_host_uses_loopback_unless_lan_listening_is_enabled() {
        assert_eq!(proxy_bind_host(false), LOCAL_PROXY_HOST);
        assert_eq!(proxy_bind_host(true), LOCAL_PROXY_LAN_HOST);
    }

    #[test]
    fn lan_listening_requires_a_configured_api_key() {
        let mut state = ManagerStateFile {
            local_proxy_listen_on_all_interfaces: true,
            ..ManagerStateFile::default()
        };
        assert!(!lan_listening_enabled(&state));

        state.local_proxy_lan_api_key = Some("  lan-secret  ".to_string());
        assert!(lan_listening_enabled(&state));
    }

    #[test]
    fn lan_api_key_accepts_supported_headers_and_bearer_tokens() {
        let bearer = vec![("Authorization".to_string(), "Bearer lan-secret".to_string())];
        let header = vec![
            ("Authorization".to_string(), "Bearer wrong".to_string()),
            ("X-API-Key".to_string(), "lan-secret".to_string()),
        ];
        let invalid = vec![("Authorization".to_string(), "Basic lan-secret".to_string())];

        assert!(request_has_valid_api_key(&bearer, "lan-secret"));
        assert!(request_has_valid_api_key(&header, "lan-secret"));
        assert!(!request_has_valid_api_key(&invalid, "lan-secret"));
        assert!(!request_has_valid_api_key(&bearer, "different"));
    }

    #[test]
    fn stopped_unspecified_listener_can_immediately_rebind_on_loopback() {
        let server = Arc::new(Server::http("0.0.0.0:0").unwrap());
        let address = server.server_addr().to_ip().unwrap();
        let server_for_thread = server.clone();
        let handle = thread::spawn(move || for _ in server_for_thread.incoming_requests() {});
        stop_proxy_runtime(ProxyRuntime {
            server,
            handle: Some(handle),
        });

        let bind_addr = format!("127.0.0.1:{}", address.port());
        let rebound = Arc::new(bind_http_server(&bind_addr).unwrap());
        let rebound_for_thread = rebound.clone();
        let rebound_handle =
            thread::spawn(move || for _ in rebound_for_thread.incoming_requests() {});
        stop_proxy_runtime(ProxyRuntime {
            server: rebound,
            handle: Some(rebound_handle),
        });
    }

    #[test]
    fn proxy_session_id_prefers_the_codex_thread_header() {
        let headers = vec![
            ("session-id".to_string(), "session-1".to_string()),
            ("thread-id".to_string(), "thread-1".to_string()),
            (
                "x-codex-window-id".to_string(),
                "window-thread:3".to_string(),
            ),
        ];

        assert_eq!(proxy_session_id(&headers).as_deref(), Some("thread-1"));
    }

    #[test]
    fn chat_continuation_requires_a_session_header() {
        assert!(chat_continuation_scope("provider", &[]).is_none());

        let headers = vec![("thread-id".to_string(), "thread-1".to_string())];
        assert!(chat_continuation_scope("provider", &headers).is_some());

        let oversized = "x".repeat(MAX_CONTINUATION_SCOPE_ID_BYTES + 1);
        let headers = vec![("thread-id".to_string(), oversized)];
        assert!(chat_continuation_scope("provider", &headers).is_none());
    }

    #[test]
    fn concurrent_router_uses_the_least_loaded_account_and_keeps_sessions_sticky() {
        let mut router = ConcurrentAccountRouter::default();
        let enabled = vec!["account-a".to_string(), "account-b".to_string()];

        assert_eq!(
            router.account_for_session("thread-1", &enabled).as_deref(),
            Some("account-a")
        );
        assert_eq!(
            router.account_for_session("thread-2", &enabled).as_deref(),
            Some("account-b")
        );
        assert_eq!(
            router.account_for_session("thread-1", &enabled).as_deref(),
            Some("account-a")
        );
        assert_eq!(
            router.account_for_session("thread-3", &enabled).as_deref(),
            Some("account-a")
        );
        assert_eq!(
            router.account_for_session("thread-4", &enabled).as_deref(),
            Some("account-b")
        );
    }

    #[test]
    fn concurrent_router_reassigns_a_session_after_its_account_is_disabled() {
        let mut router = ConcurrentAccountRouter::default();
        let enabled = vec!["account-a".to_string(), "account-b".to_string()];
        assert_eq!(
            router.account_for_session("thread-1", &enabled).as_deref(),
            Some("account-a")
        );

        assert_eq!(
            router
                .account_for_session("thread-1", &["account-b".to_string()])
                .as_deref(),
            Some("account-b")
        );
    }

    #[test]
    fn concurrent_routing_excludes_accounts_without_primary_quota() {
        let exhausted = UsageSummary {
            primary: Some(UsageWindow {
                used_percent: 100.0,
                remaining_percent: 0.0,
                resets_at: None,
                window_minutes: None,
            }),
            ..UsageSummary::default()
        };
        let available = UsageSummary {
            primary: Some(UsageWindow {
                used_percent: 99.0,
                remaining_percent: 1.0,
                resets_at: None,
                window_minutes: None,
            }),
            ..UsageSummary::default()
        };

        assert!(!primary_quota_available_for_concurrent_routing(&exhausted));
        assert!(primary_quota_available_for_concurrent_routing(&available));
        assert!(primary_quota_available_for_concurrent_routing(
            &UsageSummary::default()
        ));
    }

    #[test]
    fn proxy_session_id_removes_the_window_generation_fallback() {
        let headers = vec![(
            "x-codex-window-id".to_string(),
            "019fa39d-dee7-7302-9d27-c5755e29b926:4".to_string(),
        )];

        assert_eq!(
            proxy_session_id(&headers).as_deref(),
            Some("019fa39d-dee7-7302-9d27-c5755e29b926")
        );
    }

    #[test]
    fn proxy_request_metadata_reads_codex_model_and_reasoning_effort() {
        let body = br#"{
            "model": "gpt-5.6-sol",
            "reasoning": { "effort": "xhigh", "summary": "auto" }
        }"#;

        assert_eq!(
            proxy_request_metadata(body),
            (Some("gpt-5.6-sol".to_string()), Some("xhigh".to_string()))
        );
    }

    #[test]
    fn proxy_request_metadata_supports_legacy_reasoning_effort() {
        let body = br#"{
            "model": "gpt-5.6-terra",
            "reasoning_effort": "medium"
        }"#;

        assert_eq!(
            proxy_request_metadata(body),
            (
                Some("gpt-5.6-terra".to_string()),
                Some("medium".to_string())
            )
        );
    }

    #[test]
    fn proxy_session_token_totals_accumulate_completed_responses() {
        let mut totals = ProxySessionTokenTotals::default();
        totals.add_usage(&TokenUsageValues {
            input_tokens: Some(120),
            output_tokens: Some(30),
            reasoning_tokens: Some(12),
            cached_tokens: Some(80),
            total_tokens: Some(150),
        });
        totals.add_usage(&TokenUsageValues {
            input_tokens: Some(40),
            output_tokens: Some(10),
            reasoning_tokens: Some(3),
            cached_tokens: Some(20),
            total_tokens: None,
        });

        assert_eq!(totals.total_tokens, 200);
        assert_eq!(totals.input_tokens, 160);
        assert_eq!(totals.output_tokens, 40);
        assert_eq!(totals.reasoning_tokens, 15);
        assert_eq!(totals.cached_tokens, 100);
    }

    #[test]
    fn proxy_session_records_the_first_streamed_response_chunk() {
        let session_id = format!("first-response-{}", uuid::Uuid::new_v4());
        let headers = vec![("thread-id".to_string(), session_id.clone())];
        let guard = begin_proxy_session_request(&headers, None, br#"{"model":"gpt-5.6-sol"}"#);
        let payload = attach_first_response_capture(
            UpstreamPayload {
                status: 200,
                content_type: Some("text/event-stream".to_string()),
                response_headers: Vec::new(),
                body: UpstreamBody::Streaming(Box::new(Cursor::new(b"data: hello\n\n"))),
                token_usage_account: None,
            },
            Some(&guard),
        );

        assert_eq!(
            list_proxy_session_requests_blocking(&session_id).unwrap()[0].first_response_time_ms,
            None
        );
        let UpstreamBody::Streaming(mut reader) = payload.body else {
            panic!("expected a streaming response");
        };
        let mut body = Vec::new();
        reader.read_to_end(&mut body).unwrap();

        assert_eq!(body, b"data: hello\n\n");
        assert!(
            list_proxy_session_requests_blocking(&session_id).unwrap()[0]
                .first_response_time_ms
                .is_some()
        );
        drop(guard);
        proxy_sessions().lock().unwrap().remove(&session_id);
    }

    #[test]
    fn proxy_cannot_stop_while_an_agent_identity_is_selected() {
        let error = ensure_proxy_can_stop_with_auth(&json!({
            "auth_mode": "agentIdentity",
            "agent_identity": {}
        }))
        .unwrap_err();

        assert!(error.contains("先在代理模式中切换"));
        ensure_proxy_can_stop_with_auth(&json!({ "auth_mode": "chatgpt" })).unwrap();
    }

    #[test]
    fn stopping_proxy_deselects_the_active_third_party_provider() {
        let provider_state = ManagerStateFile {
            active_provider_id: Some("third-party".to_string()),
            local_proxy_enabled: true,
            ..ManagerStateFile::default()
        };

        let stopped_state = stopped_proxy_state(provider_state);

        assert!(stopped_state.active_provider_id.is_none());
        assert!(!stopped_state.local_proxy_enabled);
    }

    fn account_with_usage(id: &str, primary: f64, secondary: f64) -> AccountSummary {
        AccountSummary {
            id: id.to_string(),
            email: format!("{id}@example.com"),
            note: String::new(),
            expires_at: String::new(),
            private_details: Default::default(),
            plan: String::new(),
            account_id: None,
            active: id == "current",
            auto_switch_enabled: true,
            auto_switch_priority: 0,
            auto_switch_threshold: 0.0,
            local_proxy_compatible: true,
            direct_switch_compatible: true,
            agent_identity: false,
            official: false,
            metadata_editable: true,
            usage: UsageSummary {
                primary: Some(UsageWindow {
                    used_percent: 100.0 - primary,
                    remaining_percent: primary,
                    resets_at: None,
                    window_minutes: Some(300),
                }),
                secondary: Some(UsageWindow {
                    used_percent: 100.0 - secondary,
                    remaining_percent: secondary,
                    resets_at: None,
                    window_minutes: Some(10_080),
                }),
                api_expires_at: None,
                plan: None,
                fetched_at: None,
                error: None,
            },
        }
    }

    fn official_payload(status: u16, active_account_generation: u64) -> UpstreamPayload {
        UpstreamPayload {
            status,
            content_type: Some("application/json".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(Vec::new()),
            token_usage_account: Some(TokenUsageAccount {
                account_id: "current".to_string(),
                account_email: "current@example.com".to_string(),
                active_account_generation,
                auto_switch_attempt_generation: 0,
                auto_switch_eligible: true,
            }),
        }
    }

    #[test]
    fn quota_switch_prefers_the_account_with_lowest_remaining_primary_quota() {
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            account_with_usage("lowest-remaining", 5.0, 1.0),
            account_with_usage("more-remaining", 72.0, 99.0),
            account_with_usage("exhausted", 0.0, 99.0),
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", false, false).unwrap();

        assert_eq!(selected.id, "lowest-remaining");
    }

    #[test]
    fn quota_switch_ignores_accounts_disabled_for_automatic_switching() {
        let mut disabled = account_with_usage("disabled", 5.0, 1.0);
        disabled.auto_switch_enabled = false;
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            disabled,
            account_with_usage("enabled", 72.0, 99.0),
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", false, false).unwrap();

        assert_eq!(selected.id, "enabled");
    }

    #[test]
    fn quota_switch_prefers_lower_custom_priority_before_usage() {
        let mut lower_priority = account_with_usage("lower-priority", 72.0, 99.0);
        lower_priority.auto_switch_priority = -1;
        let mut higher_priority = account_with_usage("higher-priority", 5.0, 1.0);
        higher_priority.auto_switch_priority = 2;
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            higher_priority,
            lower_priority,
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", true, false).unwrap();

        assert_eq!(selected.id, "lower-priority");
    }

    #[test]
    fn quota_switch_excludes_accounts_below_custom_threshold() {
        let mut below_threshold = account_with_usage("below-threshold", 10.0, 90.0);
        below_threshold.auto_switch_threshold = 20.0;
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            below_threshold,
            account_with_usage("eligible", 30.0, 90.0),
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", false, true)
                .unwrap();

        assert_eq!(selected.id, "eligible");
    }
