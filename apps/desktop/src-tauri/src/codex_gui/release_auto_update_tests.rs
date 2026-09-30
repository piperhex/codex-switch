use super::*;
use crate::codex_gui::releases::store::tests::Fixture;

fn snapshot_at(root: &std::path::Path) -> Snapshot {
    Snapshot {
        version: store::installed(root).unwrap().version,
        release: store::pending(root).unwrap(),
    }
}

fn installed_fixture() -> Fixture {
    let fixture = Fixture::new();
    fixture.remember("0.99.0");
    fixture.package("0.99.0");
    store::activate(&fixture.0).unwrap();
    fixture
}

#[test]
fn download_waits_for_the_next_cycle_and_restart_can_apply_it_offline() {
    assert_eq!(CHECK_INTERVAL, Duration::from_secs(1800));
    let fixture = installed_fixture();
    fixture.remember("0.100.0");
    let before = snapshot_at(&fixture.0);
    fixture.package("0.100.0");
    assert!(eligible_version(&before, true).is_none());
    let next = snapshot_at(&fixture.0);
    assert!(eligible_version(&next, false).is_none());
    assert_eq!(eligible_version(&next, true), Some("0.100.0"));
    assert_eq!(
        store::activate(&fixture.0).unwrap().version.as_deref(),
        Some("0.100.0")
    );
    assert!(eligible_version(&snapshot_at(&fixture.0), true).is_none());
}

#[test]
fn later_cycle_activates_only_the_same_complete_candidate() {
    let fixture = installed_fixture();
    fixture.remember("0.100.0");
    assert!(store::activate_expected(&fixture.0, "0.100.0")
        .unwrap()
        .is_none());
    fixture.package("0.100.0");
    let earlier = snapshot_at(&fixture.0);
    fixture.remember("0.101.0");
    let expected = eligible_version(&earlier, true).unwrap();
    assert!(store::activate_expected(&fixture.0, expected)
        .unwrap()
        .is_none());
    assert_eq!(
        store::installed(&fixture.0).unwrap().version.as_deref(),
        Some("0.99.0")
    );
    fixture.package("0.101.0");
    assert_eq!(
        store::activate_expected(&fixture.0, "0.101.0")
            .unwrap()
            .unwrap()
            .version
            .as_deref(),
        Some("0.101.0")
    );
}
