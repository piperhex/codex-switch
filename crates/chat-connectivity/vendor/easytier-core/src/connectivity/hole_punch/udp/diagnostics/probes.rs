use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Counters describe local I/O only; a successful send does not imply peer delivery.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSnapshot {
    pub sockets: u64,
    pub predicted_ports: u64,
    pub probes_sent: u64,
    pub probes_received: u64,
    pub matched_probes: u64,
    pub rejected_probes: u64,
    pub probe_send_errors: u64,
    pub probe_receive_errors: u64,
    pub handshake_attempts: u64,
    pub handshake_failures: u64,
}

#[derive(Default)]
pub(crate) struct ProbeCounters {
    enabled: AtomicBool,
    pub sockets: AtomicU64,
    pub predicted_ports: AtomicU64,
    pub probes_sent: AtomicU64,
    pub probes_received: AtomicU64,
    pub matched_probes: AtomicU64,
    pub rejected_probes: AtomicU64,
    pub probe_send_errors: AtomicU64,
    pub probe_receive_errors: AtomicU64,
    pub handshake_attempts: AtomicU64,
    pub handshake_failures: AtomicU64,
}

impl ProbeCounters {
    pub fn enable(&self) {
        self.enabled.store(true, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> Option<ProbeSnapshot> {
        self.enabled.load(Ordering::Relaxed).then(|| ProbeSnapshot {
            sockets: self.sockets.load(Ordering::Relaxed),
            predicted_ports: self.predicted_ports.load(Ordering::Relaxed),
            probes_sent: self.probes_sent.load(Ordering::Relaxed),
            probes_received: self.probes_received.load(Ordering::Relaxed),
            matched_probes: self.matched_probes.load(Ordering::Relaxed),
            rejected_probes: self.rejected_probes.load(Ordering::Relaxed),
            probe_send_errors: self.probe_send_errors.load(Ordering::Relaxed),
            probe_receive_errors: self.probe_receive_errors.load(Ordering::Relaxed),
            handshake_attempts: self.handshake_attempts.load(Ordering::Relaxed),
            handshake_failures: self.handshake_failures.load(Ordering::Relaxed),
        })
    }
}
