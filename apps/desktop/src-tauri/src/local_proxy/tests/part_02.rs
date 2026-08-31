    #[test]
    fn quota_switch_uses_existing_usage_rule_when_custom_priorities_match() {
        let mut lower_usage = account_with_usage("lower-usage", 5.0, 1.0);
        lower_usage.auto_switch_priority = 3;
        let mut higher_usage = account_with_usage("higher-usage", 72.0, 99.0);
        higher_usage.auto_switch_priority = 3;
        let accounts = vec![
            account_with_usage("current", 0.0, 80.0),
            higher_usage,
            lower_usage,
        ];

        let selected =
            account_with_lowest_remaining_primary_quota(&accounts, "current", true, false, 0.0)
                .unwrap();

        assert_eq!(selected.id, "lower-usage");
    }

    #[test]
    fn provider_fallback_requires_every_backup_primary_quota_to_be_exhausted() {
        let exhausted = vec![
            account_with_usage("current", 0.0, 80.0),
            account_with_usage("backup-1", 0.0, 90.0),
            account_with_usage("backup-2", 0.0, 50.0),
        ];
        assert!(all_backup_accounts_have_exhausted_primary_quota(
            &exhausted, "current", false, 0.0
        ));

        let available = vec![
            account_with_usage("current", 0.0, 80.0),
            account_with_usage("backup-1", 0.0, 90.0),
            account_with_usage("available", 1.0, 0.0),
        ];
        assert!(!all_backup_accounts_have_exhausted_primary_quota(
            &available, "current", false, 0.0
        ));

        let mut unknown = account_with_usage("unknown", 0.0, 0.0);
        unknown.usage.error = Some("network error".to_string());
        assert!(!all_backup_accounts_have_exhausted_primary_quota(
            &[account_with_usage("current", 0.0, 80.0), unknown],
            "current", false, 0.0
        ));
    }

    #[test]
    fn provider_fallback_is_available_when_there_are_no_backup_accounts() {
        assert!(all_backup_accounts_have_exhausted_primary_quota(
            &[account_with_usage("current", 0.0, 80.0)],
            "current", false, 0.0
        ));
    }

    #[test]
    fn quota_exhaustion_detection_requires_official_codex_signal() {
        let quota_payload = UpstreamPayload {
            status: 429,
            content_type: Some("application/json".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(
                br#"{"error":{"type":"usage_limit_reached"}}"#.to_vec(),
            ),
            token_usage_account: None,
        };
        let transient_rate_limit = UpstreamPayload {
            status: 429,
            content_type: Some("application/json".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(
                br#"{"error":{"code":"rate_limit_exceeded","type":"tokens"}}"#.to_vec(),
            ),
            token_usage_account: None,
        };
        let quota_header_payload = UpstreamPayload {
            status: 429,
            content_type: Some("application/json".to_string()),
            response_headers: vec![(
                "x-codex-rate-limit-reached-type".to_string(),
                "workspace_member_usage_limit_reached".to_string(),
            )],
            body: UpstreamBody::Buffered(Vec::new()),
            token_usage_account: None,
        };
        let forbidden_payload = UpstreamPayload {
            status: 403,
            content_type: Some("application/json".to_string()),
            response_headers: Vec::new(),
            body: UpstreamBody::Buffered(
                br#"{"error":{"type":"usage_limit_reached"}}"#.to_vec(),
            ),
            token_usage_account: None,
        };

        assert!(is_official_quota_exhaustion(&quota_payload));
        assert!(is_official_quota_exhaustion(&quota_header_payload));
        assert!(!is_official_quota_exhaustion(&transient_rate_limit));
        assert!(!is_official_quota_exhaustion(&forbidden_payload));
    }

    #[test]
    fn transient_429_retries_without_triggering_quota_switch() {
        let mut request_count = 0;
        let switch_count = AtomicUsize::new(0);
        let mut elapsed = Duration::ZERO;

        let response = retry_upstream_request_with(
            Duration::from_secs(10),
            || {
                request_count += 1;
                let status = if request_count == 1 { 429 } else { 200 };
                let mut response = official_payload(status, 0);
                response.body = UpstreamBody::Buffered(
                    br#"{"error":{"code":"rate_limit_exceeded","type":"tokens"}}"#.to_vec(),
                );
                Ok(response)
            },
            |_, event| {
                if matches!(event, UpstreamQuotaEvent::Retry) {
                    switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                }
                false
            },
            |delay| {
                elapsed += delay;
                elapsed
            },
        )
        .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(request_count, 2);
        assert_eq!(switch_count.load(AtomicOrdering::SeqCst), 0);
    }

    #[test]
    fn concurrent_quota_responses_share_one_switch_and_all_retry() {
        const REQUEST_COUNT: usize = 8;

        let coordinator = Arc::new(AutoSwitchCoordinator::default());
        let observed_generation = coordinator.active_account_generation();
        let switch_count = Arc::new(AtomicUsize::new(0));
        let retry_count = Arc::new(AtomicUsize::new(0));
        let (switch_started_tx, switch_started_rx) = mpsc::channel();
        let (finish_switch_tx, finish_switch_rx) = mpsc::channel();
        let mut handles = vec![{
            let coordinator = coordinator.clone();
            let switch_count = switch_count.clone();
            let retry_count = retry_count.clone();
            thread::spawn(move || {
                let mut attempt = 0;
                retry_upstream_request_with(
                    Duration::from_secs(2),
                    || {
                        let response = if attempt == 0 {
                            official_payload(429, observed_generation)
                        } else {
                            retry_count.fetch_add(1, AtomicOrdering::SeqCst);
                            official_payload(200, observed_generation + 1)
                        };
                        attempt += 1;
                        Ok(response)
                    },
                    |response, _| {
                        let account = response.token_usage_account.as_ref().unwrap();
                        coordinator
                            .switch_or_wait(
                                account.active_account_generation,
                                account.auto_switch_attempt_generation,
                                &account.account_id,
                                || {
                                    switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                                    switch_started_tx.send(()).unwrap();
                                    finish_switch_rx
                                        .recv_timeout(Duration::from_secs(5))
                                        .unwrap();
                                    Ok(AutoSwitchAttempt::Switched)
                                },
                            )
                            .unwrap_or(false)
                    },
                    |_| Duration::from_secs(1),
                )
                .unwrap()
                .status
            })
        }];

        switch_started_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        let (waiter_entered_tx, waiter_entered_rx) = mpsc::channel();
        for _ in 1..REQUEST_COUNT {
            let coordinator = coordinator.clone();
            let switch_count = switch_count.clone();
            let retry_count = retry_count.clone();
            let waiter_entered_tx = waiter_entered_tx.clone();
            handles.push(thread::spawn(move || {
                let mut attempt = 0;
                retry_upstream_request_with(
                    Duration::from_secs(2),
                    || {
                        let response = if attempt == 0 {
                            official_payload(429, observed_generation)
                        } else {
                            retry_count.fetch_add(1, AtomicOrdering::SeqCst);
                            official_payload(200, observed_generation + 1)
                        };
                        attempt += 1;
                        Ok(response)
                    },
                    |response, _| {
                        let account = response.token_usage_account.as_ref().unwrap();
                        coordinator
                            .switch_or_wait_with_waiter_hook(
                                account.active_account_generation,
                                account.auto_switch_attempt_generation,
                                &account.account_id,
                                || {
                                    switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                                    Ok(AutoSwitchAttempt::Switched)
                                },
                                || waiter_entered_tx.send(()).unwrap(),
                            )
                            .unwrap_or(false)
                    },
                    |_| Duration::from_secs(1),
                )
                .unwrap()
                .status
            }));
        }

        for _ in 1..REQUEST_COUNT {
            waiter_entered_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
        finish_switch_tx.send(()).unwrap();

        let statuses = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert!(statuses.iter().all(|status| *status == 200));
        assert_eq!(switch_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(retry_count.load(AtomicOrdering::SeqCst), REQUEST_COUNT);
        assert_eq!(coordinator.active_account_generation(), 1);
    }

    #[test]
    fn quota_waiter_does_not_take_over_when_leader_does_not_switch() {
        let coordinator = Arc::new(AutoSwitchCoordinator::default());
        let observed_generation = coordinator.active_account_generation();
        let follower_switch_count = Arc::new(AtomicUsize::new(0));
        let (leader_started_tx, leader_started_rx) = mpsc::channel();
        let (finish_leader_tx, finish_leader_rx) = mpsc::channel();

        let leader = {
            let coordinator = coordinator.clone();
            thread::spawn(move || {
                coordinator.switch_or_wait(observed_generation, 0, "current", || {
                    leader_started_tx.send(()).unwrap();
                    finish_leader_rx
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap();
                    Ok(AutoSwitchAttempt::Unchanged)
                })
            })
        };
        leader_started_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();

        let (waiter_entered_tx, waiter_entered_rx) = mpsc::channel();
        let follower = {
            let coordinator = coordinator.clone();
            let follower_switch_count = follower_switch_count.clone();
            thread::spawn(move || {
                coordinator.switch_or_wait_with_waiter_hook(
                    observed_generation,
                    0,
                    "current",
                    || {
                        follower_switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                        Ok(AutoSwitchAttempt::Switched)
                    },
                    || waiter_entered_tx.send(()).unwrap(),
                )
            })
        };
        waiter_entered_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        finish_leader_tx.send(()).unwrap();

        assert!(!leader.join().unwrap().unwrap());
        assert!(!follower.join().unwrap().unwrap());
        assert_eq!(follower_switch_count.load(AtomicOrdering::SeqCst), 0);
        assert_eq!(coordinator.active_account_generation(), 0);
    }

    #[test]
    fn already_changed_account_does_not_advance_automatic_generation() {
        let coordinator = AutoSwitchCoordinator::default();
        let observed_generation = coordinator.active_account_generation();

        assert!(coordinator
            .switch_or_wait(observed_generation, 0, "old", || {
                Ok(AutoSwitchAttempt::AlreadyChanged)
            })
            .unwrap());
        assert_eq!(coordinator.active_account_generation(), observed_generation);

        let switch_count = AtomicUsize::new(0);
        assert!(coordinator
            .switch_or_wait(observed_generation, 0, "current", || {
                switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                Ok(AutoSwitchAttempt::Switched)
            })
            .unwrap());
        assert_eq!(switch_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(coordinator.active_account_generation(), 1);
    }

    #[test]
    fn poisoned_switch_coordinator_keeps_official_snapshots_available() {
        let coordinator = Arc::new(AutoSwitchCoordinator::default());
        let poisoning_coordinator = coordinator.clone();
        assert!(thread::spawn(move || {
            let _state = poisoning_coordinator.state.lock().unwrap();
            panic!("poison automatic switch state for recovery test");
        })
        .join()
        .is_err());

        let (generation, attempt_generation, account_id) = coordinator
            .account_snapshot(|| Ok::<_, String>("current".to_string()))
            .unwrap();
        assert_eq!(generation, 1);
        assert_eq!(attempt_generation, 1);
        assert_eq!(account_id, "current");

        assert!(coordinator
            .switch_or_wait(generation, attempt_generation, &account_id, || {
                Ok(AutoSwitchAttempt::Switched)
            })
            .unwrap());
        assert_eq!(coordinator.active_account_generation(), 2);
    }

    #[test]
    fn delayed_quota_response_uses_its_original_generation() {
        let coordinator = AutoSwitchCoordinator::default();
        let observed_generation = coordinator.active_account_generation();
        assert!(coordinator
            .switch_or_wait(observed_generation, 0, "current", || {
                Ok(AutoSwitchAttempt::Switched)
            })
            .unwrap());

        let second_switch_count = AtomicUsize::new(0);
        let retry_count = AtomicUsize::new(0);
        let mut attempt = 0;
        let response = retry_upstream_request_with(
            Duration::from_secs(2),
            || {
                let response = if attempt == 0 {
                    official_payload(429, observed_generation)
                } else {
                    retry_count.fetch_add(1, AtomicOrdering::SeqCst);
                    official_payload(200, observed_generation + 1)
                };
                attempt += 1;
                Ok(response)
            },
            |response, _| {
                let account = response.token_usage_account.as_ref().unwrap();
                coordinator
                    .switch_or_wait(
                        account.active_account_generation,
                        account.auto_switch_attempt_generation,
                        &account.account_id,
                        || {
                            second_switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                            Ok(AutoSwitchAttempt::Switched)
                        },
                    )
                    .unwrap_or(false)
            },
            |_| Duration::from_secs(1),
        )
        .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(second_switch_count.load(AtomicOrdering::SeqCst), 0);
        assert_eq!(retry_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(coordinator.active_account_generation(), 1);
    }

    #[test]
    fn retry_timeout_returns_the_last_429_response() {
        let switch_count = AtomicUsize::new(0);
        let timeout_count = AtomicUsize::new(0);
        let request_count = AtomicUsize::new(0);
        let mut elapsed = Duration::ZERO;

        let response = retry_upstream_request_with(
            Duration::from_secs(2),
            || {
                request_count.fetch_add(1, AtomicOrdering::SeqCst);
                Ok(official_payload(429, 0))
            },
            |_, event| {
                match event {
                    UpstreamQuotaEvent::Retry => {
                        switch_count.fetch_add(1, AtomicOrdering::SeqCst);
                    }
                    UpstreamQuotaEvent::RetryTimedOut => {
                        timeout_count.fetch_add(1, AtomicOrdering::SeqCst);
                    }
                }
                true
            },
            |delay| {
                elapsed += delay;
                elapsed
            },
        )
        .unwrap();

        assert_eq!(response.status, 429);
        assert_eq!(switch_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(timeout_count.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(request_count.load(AtomicOrdering::SeqCst), 2);
    }

    #[test]
    fn final_429_selects_the_failed_account_for_automatic_disabling() {
        let response = official_payload(429, 0);
        let mut state = ManagerStateFile {
            auto_switch_on_quota_exhaustion: true,
            auto_disable_unreachable_accounts: true,
            ..ManagerStateFile::default()
        };
        let mut settings = AppSettings::default();

        assert_eq!(
            account_to_disable_after_429_timeout(&response, &state, &settings),
            Some("current")
        );

        settings.auto_disable_status_codes.retain(|status| *status != 429);
        assert!(account_to_disable_after_429_timeout(&response, &state, &settings).is_none());

        settings.auto_disable_status_codes.push(429);
        state.auto_disable_unreachable_accounts = false;
        assert!(account_to_disable_after_429_timeout(&response, &state, &settings).is_none());
    }

    #[test]
    fn progressive_429_delays_hide_intermediate_responses() {
        let request_count = AtomicUsize::new(0);
        let mut delays = Vec::new();
        let mut elapsed = Duration::ZERO;
        let response = retry_upstream_request_with(
            Duration::from_secs(10),
            || {
                let attempt = request_count.fetch_add(1, AtomicOrdering::SeqCst);
                Ok(official_payload(if attempt < 3 { 429 } else { 200 }, 0))
            },
            |_, _| false,
            |delay| {
                delays.push(delay.as_secs());
                elapsed += delay;
                elapsed
            },
        )
        .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(request_count.load(AtomicOrdering::SeqCst), 4);
        assert_eq!(delays, [1, 3, 5]);
    }

    #[test]
    fn upstream_url_avoids_duplicate_v1() {
        assert_eq!(
            build_upstream_url("https://api.example.com/v1", "/v1/responses"),
            "https://api.example.com/v1/responses"
        );
        assert_eq!(
            build_upstream_url("https://api.example.com", "/responses"),
            "https://api.example.com/v1/responses"
        );
    }

    #[test]
    fn upstream_url_supports_provider_versioned_base_paths() {
        assert_eq!(
            build_upstream_url(
                "https://ark.cn-beijing.volces.com/api/plan/v3",
                "/v1/responses"
            ),
            "https://ark.cn-beijing.volces.com/api/plan/v3/responses"
        );
        assert_eq!(
            build_upstream_url(
                "https://ark.cn-beijing.volces.com/api/coding/v3",
                "/v1/models"
            ),
            "https://ark.cn-beijing.volces.com/api/coding/v3/models"
        );
    }

    #[test]
    fn codex_response_endpoint_variants_normalize_for_upstream() {
        assert_eq!(
            upstream_endpoint_for_codex_request("/v1/v1/responses?foo=bar"),
            "/v1/responses?foo=bar"
        );
        assert_eq!(
            upstream_endpoint_for_codex_request("/codex/v1/responses"),
            "/v1/responses"
        );
        assert_eq!(
            upstream_endpoint_for_codex_request("/codex/v1/responses/compact?foo=bar"),
            "/v1/responses/compact?foo=bar"
        );
        assert!(is_responses_endpoint("/v1/v1/responses"));
        assert!(is_responses_endpoint("/codex/v1/responses/compact"));
    }

    #[test]
    fn image_endpoints_use_the_image_generation_credential_purpose() {
        assert!(is_image_generation_endpoint("/images/generations"));
        assert!(is_image_generation_endpoint("/v1/images/generations"));
        assert!(is_image_generation_endpoint("/v1/images/edits"));
        assert!(is_image_generation_endpoint("/codex/v1/images/edits"));
        assert!(!is_image_generation_endpoint("/v1/responses"));
    }
