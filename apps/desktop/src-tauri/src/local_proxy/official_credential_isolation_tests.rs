use super::*;
use std::sync::{mpsc, Arc};

const TEST_TIMEOUT: Duration = Duration::from_secs(2);

#[test]
fn explicit_credentials_remain_independent_while_a_shared_switch_holds_its_lock() {
    let coordinator = Arc::new(AutoSwitchCoordinator::default());
    let shared_lock = coordinator.state.lock().unwrap();
    let worker_coordinator = Arc::clone(&coordinator);
    let (completed, result) = mpsc::channel();
    let worker = thread::spawn(move || {
        let snapshot = official_account_snapshot(Some("same-account"), || {
            worker_coordinator.account_snapshot(|| {
                Ok(ManagerStateFile {
                    active_account_id: Some("same-account".into()),
                    concurrent_account_routing_enabled: true,
                    ..Default::default()
                })
            })
        });
        completed.send(snapshot).unwrap();
    });

    let snapshot = result.recv_timeout(TEST_TIMEOUT);
    // Release before asserting so a regression cannot strand the test worker.
    drop(shared_lock);
    worker.join().unwrap();
    let (generation, attempt_generation, state) = snapshot.unwrap().unwrap();
    assert_eq!((generation, attempt_generation), (0, 0));
    assert!(state.active_account_id.is_none());
    assert!(!should_mark_proxy_session_concurrent_account(
        &state,
        None,
        Some("same-account"),
    ));
    for purpose in [
        OfficialCredentialPurpose::Default,
        OfficialCredentialPurpose::ImageInput,
        OfficialCredentialPurpose::ImageGeneration,
    ] {
        assert!(!credential_is_auto_switch_eligible(
            purpose,
            None,
            "same-account",
            state.active_account_id.as_deref(),
        ));
    }
}

#[test]
fn ordinary_credentials_keep_the_shared_snapshot_and_switch_generations() {
    let (generation, attempt_generation, state) = official_account_snapshot(None, || {
        Ok((
            7,
            9,
            ManagerStateFile {
                active_account_id: Some("shared-account".into()),
                concurrent_account_routing_enabled: true,
                ..Default::default()
            },
        ))
    })
    .unwrap();

    assert_eq!((generation, attempt_generation), (7, 9));
    assert_eq!(state.active_account_id.as_deref(), Some("shared-account"));
    assert!(state.concurrent_account_routing_enabled);
    assert!(official_account_snapshot(None, || Err("unavailable".into())).is_err());
}
