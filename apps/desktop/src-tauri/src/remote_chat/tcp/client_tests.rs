use super::{authority::Address, ClientSession, State};
use serde_json::json;

fn paired(kind: &str) -> serde_json::Value {
    json!({"type":kind,"sessionId":"remote-session","expiresAt":u64::MAX,
        "tcpPunch":{"servers":[{"host":"discovery.example","port":3478}]}})
}

fn candidates(generation: u64) -> serde_json::Value {
    json!({"type":"signal","sessionId":"remote-session","payload":{
        "kind":"tcp","generation":generation,"addresses":[{"host":"192.168.1.8","port":45000}]}})
}

#[tokio::test]
async fn pc_client_authorizes_before_ipc_and_revokes_its_groups_on_disconnect() {
    let state = State::default();
    let mut client = ClientSession::new(state.client_authority.clone(), "client".into());
    assert!(client.receive(&candidates(0)).is_err());
    client.receive(&paired("paired")).unwrap();
    client.receive(&candidates(0)).unwrap();
    let id = state
        .open(
            "remote-session".into(),
            0,
            tauri::ipc::Channel::new(|_| Ok(())),
        )
        .await
        .unwrap();
    let group = state.group(&id).await.unwrap();
    state.authority.clear().unwrap();
    assert!(
        state.group(&id).await.is_ok(),
        "host resets must not clear outgoing PC paths"
    );
    let peer = Address {
        host: "192.168.1.8".into(),
        port: 45000,
    };
    assert!(state
        .client_authority
        .allows("remote-session", 0, &peer)
        .is_ok());
    assert!(state
        .client_authority
        .allows("remote-session", 1, &peer)
        .is_err());
    drop(client);
    assert!(*group.grant.revoked.borrow());
    assert!(state.group(&id).await.is_err());
}

#[test]
fn stale_worker_cleanup_cannot_revoke_a_resumed_client() {
    let state = State::default();
    let mut old = ClientSession::new(state.client_authority.clone(), "old".into());
    old.receive(&paired("paired")).unwrap();
    old.receive(&candidates(12)).unwrap();
    let grant = state.client_authority.grant("remote-session", 12).unwrap();
    let mut resumed = ClientSession::new(state.client_authority.clone(), "new".into());
    resumed.receive(&paired("resumed")).unwrap();
    assert!(old.receive(&paired("resumed")).is_err());
    old.receive(&json!({"type":"peer-close","sessionId":"remote-session"}))
        .unwrap();
    drop(old);
    assert!(!*grant.revoked.borrow());
    assert!(state.client_authority.grant("remote-session", 12).is_ok());
    drop(resumed);
    assert!(*grant.revoked.borrow());
}

#[test]
fn resumed_client_can_restart_discovery_at_its_existing_ice_generation() {
    let state = State::default();
    let mut client = ClientSession::new(state.client_authority.clone(), "new".into());
    client.receive(&paired("resumed")).unwrap();
    assert!(state.client_authority.grant("remote-session", 37).is_ok());
    client.receive(&candidates(37)).unwrap();
    assert!(state.client_authority.grant("remote-session", 36).is_err());
    let arbitrary = Address {
        host: "192.168.1.9".into(),
        port: 45000,
    };
    assert!(state
        .client_authority
        .allows("remote-session", 37, &arbitrary)
        .is_err());
    let mut other = candidates(37);
    other["sessionId"] = json!("unrelated");
    assert!(client.receive(&other).is_err());
    client
        .receive(&json!({"type":"peer-close","sessionId":"remote-session"}))
        .unwrap();
    assert!(state.client_authority.grant("remote-session", 37).is_err());
}

#[test]
fn old_coordinators_do_not_grant_tcp_or_break_relay() {
    let state = State::default();
    let mut client = ClientSession::new(state.client_authority.clone(), "client".into());
    client
        .receive(&json!({"type":"paired","sessionId":"remote-session"}))
        .unwrap();
    client
        .receive(&json!({"type":"relay","sessionId":"remote-session","payload":"aabb"}))
        .unwrap();
    assert!(state.client_authority.grant("remote-session", 0).is_err());
}

#[tokio::test]
async fn pc_client_tcp_group_transfers_bytes_through_its_authorized_socket() {
    use tokio::io::AsyncReadExt;
    let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = Address {
        host: "127.0.0.1".into(),
        port: server.local_addr().unwrap().port(),
    };
    let state = State::default();
    let mut client = ClientSession::new(state.client_authority.clone(), "client".into());
    let mut frame = paired("paired");
    frame["tcpPunch"]["servers"] = json!([address]);
    client.receive(&frame).unwrap();
    let id = state
        .open(
            "remote-session".into(),
            0,
            tauri::ipc::Channel::new(|_| Ok(())),
        )
        .await
        .unwrap();
    let group = state.group(&id).await.unwrap();
    let local_port = super::network::listen(group.clone(), false).await.unwrap();
    let socket_id = state.connect(&id, address, false).await.unwrap();
    let (mut stream, remote) = server.accept().await.unwrap();
    assert_eq!(remote.port(), local_port);
    let payload = vec![73; 4096];
    group.write(&socket_id, payload.clone()).await.unwrap();
    let mut received = vec![0; payload.len()];
    stream.read_exact(&mut received).await.unwrap();
    assert_eq!(received, payload);
    drop(client);
    assert!(state.group(&id).await.is_err());
    // Revocation closes the OS socket as well as refusing new IPC requests.
    let read = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        stream.read(&mut received),
    )
    .await
    .unwrap();
    assert!(matches!(read, Ok(0) | Err(_)));
}
