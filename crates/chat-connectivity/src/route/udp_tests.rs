use std::{net::SocketAddr, time::Duration};

use easytier::common::config::ConfigLoader;

use super::*;

async fn check_wildcard_udp_endpoints(bind: &str, loopback: &str) {
    let session = if bind.contains(':') {
        "udp-v6-endpoints"
    } else {
        "udp-v4-endpoints"
    };
    let host_config = crate::tests::local_core(true, session);
    host_config.set_listeners(vec![format!("udp://{bind}:0").parse().unwrap()]);
    let client_config = crate::tests::local_core(false, session);
    client_config.set_listeners(Vec::new());
    let host = crate::tests::engine(host_config);
    let client = crate::tests::engine(client_config);
    host.start().await.unwrap();
    client.start().await.unwrap();
    let port = host
        .running_listeners()
        .iter()
        .find(|url| url.scheme() == "udp")
        .unwrap()
        .port()
        .unwrap();
    client
        .add_connector(format!("udp://{loopback}:{port}").parse().unwrap())
        .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let outgoing = status(&client, "csw-host").await;
            let incoming = status(&host, "csw-client").await;
            if outgoing.direct && incoming.direct {
                return (outgoing, incoming, client.peer_snapshots().await);
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await;
    client.stop().await;
    host.stop().await;
    let (outgoing, incoming, peers) = result.expect("UDP direct route should become ready");
    let expected = format!("{loopback}:{port}").parse().unwrap();
    assert_endpoints(outgoing, incoming, &peers, expected);
}

fn assert_endpoints(
    outgoing: RouteStatus,
    incoming: RouteStatus,
    peers: &[PeerSnapshot],
    expected: SocketAddr,
) {
    let connection = peers.iter().find_map(selected_connection).unwrap();
    let binding = &connection
        .tunnel
        .as_ref()
        .unwrap()
        .local_addr
        .as_ref()
        .unwrap()
        .url;
    let binding = url::Url::parse(binding).unwrap();
    let local = SocketAddr::new(expected.ip(), binding.port().unwrap());
    // The source port belongs to the active tunnel, not the temporary route lookup socket.
    assert_eq!(
        outgoing.local_endpoint,
        Some(RouteEndpoint {
            host: local.ip().to_string(),
            port: local.port(),
        })
    );
    assert_eq!(incoming.remote_endpoint, outgoing.local_endpoint);
    assert_eq!(incoming.local_endpoint, outgoing.remote_endpoint);
    assert_eq!(incoming.local_endpoint.unwrap().port, expected.port());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn wildcard_udp_ipv4_reports_both_selected_endpoints() {
    check_wildcard_udp_endpoints("0.0.0.0", "127.0.0.1").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn wildcard_udp_ipv6_reports_both_selected_endpoints() {
    check_wildcard_udp_endpoints("[::]", "[::1]").await;
}
