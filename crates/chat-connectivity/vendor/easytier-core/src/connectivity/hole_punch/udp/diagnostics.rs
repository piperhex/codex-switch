//! Bounded, instance-owned diagnostics. Reports contain no endpoints, credentials or error text.

use std::{collections::HashMap, sync::Arc, time::Instant};

use parking_lot::Mutex;
use serde::Serialize;
use tokio::sync::broadcast;

use super::{
    UdpHolePunchClientError, UdpHolePunchSignalError, UdpPunchClientMethod, UdpPunchTaskInfo,
};
use crate::{config::PeerId, proto::common::NatType};

mod probes;
pub(crate) use probes::ProbeCounters;
pub use probes::ProbeSnapshot;

const REPORT_CAPACITY: usize = 64;

/// Selected UDP algorithm; this is not a statement that a direct connection exists.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PunchStrategy {
    None,
    ConeToCone,
    SymToCone,
    EasySymToEasySym,
    HardSymToEasySym,
}

impl From<UdpPunchClientMethod> for PunchStrategy {
    fn from(method: UdpPunchClientMethod) -> Self {
        match method {
            UdpPunchClientMethod::None => Self::None,
            UdpPunchClientMethod::ConeToCone => Self::ConeToCone,
            UdpPunchClientMethod::SymToCone => Self::SymToCone,
            UdpPunchClientMethod::EasySymToEasySym => Self::EasySymToEasySym,
            UdpPunchClientMethod::HardSymToEasySym => Self::HardSymToEasySym,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PunchStage {
    Selected,
    Skipped,
    Starting,
    Complete,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PunchPhase {
    Selection,
    WaitingLock,
    Punch,
    PublicMapping,
    ListenerRpc,
    SocketBind,
    ProbeSend,
    ProbeRpc,
    Handshake,
    Admission,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PunchReason {
    Policy,
    AlreadyDirect,
    Blacklisted,
    OpenNetwork,
    AwaitPeer,
    UnsupportedNat,
    SymmetricDisabled,
    NoPublicMapping,
    InvalidMapping,
    NoReply,
    Timeout,
    RpcTimeout,
    RpcRejected,
    RpcTransport,
    InvalidServiceKey,
    Io,
    Busy,
    HandshakeFailed,
    AdmissionFailed,
    Cancelled,
}

/// The peer ID is only for host-side filtering; serialization deliberately excludes it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PunchReport {
    #[serde(skip)]
    pub peer_id: PeerId,
    pub strategy: PunchStrategy,
    pub stage: PunchStage,
    pub phase: PunchPhase,
    pub udp_nat_type: i32,
    pub peer_udp_nat_type: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u64>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<PunchReason>,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub probes: Option<ProbeSnapshot>,
}

#[derive(Default)]
struct State {
    next_attempt: u64,
    selections: HashMap<PeerId, (PunchStrategy, Option<PunchReason>, i32, i32)>,
}

pub(crate) struct PunchDiagnostics {
    sender: broadcast::Sender<PunchReport>,
    state: Mutex<State>,
}

impl Default for PunchDiagnostics {
    fn default() -> Self {
        Self {
            sender: broadcast::channel(REPORT_CAPACITY).0,
            state: Mutex::default(),
        }
    }
}

impl PunchDiagnostics {
    pub fn subscribe(&self) -> broadcast::Receiver<PunchReport> {
        self.sender.subscribe()
    }

    fn emit(&self, report: PunchReport) {
        // Hosts may opt out; a missing or slow consumer must never stall punching.
        let _unobserved = self.sender.send(report);
    }

    pub fn retain_peers(&self, peers: &[PeerId]) {
        self.state
            .lock()
            .selections
            .retain(|peer, _| peers.contains(peer));
    }

    pub fn selected(
        &self,
        task: UdpPunchTaskInfo,
        method: UdpPunchClientMethod,
        reason: Option<PunchReason>,
    ) {
        let mut report = base_report(task, method);
        let selection = (
            report.strategy,
            reason,
            report.udp_nat_type,
            report.peer_udp_nat_type,
        );
        if self
            .state
            .lock()
            .selections
            .insert(task.dst_peer_id, selection)
            == Some(selection)
        {
            return;
        }
        report.stage = if reason.is_some() {
            PunchStage::Skipped
        } else {
            PunchStage::Selected
        };
        report.reason = reason;
        self.emit(report);
    }

    pub fn begin(
        self: &Arc<Self>,
        task: UdpPunchTaskInfo,
        method: UdpPunchClientMethod,
    ) -> PunchAttempt {
        let mut report = base_report(task, method);
        let mut state = self.state.lock();
        state.next_attempt = state.next_attempt.saturating_add(1);
        report.attempt = Some(state.next_attempt);
        drop(state);
        report.stage = PunchStage::Starting;
        report.phase = PunchPhase::Punch;
        self.emit(report.clone());
        PunchAttempt {
            diagnostics: self.clone(),
            report,
            progress: Arc::default(),
            started: Instant::now(),
            finished: false,
        }
    }
}

fn base_report(task: UdpPunchTaskInfo, method: UdpPunchClientMethod) -> PunchReport {
    PunchReport {
        peer_id: task.dst_peer_id,
        strategy: method.into(),
        stage: PunchStage::Selected,
        phase: PunchPhase::Selection,
        udp_nat_type: NatType::from(task.my_nat_type) as i32,
        peer_udp_nat_type: NatType::from(task.dst_nat_type) as i32,
        attempt: None,
        duration_ms: 0,
        reason: None,
        probes: None,
    }
}

pub(crate) struct PunchAttempt {
    diagnostics: Arc<PunchDiagnostics>,
    report: PunchReport,
    pub progress: Arc<PunchProgress>,
    started: Instant,
    finished: bool,
}

pub(crate) struct PunchProgress {
    state: Mutex<(PunchPhase, Option<PunchReason>)>,
    pub probes: Arc<ProbeCounters>,
}

impl Default for PunchProgress {
    fn default() -> Self {
        Self {
            state: Mutex::new((PunchPhase::Punch, None)),
            probes: Arc::default(),
        }
    }
}

impl PunchProgress {
    pub fn phase(&self, phase: PunchPhase) {
        self.state.lock().0 = phase;
    }
    pub fn reason(&self, reason: PunchReason) {
        self.state.lock().1 = Some(reason);
    }
}

impl PunchAttempt {
    pub fn observe(&self, result: &Result<Option<super::UdpPunchSocket>, UdpHolePunchClientError>) {
        match result {
            Ok(Some(_)) => self.progress.phase(PunchPhase::Admission),
            Ok(None) => {
                let mut state = self.progress.state.lock();
                state.1.get_or_insert(PunchReason::NoReply);
            }
            Err(UdpHolePunchClientError::Other(_)) => self.progress.reason(PunchReason::Io),
            Err(UdpHolePunchClientError::Signaling(error)) => self.progress.reason(match error {
                UdpHolePunchSignalError::Timeout => PunchReason::RpcTimeout,
                UdpHolePunchSignalError::RemoteRejected(_) => PunchReason::RpcRejected,
                UdpHolePunchSignalError::Transport(_) => PunchReason::RpcTransport,
                UdpHolePunchSignalError::InvalidServiceKey => PunchReason::InvalidServiceKey,
            }),
        }
    }

    pub fn finish(mut self, admitted: bool) {
        if !admitted && self.progress.state.lock().0 == PunchPhase::Admission {
            self.progress.reason(PunchReason::AdmissionFailed);
        }
        self.publish(if admitted {
            PunchStage::Complete
        } else {
            PunchStage::Failed
        });
        self.finished = true;
    }

    fn publish(&mut self, stage: PunchStage) {
        let (phase, reason) = *self.progress.state.lock();
        self.report.stage = stage;
        self.report.phase = phase;
        self.report.reason = if stage == PunchStage::Complete {
            None
        } else {
            reason
        };
        self.report.duration_ms =
            self.started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        self.report.probes = self.progress.probes.snapshot();
        self.diagnostics.emit(self.report.clone());
    }
}

impl Drop for PunchAttempt {
    fn drop(&mut self) {
        if !self.finished {
            self.progress.reason(PunchReason::Cancelled);
            self.publish(PunchStage::Cancelled);
        }
    }
}

#[cfg(test)]
mod tests;
