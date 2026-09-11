use super::*;

#[test]
fn retry_history_excludes_recovered_accounts_only_for_the_failing_request() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Concurrent);
    let first = fixture.managed_account("recovered-account", 10.0);
    let second = fixture.managed_account("next-failure", 40.0);
    let third = fixture.managed_account("healthy-account", 70.0);
    fixture.select(&first);
    let mut failed = HashSet::from([first.clone()]);
    let mut next = after_quota(
        fixture.app.handle(),
        &fixture.route(),
        Some("retry"),
        &failed,
    )
    .unwrap()
    .unwrap();
    assert_eq!(next.selection, account(&second));

    with_routing(fixture.app.handle(), &next, |state| {
        state.exhausted.remove(&first);
        state.recovered.insert(first.clone(), Instant::now());
    })
    .unwrap();
    next.begin_attempt();
    failed.insert(second.clone());
    let last = after_quota(fixture.app.handle(), &next, Some("retry"), &failed)
        .unwrap()
        .unwrap();
    assert_eq!(last.selection, account(&third));
    with_routing(fixture.app.handle(), &last, |state| {
        assert!(!state.exhausted.contains_key(&first));
        assert!(state.exhausted.contains_key(&second));
    })
    .unwrap();

    let fresh = prepare(fixture.app.handle(), Some("fresh")).unwrap();
    assert_eq!(fresh.selection, account(&first));
    fixture.assert_shared_unchanged();
}

#[test]
fn a_new_quota_failure_replaces_the_observation_used_by_an_inflight_recovery() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Concurrent);
    let route = fixture.route();
    let old_observation = Instant::now() - Duration::from_secs(1);
    with_routing(fixture.app.handle(), &route, |state| {
        state.exhausted.insert(
            "gui-a".into(),
            Exhaustion {
                observed_at: old_observation,
                next_check_at: Instant::now(),
            },
        );
    })
    .unwrap();

    assert!(remember_exhaustion(fixture.app.handle(), &route).unwrap());
    with_routing(fixture.app.handle(), &route, |state| {
        let failure = state.exhausted.get("gui-a").unwrap();
        assert!(failure.observed_at > old_observation);
        assert_eq!(
            failure.next_check_at,
            failure.observed_at + EXHAUSTED_COOLDOWN
        );
    })
    .unwrap();
}

#[test]
fn late_quota_response_reuses_a_completed_gui_switch_without_switching_again() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    let current = fixture.managed_account("failed-account", 90.0);
    let backup = fixture.managed_account("healthy-account", 50.0);
    fixture.select(&current);
    let first = fixture.route();
    let late = first.clone();
    let failed = HashSet::from([current]);

    let completed = after_quota(fixture.app.handle(), &first, Some("first"), &failed)
        .unwrap()
        .unwrap();
    let reused = after_quota(fixture.app.handle(), &late, Some("late"), &failed)
        .unwrap()
        .unwrap();

    assert_eq!(completed.selection, account(&backup));
    assert_eq!(reused.selection, completed.selection);
    assert_eq!(reused.seed.revision, completed.seed.revision);
    assert_eq!(fixture.route().seed.revision, completed.seed.revision);
    fixture.assert_selection(&backup);
    fixture.assert_shared_unchanged();
}

#[test]
fn late_quota_response_respects_manual_reselection_and_a_to_b_to_a_switches() {
    for select_another_first in [false, true] {
        let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
        let current = fixture.managed_account("reselected-account", 90.0);
        let backup = fixture.managed_account("healthy-account", 50.0);
        fixture.select(&current);
        let stale = fixture.route();
        if select_another_first {
            fixture.select(&backup);
        }
        let manual = fixture.select(&current);
        let failed = HashSet::from([current.clone()]);

        let next = after_quota(fixture.app.handle(), &stale, Some("late"), &failed).unwrap();
        assert!(next.is_none());
        assert_eq!(fixture.route().seed.revision, manual.revision);
        fixture.assert_selection(&current);
        fixture.assert_shared_unchanged();
    }
}

#[test]
fn recovered_account_ignores_old_failure_but_rotates_after_a_new_attempt_fails() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Concurrent);
    let current = fixture.managed_account("recovered-account", 90.0);
    let backup = fixture.managed_account("healthy-account", 50.0);
    fixture.select(&current);
    let mut route = fixture.route();
    route.attempt_started_at = Instant::now() - Duration::from_secs(1);
    let recovered_at = Instant::now();
    with_routing(fixture.app.handle(), &route, |state| {
        state.recovered.insert(current.clone(), recovered_at);
    })
    .unwrap();
    let failed = HashSet::from([current.clone()]);

    let old_failure = after_quota(fixture.app.handle(), &route, Some("session"), &failed).unwrap();
    assert!(old_failure.is_none());
    assert!(with_routing(fixture.app.handle(), &route, |state| {
        !state.exhausted.contains_key(&current)
            && state.recovered.get(&current) == Some(&recovered_at)
    })
    .unwrap());
    assert_eq!(fixture.route().seed.revision, route.seed.revision);
    fixture.assert_selection(&current);

    route.begin_attempt();
    assert!(route.attempt_started_at >= recovered_at);
    let next = after_quota(fixture.app.handle(), &route, Some("session"), &failed)
        .unwrap()
        .unwrap();
    assert_eq!(next.selection, account(&backup));
    assert!(with_routing(fixture.app.handle(), &next, |state| {
        state.exhausted.contains_key(&current)
    })
    .unwrap());
    assert_eq!(fixture.route().seed.revision, route.seed.revision);
    fixture.assert_selection(&current);
    fixture.assert_shared_unchanged();
}
