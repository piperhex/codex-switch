use super::*;
use easytier::common::config::{ConfigLoader, NetworkIdentity, TomlConfig};
use easytier::instance::factory::{create_native_instance, NativeCoreInstance};
use std::{sync::Arc, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn config(desktop: bool) -> Config {
    Config {
        session_id: "test-session".into(),
        secret: "ab".repeat(32),
        servers: vec!["udp://127.0.0.1:11010".into()],
        stun_servers: Vec::new(),
        desktop,
        expires_at: lease::now_ms() + 60_000,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn connection_frames_survive_health_ticks_and_close_on_revocation() {
    let host = engine(local_core(true, "frames"));
    host.start().await.unwrap();
    let mut listener = host
        .data_plane_tcp_bind(config::CHAT_PORT, Duration::from_secs(3))
        .await
        .unwrap();
    let mut settings = config(false);
    settings.session_id = "frames".into();
    settings.servers = vec![endpoint(&host).to_string()];
    let client = Connection::start(settings).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(15), async {
        let (mut socket, _) = listener.accept().await.unwrap();
        while !matches!(client.receive().await, Some(Event::Open)) {}
        client.send("你好，native".into()).await.unwrap();
        let size = socket.read_u32().await.unwrap() as usize;
        let mut bytes = vec![0; size];
        socket.read_exact(&mut bytes).await.unwrap();
        assert_eq!(String::from_utf8(bytes).unwrap(), "你好，native");
        socket.write_u32(5).await.unwrap();
        socket.write_all(b"r").await.unwrap();
        tokio::time::sleep(Duration::from_millis(600)).await;
        socket.write_all(b"eply").await.unwrap();
        loop {
            match client.receive().await {
                Some(Event::Data { text }) => {
                    assert_eq!(text, "reply");
                    break;
                }
                Some(Event::Status { .. }) => {}
                event => panic!("Unexpected event: {event:?}"),
            }
        }
        client.close();
        while !matches!(client.receive().await, Some(Event::Closed) | None) {}
        assert!(client.send("after close".into()).await.is_err());
    })
    .await;
    client.close();
    host.stop().await;
    assert!(
        result.is_ok(),
        "framed connection or cancellation timed out"
    );
}

#[test]
fn replacing_a_mobile_bridge_never_resets_or_closes_its_successor() {
    use serde_json::{json, Value};
    fn call(request: Value) -> Value {
        serde_json::from_str(&bridge_call(&request.to_string())).unwrap()
    }
    let old =
        call(json!({"operation":"open","owner":"old","config":config(false)}))["data"].clone();
    let new =
        call(json!({"operation":"open","owner":"new","config":config(false)}))["data"].clone();
    assert!(old.is_string() && new.is_string());
    assert_ne!(old, new);
    assert!(call(json!({"operation":"reset","owner":"old"}))["error"].is_null());
    assert!(call(json!({"operation":"close","id":old}))["error"].is_null());
    assert!(
        call(json!({"operation":"renew","id":new,"expires_at":lease::now_ms()+5000}))["error"]
            .is_null()
    );
    assert!(call(json!({"operation":"reset","owner":"new"}))["error"].is_null());
}

#[test]
fn rejects_untrusted_endpoint_formats_and_expired_grants() {
    for server in [
        "https://host:11010",
        "udp://user:secret@host:11010",
        "udp://host:80",
        "tcp://host:11010?token=secret",
        "tcp://host:11010/path",
    ] {
        let mut config = config(false);
        config.servers = vec![server.into()];
        assert!(config.validate().is_err());
    }
    let mut config = config(false);
    config.expires_at = lease::now_ms();
    assert!(config.validate().is_err());
}

#[tokio::test]
async fn native_lease_renewal_preserves_the_existing_owner_and_expiry_closes_it() {
    let (deadline, receiver) = tokio::sync::watch::channel(lease::now_ms() + 50);
    let task = tokio::spawn(lease::expired(receiver));
    deadline.send_replace(lease::now_ms() + 5000);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!task.is_finished());
    deadline.send_replace(lease::now_ms());
    tokio::time::timeout(Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn userspace_native_engines_exchange_bidirectional_data_without_tun() {
    let host = engine(local_core(true, "round-trip"));
    let client = engine(local_core(false, "round-trip"));
    host.start().await.unwrap();
    client.start().await.unwrap();
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        client.add_connector(endpoint(&host)).unwrap();
        while !route::status(&client, "csw-host").await.direct {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        round_trip(&host, &client).await;
        assert!(route::status(&host, "csw-client").await.direct);
        assert!(!route::status(&host, "unknown-peer").await.direct);
    })
    .await;
    client.stop().await;
    host.stop().await;
    assert!(result.is_ok(), "native userspace round trip timed out");
}

fn local_core(desktop: bool, session: &str) -> TomlConfig {
    let mut settings = config(desktop);
    settings.session_id = session.into();
    let core = settings.core().unwrap();
    core.set_peers(Vec::new());
    core.set_listeners(vec!["tcp://127.0.0.1:0".parse().unwrap()]);
    let mut flags = core.get_flags();
    flags.disable_upnp = true;
    core.set_flags(flags);
    core
}

fn engine(core: TomlConfig) -> Arc<NativeCoreInstance> {
    create_native_instance(core).unwrap()
}

fn endpoint(engine: &NativeCoreInstance) -> url::Url {
    engine
        .running_listeners()
        .into_iter()
        .find(|url| url.scheme() == "tcp")
        .unwrap()
}

async fn round_trip(host: &NativeCoreInstance, client: &NativeCoreInstance) {
    let mut listener = host
        .data_plane_tcp_bind(config::CHAT_PORT, Duration::from_secs(3))
        .await
        .unwrap();
    let (connected, accepted) = tokio::join!(
        client.data_plane_tcp_connect(config(false).remote_address(), Duration::from_secs(3)),
        listener.accept()
    );
    let mut sending = connected.unwrap();
    let (mut receiving, _) = accepted.unwrap();
    sending.write_all(b"request").await.unwrap();
    let mut buffer = [0; 7];
    receiving.read_exact(&mut buffer).await.unwrap();
    assert_eq!(&buffer, b"request");
    receiving.write_all(b"reply").await.unwrap();
    let mut buffer = [0; 5];
    sending.read_exact(&mut buffer).await.unwrap();
    assert_eq!(&buffer, b"reply");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_incorrect_session_key_cannot_open_the_chat_stream() {
    let host = engine(local_core(true, "key-isolation"));
    let core = local_core(false, "key-isolation");
    core.set_network_identity(NetworkIdentity::new(
        "csw-key-isolation".into(),
        "cd".repeat(32),
    ));
    let client = engine(core);
    host.start().await.unwrap();
    client.start().await.unwrap();
    let _listener = host
        .data_plane_tcp_bind(config::CHAT_PORT, Duration::from_secs(3))
        .await
        .unwrap();
    let mut events = easytier::instance::factory::subscribe_native_instance_event(&host).unwrap();
    client.add_connector(endpoint(&host)).unwrap();
    let rejected = tokio::time::timeout(Duration::from_secs(5), async {
        while let Ok(event) = events.recv().await {
            if matches!(
                event,
                easytier::common::global_ctx::GlobalCtxEvent::ConnectionError(..)
            ) {
                return;
            }
        }
    })
    .await;
    // Peer metadata can briefly outlive the rejected socket; assert data-plane isolation, not snapshot timing.
    let connected = client
        .data_plane_tcp_connect(config(false).remote_address(), Duration::from_secs(2))
        .await;
    let direct = route::status(&client, "csw-host").await.direct;
    client.stop().await;
    host.stop().await;
    assert!(
        rejected.is_ok(),
        "an attempted handshake must reject the wrong key"
    );
    assert!(
        connected.is_err(),
        "the rejected key must never access application data"
    );
    assert!(!direct);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn coordinator_automatically_discovers_a_direct_path_without_signaled_peer_addresses() {
    let core = local_core(true, "auto-coordinator");
    core.set_network_identity(NetworkIdentity::new(
        "csw-auto-coordinator".into(),
        "ef".repeat(32),
    ));
    let mut flags = core.get_flags();
    flags.relay_network_whitelist = "csw-*".into();
    core.set_flags(flags);
    let coordinator = engine(core);
    let host_core = local_core(true, "auto-discovery");
    let client_core = local_core(false, "auto-discovery");
    // Discovery advertises usable interface addresses from wildcard listeners, as production does.
    for core in [&host_core, &client_core] {
        core.set_listeners(vec!["tcp://0.0.0.0:0".parse().unwrap()]);
    }
    let host = engine(host_core);
    let client = engine(client_core);
    coordinator.start().await.unwrap();
    host.start().await.unwrap();
    client.start().await.unwrap();
    host.add_connector(endpoint(&coordinator)).unwrap();
    client.add_connector(endpoint(&coordinator)).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        while !route::status(&client, "csw-host").await.direct {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        round_trip(&host, &client).await;
    })
    .await;
    client.stop().await;
    host.stop().await;
    coordinator.stop().await;
    assert!(result.is_ok(), "automatic direct discovery timed out");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn coordinator_exchanges_routes_but_never_relays_chat_data() {
    let coordinator_config = local_core(true, "no-relay-coordinator");
    coordinator_config.set_network_identity(NetworkIdentity::new(
        "csw-no-relay-coordinator".into(),
        "ef".repeat(32),
    ));
    let mut flags = coordinator_config.get_flags();
    flags.relay_network_whitelist = "csw-*".into();
    coordinator_config.set_flags(flags);
    let coordinator = engine(coordinator_config);
    let host_config = local_core(true, "no-relay");
    let client_config = local_core(false, "no-relay");
    for core in [&host_config, &client_config] {
        let mut flags = core.get_flags();
        flags.disable_p2p = true;
        core.set_flags(flags);
    }
    let host = engine(host_config);
    let client = engine(client_config);
    coordinator.start().await.unwrap();
    host.start().await.unwrap();
    client.start().await.unwrap();
    host.add_connector(endpoint(&coordinator)).unwrap();
    client.add_connector(endpoint(&coordinator)).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        while !client
            .route_snapshots()
            .await
            .iter()
            .any(|route| route.hostname == "csw-host")
        {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(!route::status(&client, "csw-host").await.direct);
        let _listener = host
            .data_plane_tcp_bind(config::CHAT_PORT, Duration::from_secs(3))
            .await
            .unwrap();
        assert!(client
            .data_plane_tcp_connect(config(false).remote_address(), Duration::from_secs(2))
            .await
            .is_err());
        // Explicitly establish the missing direct route: coordination must not have broken private-network auth.
        client.add_connector(endpoint(&host)).unwrap();
        while !route::status(&client, "csw-host").await.direct {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        drop(_listener);
        round_trip(&host, &client).await;
    })
    .await;
    client.stop().await;
    host.stop().await;
    coordinator.stop().await;
    assert!(result.is_ok(), "coordinator route/data isolation timed out");
}
