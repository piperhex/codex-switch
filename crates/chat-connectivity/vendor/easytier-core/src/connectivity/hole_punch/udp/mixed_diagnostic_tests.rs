use super::*;
use crate::connectivity::hole_punch::udp::diagnostics::PunchDiagnostics;

#[tokio::test(start_paused = true)]
async fn received_probe_followed_by_handshake_failure_is_not_reported_as_no_reply() {
    let mut harness = Harness::new(true, false);
    Arc::get_mut(&mut harness).unwrap().fail_handshake = true;
    let diagnostics = Arc::new(PunchDiagnostics::default());
    let mut receiver = diagnostics.subscribe();
    let mut attempt = harness.attempt();
    let observed = diagnostics.begin(attempt.target, UdpPunchClientMethod::HardSymToEasySym);
    attempt.progress = observed.progress.clone();
    let result = attempt.run().await;
    assert!(result.as_ref().unwrap().is_none());
    observed.observe(&result);
    observed.finish(false);
    receiver.try_recv().unwrap();
    let report = receiver.try_recv().unwrap();
    assert_eq!(report.reason, Some(PunchReason::HandshakeFailed));
    assert_eq!(report.phase, PunchPhase::Handshake);
    let probes = report.probes.unwrap();
    assert!(probes.matched_probes > 0);
    assert!(probes.handshake_attempts > 0);
    assert_eq!(probes.handshake_failures, probes.handshake_attempts);
}
