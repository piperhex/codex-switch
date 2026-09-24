use super::super::store::tests::Fixture;
use super::*;

#[test]
fn newer_release_discovered_during_download_wins_manual_activation() {
    let fixture = Fixture::new();
    fixture.remember("0.100.0");
    let metadata = Mutex::new(());
    let mut downloads = Vec::new();
    let result = prepare_latest(&fixture.0, &metadata, true, |candidate| {
        let _guard = metadata
            .try_lock()
            .expect("network work must not hold metadata locks");
        downloads.push(candidate.version.clone());
        if candidate.version == "0.100.0" {
            fixture.remember("0.101.0");
        }
        fixture.package(&candidate.version);
        assert!(store::installed(&fixture.0)?.version.is_none());
        Ok(())
    })
    .unwrap();
    assert_eq!(downloads, ["0.100.0", "0.101.0"]);
    assert_eq!(result.version, "0.101.0");
    assert!(result.ready);
    assert_eq!(
        store::installed(&fixture.0).unwrap().version.as_deref(),
        Some("0.101.0")
    );
}

#[test]
fn failed_obsolete_download_is_skipped_and_background_download_does_not_activate() {
    let fixture = Fixture::new();
    fixture.remember("0.100.0");
    let result = prepare_latest(&fixture.0, &Mutex::new(()), false, |candidate| {
        if candidate.version == "0.100.0" {
            fixture.remember("0.101.0");
            return Err(GuiError::Release);
        }
        fixture.package(&candidate.version);
        Ok(())
    })
    .unwrap();
    assert_eq!(result.version, "0.101.0");
    assert!(store::installed(&fixture.0).unwrap().version.is_none());
}

#[test]
fn cached_candidate_is_reused_and_failed_new_download_never_activates_old_package() {
    let fixture = Fixture::new();
    fixture.remember("0.100.0");
    fixture.package("0.100.0");
    prepare_latest(&fixture.0, &Mutex::new(()), false, |_| {
        panic!("must reuse download")
    })
    .unwrap();
    fixture.remember("0.101.0");
    assert!(prepare_latest(&fixture.0, &Mutex::new(()), true, |_| Err(
        GuiError::Integrity
    ))
    .is_err());
    assert!(store::installed(&fixture.0).unwrap().version.is_none());
}
