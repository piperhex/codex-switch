use easytier::instance::factory::NativeCoreInstance;
use serde::Serialize;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStatus {
    pub direct: bool,
    pub protocol: Option<String>,
    pub ipv6: bool,
    pub rtt_ms: Option<u64>,
}

/// A private virtual address reachable through a rendezvous relay must never count as P2P.
pub async fn status(instance: &NativeCoreInstance, remote_name: &str) -> RouteStatus {
    let routes = instance.route_snapshots().await;
    let Some(route) = routes.iter().find(|route| {
        route.hostname == remote_name && route.cost == 1 && route.next_hop_peer_id == route.peer_id
    }) else {
        return RouteStatus::default();
    };
    let peers = instance.peer_snapshots().await;
    let Some(peer) = peers
        .iter()
        .find(|peer| peer.peer_id == route.peer_id && !peer.directly_connected_conns.is_empty())
    else {
        return RouteStatus::default();
    };
    let Some(connection) = peer.conns.iter().find(|connection| {
        !connection.is_closed
            && peer
                .default_conn_id
                .is_some_and(|id| id.to_string() == connection.conn_id)
            && peer
                .directly_connected_conns
                .iter()
                .any(|id| id.to_string() == connection.conn_id)
    }) else {
        return RouteStatus::default();
    };
    let protocol = connection
        .tunnel
        .as_ref()
        .map(|tunnel| tunnel.tunnel_type.clone());
    let ipv6 = connection
        .tunnel
        .as_ref()
        .and_then(|tunnel| {
            tunnel
                .resolved_remote_addr
                .as_ref()
                .or(tunnel.remote_addr.as_ref())
        })
        .and_then(|address| url::Url::parse(&address.url).ok())
        .is_some_and(|address| matches!(address.host(), Some(url::Host::Ipv6(_))));
    RouteStatus {
        direct: true,
        protocol,
        ipv6,
        rtt_ms: connection
            .stats
            .as_ref()
            .map(|stats| stats.latency_us / 1000),
    }
}
