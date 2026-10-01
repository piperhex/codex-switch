use std::time::{Duration, Instant};

use easytier::instance::factory::NativeCoreInstance;
use serde::Serialize;
use tokio::sync::mpsc;

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
    pub elapsed_ms: u64,
    pub connected_peers: usize,
    pub route_count: usize,
    pub remote_known: bool,
    pub direct: bool,
    pub udp_nat_type: i32,
    pub tcp_nat_type: i32,
}

pub(crate) fn report(events: &mpsc::Sender<Event>, stage: Stage, snapshot: Snapshot) {
    // Telemetry must never wait behind a suspended frontend or delay application frames.
    let _delivery = events.try_send(Event::Diagnostic { stage, snapshot });
}

pub(crate) async fn monitor(
    instance: &NativeCoreInstance,
    remote: &str,
    events: &mpsc::Sender<Event>,
) {
    let started = Instant::now();
    let mut timer = tokio::time::interval(Duration::from_secs(5));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        timer.tick().await;
        if events.is_closed() {
            return;
        }
        let routes = instance.route_snapshots().await;
        let peers = instance.peer_snapshots().await;
        let node = instance.node_snapshot().await;
        let direct = route::status(instance, remote).await.direct;
        report(
            events,
            Stage::Discovery,
            Snapshot {
                elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                connected_peers: peers
                    .iter()
                    .filter(|peer| !peer.directly_connected_conns.is_empty())
                    .count(),
                route_count: routes.len(),
                remote_known: routes.iter().any(|route| route.hostname == remote),
                direct,
                udp_nat_type: node.stun_info.udp_nat_type,
                tcp_nat_type: node.stun_info.tcp_nat_type,
            },
        );
    }
}
