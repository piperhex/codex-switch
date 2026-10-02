use super::*;

fn task() -> UdpPunchTaskInfo {
    UdpPunchTaskInfo {
        dst_peer_id: 123456789,
        my_nat_type: NatType::Symmetric.into(),
        dst_nat_type: NatType::SymmetricEasyInc.into(),
    }
}

#[test]
fn selection_reports_only_changes_and_instances_are_isolated() {
    let first = PunchDiagnostics::default();
    let second = PunchDiagnostics::default();
    let mut first_events = first.subscribe();
    let mut second_events = second.subscribe();
    first.selected(task(), UdpPunchClientMethod::HardSymToEasySym, None);
    first.selected(task(), UdpPunchClientMethod::HardSymToEasySym, None);
    assert_eq!(first_events.try_recv().unwrap().stage, PunchStage::Selected);
    assert!(first_events.try_recv().is_err());
    assert!(second_events.try_recv().is_err());
    first.selected(
        task(),
        UdpPunchClientMethod::HardSymToEasySym,
        Some(PunchReason::Blacklisted),
    );
    assert_eq!(
        first_events.try_recv().unwrap().reason,
        Some(PunchReason::Blacklisted)
    );
    first.retain_peers(&[]);
    assert!(first.state.lock().selections.is_empty());
}

#[test]
fn overflow_is_bounded_and_reports_lag_without_blocking_producers() {
    let diagnostics = Arc::new(PunchDiagnostics::default());
    let mut receiver = diagnostics.subscribe();
    for _ in 0..REPORT_CAPACITY {
        drop(diagnostics.begin(task(), UdpPunchClientMethod::HardSymToEasySym));
    }
    assert!(matches!(
        receiver.try_recv(),
        Err(broadcast::error::TryRecvError::Lagged(_))
    ));
    assert!(receiver.len() <= REPORT_CAPACITY);
}

#[test]
fn reports_redact_peer_identity_and_errors_and_do_not_invent_probe_counts() {
    let diagnostics = Arc::new(PunchDiagnostics::default());
    let mut receiver = diagnostics.subscribe();
    let attempt = diagnostics.begin(task(), UdpPunchClientMethod::SymToCone);
    attempt.observe(&Err(UdpHolePunchSignalError::RemoteRejected(
        "private-token 192.0.2.1".into(),
    )
    .into()));
    attempt.finish(false);
    receiver.try_recv().unwrap();
    let report = receiver.try_recv().unwrap();
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["reason"], "rpc-rejected");
    assert!(json.get("peerId").is_none());
    assert!(json.get("probesSent").is_none());
    let text = json.to_string();
    assert!(
        !text.contains("123456789")
            && !text.contains("private-token")
            && !text.contains("192.0.2.1")
    );
}

#[test]
fn cancellation_and_admission_failure_are_distinct_terminal_events() {
    let diagnostics = Arc::new(PunchDiagnostics::default());
    let mut receiver = diagnostics.subscribe();
    let attempt = diagnostics.begin(task(), UdpPunchClientMethod::HardSymToEasySym);
    attempt.progress.phase(PunchPhase::WaitingLock);
    drop(attempt);
    receiver.try_recv().unwrap();
    let cancelled = receiver.try_recv().unwrap();
    assert_eq!(cancelled.stage, PunchStage::Cancelled);
    assert_eq!(cancelled.phase, PunchPhase::WaitingLock);
    let attempt = diagnostics.begin(task(), UdpPunchClientMethod::HardSymToEasySym);
    attempt.progress.phase(PunchPhase::Admission);
    attempt.finish(false);
    receiver.try_recv().unwrap();
    let rejected = receiver.try_recv().unwrap();
    assert_eq!(rejected.reason, Some(PunchReason::AdmissionFailed));
    assert_ne!(cancelled.attempt, rejected.attempt);
    assert!(receiver.try_recv().is_err());
}
