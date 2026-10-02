use super::*;
use crate::tests::{engine, local_core};
use turn::relay::RelayAddressGenerator;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn receives_the_first_packet_from_the_counterpart_before_sending_anything() {
    let (host, viewer) = super::tests::pair().await;
    let (_parent, grant) = watch::channel(false);
    let (_cancel, canceled) = watch::channel(false);
    let (_route, status) = watch::channel(RouteStatus {
        direct: true,
        ..Default::default()
    });
    let generator = socket::Generator::new(
        host.clone(),
        "10.253.0.2".parse().unwrap(),
        status,
        Lifetime {
            canceled,
            parent: grant,
        },
    );
    let (socket, local) = generator.allocate_conn(true, 0).await.unwrap();
    let sender = viewer
        .data_plane_udp_bind(0, Duration::from_secs(2))
        .await
        .unwrap();
    sender.send_to(b"first datagram", local).await.unwrap();
    let mut bytes = [0u8; 128];
    let received = tokio::time::timeout(Duration::from_secs(2), socket.recv_from(&mut bytes)).await;
    host.stop().await;
    viewer.stop().await;
    let (length, source) = received.unwrap().unwrap();
    assert_eq!(&bytes[..length], b"first datagram");
    assert_eq!(source, sender.local_addr());
}

#[tokio::test]
async fn allocations_are_bounded_and_slots_are_released_when_sockets_drop() {
    let engine = engine(local_core(true, "media-allocation-test"));
    engine.start().await.unwrap();
    let (parent, grant) = watch::channel(false);
    let (cancel, canceled) = watch::channel(false);
    let (_route, status) = watch::channel(RouteStatus::default());
    let generator = socket::Generator::new(
        engine.clone(),
        "10.253.0.2".parse().unwrap(),
        status,
        Lifetime {
            canceled,
            parent: grant,
        },
    );
    assert!(generator.allocate_conn(false, 0).await.is_err());
    assert!(generator.allocate_conn(true, 12345).await.is_err());
    let mut sockets = Vec::new();
    for _ in 0..MAX_ALLOCATIONS {
        sockets.push(generator.allocate_conn(true, 0).await.unwrap());
    }
    assert!(generator.allocate_conn(true, 0).await.is_err());
    drop(sockets.pop());
    assert!(generator.allocate_conn(true, 0).await.is_ok());
    parent.send_replace(true);
    assert!(generator.allocate_conn(true, 0).await.is_err());
    drop(sockets);
    drop(cancel);
    engine.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn datagrams_require_the_counterpart_a_direct_route_and_an_active_grant() {
    let engine = engine(local_core(true, "media-access-test"));
    engine.start().await.unwrap();
    let (parent, grant) = watch::channel(false);
    let (cancel, canceled) = watch::channel(false);
    let (route, status) = watch::channel(RouteStatus {
        direct: true,
        ..Default::default()
    });
    let generator = socket::Generator::new(
        engine.clone(),
        "10.253.0.2".parse().unwrap(),
        status,
        Lifetime {
            canceled,
            parent: grant,
        },
    );
    let (socket, _) = generator.allocate_conn(true, 0).await.unwrap();
    for destination in [
        "127.0.0.1:12345",
        "192.0.2.1:12345",
        "10.253.0.1:12345",
        "10.253.0.2:53",
    ] {
        assert!(socket
            .send_to(b"blocked", destination.parse().unwrap())
            .await
            .is_err());
    }
    route.send_replace(RouteStatus::default());
    assert!(socket
        .send_to(b"blocked", "10.253.0.2:12345".parse().unwrap())
        .await
        .is_err());
    route.send_replace(RouteStatus {
        direct: true,
        ..Default::default()
    });
    parent.send_replace(true);
    assert!(socket
        .send_to(b"revoked", "10.253.0.2:12345".parse().unwrap())
        .await
        .is_err());
    let mut buffer = [0u8; 100];
    assert!(
        tokio::time::timeout(Duration::from_secs(1), socket.recv_from(&mut buffer))
            .await
            .unwrap()
            .is_err()
    );
    drop(socket);
    drop(cancel);
    engine.stop().await;
}

#[tokio::test]
async fn adapter_cannot_start_after_the_grant_is_revoked() {
    let engine = engine(local_core(true, "media-revoke-test"));
    let (_parent, grant) = watch::channel(true);
    let (_route, status) = watch::channel(RouteStatus::default());
    assert!(MediaProxy::start(engine, true, status, grant)
        .await
        .is_err());
}
