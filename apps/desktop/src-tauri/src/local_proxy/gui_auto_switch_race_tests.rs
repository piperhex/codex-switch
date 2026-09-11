use super::*;

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
