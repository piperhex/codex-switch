use super::*;
use crate::codex_gui::releases::store::tests::Fixture;

fn snapshot_at(root: &std::path::Path) -> CliStatus {
    store::status(root).unwrap()
}

fn installed_fixture() -> Fixture {
    let fixture = Fixture::new();
    fixture.remember("0.99.0");
    fixture.package("0.99.0");
    store::activate(&fixture.0).unwrap();
    fixture
}

#[test]
fn completed_download_is_eligible_in_the_same_cycle() {
    assert_eq!(CHECK_INTERVAL, Duration::from_secs(1800));
    let fixture = installed_fixture();
    fixture.remember("0.100.0");
    assert!(eligible_version(&snapshot_at(&fixture.0)).is_none());
    fixture.package("0.100.0");
    let ready = snapshot_at(&fixture.0);
    let expected = eligible_version(&ready).unwrap();
    assert_eq!(expected, "0.100.0");
    assert_eq!(
        store::activate_expected(&fixture.0, expected)
            .unwrap()
            .unwrap()
            .version
            .as_deref(),
        Some("0.100.0")
    );
    assert!(eligible_version(&snapshot_at(&fixture.0)).is_none());
}

#[test]
fn cached_download_can_still_be_applied_on_offline_restart() {
    let fixture = installed_fixture();
    fixture.remember("0.100.0");
    fixture.package("0.100.0");
    assert_eq!(eligible_version(&snapshot_at(&fixture.0)), Some("0.100.0"));
    assert_eq!(
        store::installed(&fixture.0).unwrap().version.as_deref(),
        Some("0.99.0")
    );
    assert_eq!(
        store::activate(&fixture.0).unwrap().version.as_deref(),
        Some("0.100.0")
    );
}

#[test]
fn background_download_does_not_opt_into_first_installation() {
    let fixture = Fixture::new();
    fixture.remember("0.100.0");
    fixture.package("0.100.0");
    assert!(eligible_version(&snapshot_at(&fixture.0)).is_none());
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
    let expected = eligible_version(&earlier).unwrap();
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
