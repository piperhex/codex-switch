use super::*;
use easytier_proto::{
    common::{TunnelInfo, Url},
    core_peer::peer::{PeerConnInfo, PeerConnStats},
};

const REMOTE_NAME: &str = "csw-host";
const REMOTE_PEER: u32 = 2;
const COORDINATOR_PEER: u32 = 3;

fn fixture(protocol: &str, punched: bool) -> (Vec<Route>, Vec<PeerSnapshot>) {
    let connection_id = "00000000-0000-0000-0000-000000000001".parse().unwrap();
    let connection = PeerConnInfo {
        conn_id: format!("{connection_id}"),
        peer_id: REMOTE_PEER,
        tunnel: Some(TunnelInfo {
            tunnel_type: protocol.into(),
            remote_addr: Some(Url {
                url: format!("{protocol}://192.0.2.1:11010"),
            }),
            ..Default::default()
        }),
        stats: Some(PeerConnStats {
            latency_us: 24_000,
            ..Default::default()
        }),
        ..Default::default()
    };
    let peer = PeerSnapshot {
        peer_id: REMOTE_PEER,
        default_conn_id: Some(connection_id),
        directly_connected_conns: if punched {
            Vec::new()
        } else {
            vec![connection_id]
        },
        conns: vec![connection],
    };
    let route = Route {
        peer_id: REMOTE_PEER,
        next_hop_peer_id: REMOTE_PEER,
        cost: 1,
        hostname: REMOTE_NAME.into(),
        ..Default::default()
    };
    (vec![route], vec![peer])
}

#[test]
fn verified_udp_and_tcp_punches_are_direct_even_without_non_punched_connections() {
    for protocol in ["udp", "tcp"] {
        let (routes, peers) = fixture(protocol, true);
        assert!(peers[0].directly_connected_conns.is_empty());
        assert_eq!(
            from_snapshots(&routes, &peers, REMOTE_NAME),
            RouteStatus {
                direct: true,
                protocol: Some(protocol.into()),
                ipv6: false,
                rtt_ms: Some(24),
            }
        );
    }
}

#[test]
fn existing_non_punched_connections_remain_direct() {
    let (routes, peers) = fixture("tcp", false);
    assert!(from_snapshots(&routes, &peers, REMOTE_NAME).direct);
}

#[test]
fn admission_without_a_round_trip_is_not_a_healthy_direct_path() {
    for punched in [false, true] {
        let (routes, mut peers) = fixture("udp", punched);
        peers[0].conns[0].stats.as_mut().unwrap().latency_us = 0;
        assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
        peers[0].conns[0].stats = None;
        assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
    }
}

#[test]
fn coordinator_routes_never_become_direct_even_with_a_live_peer_socket() {
    let (mut routes, peers) = fixture("udp", true);
    routes[0].cost = 2;
    assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
    routes[0].cost = 1;
    routes[0].next_hop_peer_id = COORDINATOR_PEER;
    assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
}

#[test]
fn only_the_selected_live_connection_can_enable_the_route() {
    let (routes, mut peers) = fixture("udp", true);
    let mut backup = peers[0].conns[0].clone();
    backup.conn_id = "00000000-0000-0000-0000-000000000002".into();
    peers[0].conns.push(backup);
    peers[0].conns[0].is_closed = true;
    assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
    peers[0].conns[0].is_closed = false;
    peers[0].conns[0].stats.as_mut().unwrap().latency_us = 0;
    assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
    peers[0].default_conn_id = Some(peers[0].conns[1].conn_id.parse().unwrap());
    assert!(from_snapshots(&routes, &peers, REMOTE_NAME).direct);
    peers[0].default_conn_id = None;
    assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
}

#[test]
fn missing_or_mismatched_route_and_peer_snapshots_are_not_direct() {
    let (routes, mut peers) = fixture("udp", false);
    assert!(!from_snapshots(&routes, &peers, "unknown-peer").direct);
    assert!(!from_snapshots(&[], &peers, REMOTE_NAME).direct);
    assert!(!from_snapshots(&routes, &[], REMOTE_NAME).direct);
    peers[0].peer_id = COORDINATOR_PEER;
    assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
    peers[0].peer_id = REMOTE_PEER;
    peers[0].conns[0].peer_id = COORDINATOR_PEER;
    assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
    peers[0].conns.clear();
    assert!(!from_snapshots(&routes, &peers, REMOTE_NAME).direct);
}

#[test]
fn reports_the_selected_punched_connections_resolved_address_family() {
    let (routes, mut peers) = fixture("udp", true);
    peers[0].conns[0]
        .tunnel
        .as_mut()
        .unwrap()
        .resolved_remote_addr = Some(Url {
        url: "udp://[2001:db8::1]:11010".into(),
    });
    assert!(from_snapshots(&routes, &peers, REMOTE_NAME).ipv6);
}
