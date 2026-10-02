use std::time::{Duration, Instant};

use easytier::instance::factory::NativeCoreInstance;
use easytier_core::connectivity::hole_punch::PunchReport;
use serde::Serialize;
use tokio::sync::{broadcast, mpsc};

use crate::{connection::Event, route};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Stage {
    EngineStart,
    EngineFailed,
    Discovery,
    StreamConnect,
    StreamFailed,
    StreamOpen,
    Stopped,
}

/// A redacted snapshot: no peer identities, candidate addresses, public mappings or secrets.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub diagnostic_version: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suppressed: Option<u64>,
    pub elapsed_ms: u64,
    pub connected_peers: usize,
    pub route_count: usize,
    pub remote_known: bool,
    pub direct: bool,
    pub udp_nat_type: i32,
    pub tcp_nat_type: i32,
}

pub(crate) fn report(events: &mpsc::Sender<Event>, stage: Stage, mut snapshot: Snapshot) {
    snapshot.diagnostic_version = 2;
    // Telemetry must never wait behind a suspended frontend or delay application frames.
    let _delivery = events.try_send(Event::Diagnostic { stage, snapshot });
}

pub(crate) async fn monitor(
    instance: &NativeCoreInstance,
    remote: &str,
    events: &mpsc::Sender<Event>,
    mut punch_events: Option<broadcast::Receiver<PunchReport>>,
) {
    let started = Instant::now();
    let mut timer = tokio::time::interval(Duration::from_secs(5));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut suppressed = 0u64;
    loop {
        if events.is_closed() {
            return;
        }
        tokio::select! {
            _ = timer.tick() => {
                let mut snapshot = snapshot(instance, remote).await;
                snapshot.elapsed_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                snapshot.suppressed = Some(suppressed);
                if events.try_send(Event::Diagnostic { stage: Stage::Discovery, snapshot }).is_err() {
                    suppressed = suppressed.saturating_add(1);
                }
            }
            received = receive_punch(&mut punch_events) => match received {
                Ok(report) => {
                    let routes = instance.route_snapshots().await;
                    if routes.iter().any(|route| route.hostname == remote && route.peer_id == report.peer_id)
                        && events.try_send(Event::Punch { report }).is_err() {
                        suppressed = suppressed.saturating_add(1);
                    }
                }
                Err(broadcast::error::RecvError::Lagged(count)) => suppressed = suppressed.saturating_add(count),
                Err(broadcast::error::RecvError::Closed) => punch_events = None,
            }
        }
    }
}

async fn receive_punch(
    receiver: &mut Option<broadcast::Receiver<PunchReport>>,
) -> Result<PunchReport, broadcast::error::RecvError> {
    match receiver {
        Some(receiver) => receiver.recv().await,
        None => std::future::pending().await,
    }
}

async fn snapshot(instance: &NativeCoreInstance, remote: &str) -> Snapshot {
    let routes = instance.route_snapshots().await;
    let peers = instance.peer_snapshots().await;
    let node = instance.node_snapshot().await;
    Snapshot {
        diagnostic_version: 2,
        suppressed: None,
        elapsed_ms: 0,
        connected_peers: peers
            .iter()
            .filter(|peer| route::selected_connection(peer).is_some())
            .count(),
        route_count: routes.len(),
        remote_known: routes.iter().any(|route| route.hostname == remote),
        direct: route::from_snapshots(&routes, &peers, remote).direct,
        udp_nat_type: node.stun_info.udp_nat_type,
        tcp_nat_type: node.stun_info.tcp_nat_type,
    }
}
