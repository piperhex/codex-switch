use super::*;
use std::sync::{Arc, Barrier};

fn cached_usage(fetched_at: DateTime<Utc>) -> UsageSummary {
    UsageSummary {
        fetched_at: Some(fetched_at.to_rfc3339()),
        ..UsageSummary::default()
    }
}

#[test]
fn refreshes_missing_expired_and_invalid_timestamps() {
    let now = Utc::now();
    assert!(usage_needs_refresh(&UsageSummary::default(), now));
    let invalid = UsageSummary {
        fetched_at: Some("invalid".to_string()),
        ..UsageSummary::default()
    };
    assert!(usage_needs_refresh(&invalid, now));
    assert!(usage_needs_refresh(
        &cached_usage(now - chrono::Duration::seconds(30)),
        now,
    ));
    assert!(usage_needs_refresh(
        &cached_usage(now + chrono::Duration::seconds(1)),
        now,
    ));
}

#[test]
fn reuses_fresh_quotas_and_backs_off_after_a_failed_refresh() {
    let now = Utc::now();
    let mut usage = cached_usage(now - chrono::Duration::seconds(29));
    assert!(!usage_needs_refresh(&usage, now));
    usage.error = Some("Network timeout".to_string());
    assert!(!usage_needs_refresh(&usage, now));
}

#[test]
fn refresh_permit_remains_single_flight_even_after_the_check_interval() {
    let state = Arc::new(Mutex::new(RefreshState::new()));
    let acquired = Arc::new(Barrier::new(2));
    let finished = Arc::new(Barrier::new(2));
    let now = Instant::now();
    thread::scope(|scope| {
        let worker_state = Arc::clone(&state);
        let worker_acquired = Arc::clone(&acquired);
        let worker_finished = Arc::clone(&finished);
        scope.spawn(move || {
            let _permit = RefreshPermit::acquire(&worker_state, now).unwrap();
            worker_acquired.wait();
            worker_finished.wait();
        });
        acquired.wait();
        assert!(RefreshPermit::acquire(&state, now + CHECK_INTERVAL).is_none());
        finished.wait();
    });
    assert!(RefreshPermit::acquire(&state, now + CHECK_INTERVAL).is_some());
}

#[test]
fn finished_refreshes_are_throttled_and_busy_locks_are_skipped() {
    let state = Mutex::new(RefreshState::new());
    let now = Instant::now();
    drop(RefreshPermit::acquire(&state, now).unwrap());
    assert!(RefreshPermit::acquire(&state, now + CHECK_INTERVAL / 2).is_none());
    let _guard = state.lock().unwrap();
    assert!(RefreshPermit::acquire(&state, now + CHECK_INTERVAL).is_none());
}
