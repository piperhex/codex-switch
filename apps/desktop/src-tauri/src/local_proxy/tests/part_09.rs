fn concurrent_priority_test_paths() -> (PathBuf, Paths) {
    let root = std::env::temp_dir().join(format!(
        "codex-switch-concurrent-priority-test-{}",
        uuid::Uuid::new_v4()
    ));
    let paths = Paths {
        current_auth: root.join("codex-home/auth.json"),
        current_config: root.join("codex-home/config.toml"),
        codex_home: root.join("codex-home"),
        accounts: root.join("app-data/accounts"),
        providers: root.join("app-data/providers"),
        config_backup: root.join("app-data/config-before-provider.toml"),
        state_file: root.join("app-data/state.json"),
    };
    (root, paths)
}

fn add_concurrent_priority_test_account(paths: &Paths, id: &str, priority: i32) {
    fs::create_dir_all(account_dir(paths, id)).unwrap();
    fs::write(managed_auth_path(paths, id), b"{}").unwrap();
    crate::storage::save_auto_switch_priority(&auto_switch_priority_path(paths, id), priority)
        .unwrap();
}

#[test]
fn concurrent_routing_prefers_the_highest_available_priority_tier() {
    let (root, paths) = concurrent_priority_test_paths();
    add_concurrent_priority_test_account(&paths, "account-c", 3);
    add_concurrent_priority_test_account(&paths, "account-b", -1);
    add_concurrent_priority_test_account(&paths, "account-a", -1);
    let state = ManagerStateFile {
        concurrent_account_routing_enabled: true,
        auto_switch_on_quota_exhaustion: true,
        custom_auto_switch_priority_enabled: true,
        ..ManagerStateFile::default()
    };

    let eligible = available_concurrent_account_ids(&paths, &state).unwrap();
    let preferred = preferred_concurrent_account_ids(&paths, &state, &eligible);

    assert_eq!(
        eligible,
        vec![
            "account-a".to_string(),
            "account-b".to_string(),
            "account-c".to_string()
        ]
    );
    assert_eq!(
        preferred,
        vec!["account-a".to_string(), "account-b".to_string()]
    );
    let mut router = ConcurrentAccountRouter::default();
    for (session, expected) in [("1", "account-a"), ("2", "account-b"), ("3", "account-a")] {
        assert_eq!(
            router
                .account_for_session(session, &eligible, &preferred)
                .as_deref(),
            Some(expected)
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_router_keeps_eligible_sessions_sticky_across_priority_changes() {
    let mut router = ConcurrentAccountRouter::default();
    let eligible = vec!["account-a".to_string(), "account-b".to_string()];
    assert_eq!(
        router
            .account_for_session("existing", &eligible, &eligible)
            .as_deref(),
        Some("account-a")
    );
    let preferred = vec!["account-b".to_string()];

    assert_eq!(
        router
            .account_for_session("existing", &eligible, &preferred)
            .as_deref(),
        Some("account-a")
    );
    assert_eq!(
        router
            .account_for_session("new", &eligible, &preferred)
            .as_deref(),
        Some("account-b")
    );
    assert_eq!(
        router
            .account_for_session("existing", &preferred, &preferred)
            .as_deref(),
        Some("account-b")
    );
}

fn enabled_concurrent_priority_state() -> ManagerStateFile {
    ManagerStateFile {
        concurrent_account_routing_enabled: true,
        auto_switch_on_quota_exhaustion: true,
        custom_auto_switch_priority_enabled: true,
        ..ManagerStateFile::default()
    }
}

#[test]
fn concurrent_priority_falls_back_after_quota_or_threshold_filtering() {
    let (root, paths) = concurrent_priority_test_paths();
    add_concurrent_priority_test_account(&paths, "preferred", -1);
    add_concurrent_priority_test_account(&paths, "backup", 4);
    let mut state = enabled_concurrent_priority_state();
    for (remaining, threshold) in [(0.0, None), (10.0, Some(20.0))] {
        crate::storage::save_usage(
            &usage_path(&paths, "preferred"),
            &account_with_usage("preferred", remaining, 80.0).usage,
        )
        .unwrap();
        crate::storage::save_usage(
            &usage_path(&paths, "backup"),
            &account_with_usage("backup", 80.0, 80.0).usage,
        )
        .unwrap();
        state.custom_auto_switch_threshold_enabled = threshold.is_some();
        state.global_auto_switch_threshold = threshold.unwrap_or_default();
        assert_eq!(
            concurrent_account_for_session(&paths, &state, None)
                .unwrap()
                .as_deref(),
            Some("backup")
        );
    }
    state.disabled_account_ids = vec!["backup".to_string()];
    assert!(concurrent_account_for_session(&paths, &state, None).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_priority_respects_group_and_disabled_accounts() {
    let (root, paths) = concurrent_priority_test_paths();
    for (id, priority) in [("other-group", -10), ("disabled", -5), ("eligible", 2)] {
        add_concurrent_priority_test_account(&paths, id, priority);
    }
    for id in ["disabled", "eligible"] {
        save_account_group(&account_group_path(&paths, id), "Work").unwrap();
    }
    let mut state = enabled_concurrent_priority_state();
    state.concurrent_account_group = Some("Work".to_string());
    state.disabled_account_ids = vec!["disabled".to_string()];
    assert_eq!(
        concurrent_account_for_session(&paths, &state, None)
            .unwrap()
            .as_deref(),
        Some("eligible")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_priority_changes_apply_to_the_next_request_without_a_restart() {
    let (root, paths) = concurrent_priority_test_paths();
    add_concurrent_priority_test_account(&paths, "account-a", 9);
    add_concurrent_priority_test_account(&paths, "account-b", -1);
    let mut state = enabled_concurrent_priority_state();
    assert_eq!(
        concurrent_account_for_session(&paths, &state, None)
            .unwrap()
            .as_deref(),
        Some("account-b")
    );
    add_concurrent_priority_test_account(&paths, "account-a", -2);
    assert_eq!(
        concurrent_account_for_session(&paths, &state, None)
            .unwrap()
            .as_deref(),
        Some("account-a")
    );
    let eligible = available_concurrent_account_ids(&paths, &state).unwrap();
    state.custom_auto_switch_priority_enabled = false;
    assert_eq!(
        preferred_concurrent_account_ids(&paths, &state, &eligible),
        eligible
    );
    state.custom_auto_switch_priority_enabled = true;
    state.auto_switch_on_quota_exhaustion = false;
    assert_eq!(
        preferred_concurrent_account_ids(&paths, &state, &eligible),
        eligible
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_priority_defaults_missing_values_to_zero() {
    let (root, paths) = concurrent_priority_test_paths();
    add_concurrent_priority_test_account(&paths, "configured", 2);
    fs::create_dir_all(account_dir(&paths, "default")).unwrap();
    fs::write(managed_auth_path(&paths, "default"), b"{}").unwrap();
    assert_eq!(
        concurrent_account_for_session(&paths, &enabled_concurrent_priority_state(), None)
            .unwrap()
            .as_deref(),
        Some("default")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_image_fallback_uses_priorities_after_the_selected_image_account() {
    let (root, paths) = concurrent_priority_test_paths();
    for (id, priority) in [("account-a", 9), ("account-b", -1), ("account-c", -1)] {
        add_concurrent_priority_test_account(&paths, id, priority);
    }
    let mut state = enabled_concurrent_priority_state();
    let account_ids = image_failover_account_ids(&paths, &state).unwrap();
    assert_eq!(account_ids, ["account-b", "account-c", "account-a"]);
    let ordered = ordered_image_account_ids(Some("selected".to_string()), account_ids);
    let mut pool = ImageAccountPool::new(ordered).unwrap();
    assert_eq!(pool.current_account_id(), "selected");
    assert_eq!(pool.advance_after_429("selected"), Some("account-b"));
    assert_eq!(pool.advance_after_429("account-b"), Some("account-c"));
    assert_eq!(pool.advance_after_429("account-c"), Some("account-a"));
    state.custom_auto_switch_priority_enabled = false;
    assert_eq!(
        image_failover_account_ids(&paths, &state).unwrap(),
        ["account-a", "account-b", "account-c"]
    );
    state.custom_auto_switch_priority_enabled = true;
    state.concurrent_account_routing_enabled = false;
    assert_eq!(
        image_failover_account_ids(&paths, &state).unwrap(),
        ["account-a", "account-b", "account-c"]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn simultaneous_conversations_balance_only_within_the_preferred_priority_tier() {
    let router = Mutex::new(ConcurrentAccountRouter::default());
    let eligible = vec![
        "account-a".to_string(),
        "account-b".to_string(),
        "backup".to_string(),
    ];
    let preferred = &eligible[..2];
    const CONVERSATION_COUNT: usize = 20;
    thread::scope(|scope| {
        for index in 0..CONVERSATION_COUNT {
            let router = &router;
            let eligible = &eligible;
            scope.spawn(move || {
                let session = format!("thread-{index}");
                let assigned = router
                    .lock()
                    .unwrap()
                    .account_for_session(&session, eligible, preferred)
                    .unwrap();
                assert!(preferred.contains(&assigned));
                assert_eq!(
                    router
                        .lock()
                        .unwrap()
                        .account_for_session(&session, eligible, preferred),
                    Some(assigned)
                );
            });
        }
    });
    let router = router.into_inner().unwrap();
    for account_id in preferred {
        assert_eq!(
            router
                .assignments
                .values()
                .filter(|id| *id == account_id)
                .count(),
            CONVERSATION_COUNT / preferred.len()
        );
    }
}
