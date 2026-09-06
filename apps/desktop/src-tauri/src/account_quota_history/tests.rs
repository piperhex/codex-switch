use super::*;
use crate::models::UsageWindow;
use rusqlite::Connection;

const START_TS: i64 = 1_700_000_000;

fn usage(remaining: f64) -> UsageSummary {
    UsageSummary {
        fetched_at: Some("2023-11-14T22:13:20Z".to_string()),
        primary: Some(UsageWindow {
            used_percent: 100.0 - remaining,
            remaining_percent: remaining,
            resets_at: Some(START_TS + 3_600),
            window_minutes: Some(300),
        }),
        ..UsageSummary::default()
    }
}

fn point(ts: i64, remaining: f64) -> AccountQuotaPoint {
    AccountQuotaPoint {
        ts,
        ..observed_point(&usage(remaining)).unwrap()
    }
}

fn accounts() -> BTreeMap<String, AccountQuotaHistory> {
    ["first", "second", "empty"]
        .into_iter()
        .map(|id| {
            (
                id.to_string(),
                AccountQuotaHistory {
                    account_id: id.to_string(),
                    account_label: format!("{id}@example.test"),
                    points: Vec::new(),
                },
            )
        })
        .collect()
}

#[test]
fn failed_missing_and_invalid_observations_are_not_recorded() {
    let mut failed = usage(70.0);
    failed.error = Some("network unavailable".to_string());
    assert!(observed_point(&failed).is_none());
    assert!(observed_point(&UsageSummary::default()).is_none());
    assert!(observed_point(&usage(f64::NAN)).is_none());
    assert!(observed_point(&usage(120.0)).is_none());
    failed.error = None;
    failed.fetched_at = Some("not-a-time".to_string());
    assert!(observed_point(&failed).is_none());
    assert_eq!(
        observed_point(&usage(0.0))
            .unwrap()
            .primary_remaining_percent,
        Some(0.0)
    );
}

#[test]
fn range_includes_only_latest_baseline_and_preserves_account_isolation() {
    let connection = Connection::open_in_memory().unwrap();
    database::initialize(&connection).unwrap();
    for (ts, remaining) in [(1, 95.0), (10, 90.0), (20, 80.0), (30, 60.0)] {
        database::insert(&connection, "first", &point(ts, remaining)).unwrap();
    }
    database::insert(&connection, "second", &point(15, 25.0)).unwrap();
    database::insert(&connection, "deleted", &point(20, 10.0)).unwrap();
    let mut accounts = accounts();
    database::append_points(
        &connection,
        &mut accounts,
        HistoryRange::new(20, 25).unwrap(),
    )
    .unwrap();
    assert_eq!(
        accounts["first"].points,
        vec![point(10, 90.0), point(20, 80.0)]
    );
    assert_eq!(accounts["second"].points, vec![point(15, 25.0)]);
    assert!(accounts["empty"].points.is_empty());
    assert_eq!(accounts.len(), 3);
}

#[test]
fn repeated_timestamps_update_and_reset_metadata_survives_readback() {
    let connection = Connection::open_in_memory().unwrap();
    database::initialize(&connection).unwrap();
    database::insert(&connection, "first", &point(10, 50.0)).unwrap();
    database::insert(&connection, "first", &point(10, 45.0)).unwrap();
    let reset = AccountQuotaPoint {
        primary_reset_at: Some(START_TS + 7_200),
        secondary_remaining_percent: Some(60.0),
        secondary_reset_at: Some(START_TS + 604_800),
        ..point(20, 100.0)
    };
    database::insert(&connection, "first", &reset).unwrap();
    let mut accounts = accounts();
    database::append_points(
        &connection,
        &mut accounts,
        HistoryRange::new(0, 20).unwrap(),
    )
    .unwrap();
    assert_eq!(accounts["first"].points, vec![point(10, 45.0), reset]);
}

#[test]
fn one_valid_window_is_preserved_when_the_other_is_unavailable() {
    let mut summary = usage(f64::INFINITY);
    summary.secondary = usage(42.0).primary;
    let observed = observed_point(&summary).unwrap();
    assert_eq!(observed.primary_remaining_percent, None);
    assert_eq!(observed.primary_reset_at, None);
    assert_eq!(observed.secondary_remaining_percent, Some(42.0));
}

#[test]
fn rejects_negative_and_reversed_time_ranges() {
    assert!(HistoryRange::new(-1, 0).is_err());
    assert!(HistoryRange::new(20, 10).is_err());
    assert!(HistoryRange::new(10, 10).is_ok());
}
