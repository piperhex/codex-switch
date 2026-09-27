use super::*;
use authority::Address;
use serde_json::json;

fn session(authority: &Authority) {
    authority
        .receive(
            &json!({"type":"peer-open", "sessionId":"session", "expiresAt": u64::MAX,
        "tcpPunch":{"servers":[{"host":"discovery.example","port":3478}]}}),
        )
        .unwrap();
}

#[test]
fn ipc_cannot_dial_arbitrary_destinations_or_other_sessions() {
    let authority = Authority::default();
    session(&authority);
    let address = Address {
        host: "192.168.1.10".into(),
        port: 45000,
    };
    assert!(authority.allows("session", 0, &address).is_err());
    authority
        .receive(&json!({"type":"signal", "sessionId":"session", "payload":{
        "kind":"tcp", "generation":0,"addresses":[address]}}))
        .unwrap();
    assert!(authority.allows("session", 0, &address).is_ok());
    assert!(authority.allows("other", 0, &address).is_err());
    assert!(authority.allows("session", 1, &address).is_err());
    let grant = authority.grant("session", 0).unwrap();
    authority.remove("session").unwrap();
    assert!(*grant.revoked.borrow());
    assert!(authority.allows("session", 0, &address).is_err());
}

#[test]
fn rejects_local_services_and_stale_generations() {
    for host in [
        "127.0.0.1",
        "::1",
        "169.254.1.1",
        "fe80::1",
        "224.0.0.1",
        "0.0.0.0",
    ] {
        assert!(!Address {
            host: host.into(),
            port: 45000
        }
        .valid_peer());
    }
    let authority = Authority::default();
    session(&authority);
    let signal = |generation, host| {
        json!({"type":"signal", "sessionId":"session", "payload":{
        "kind":"tcp", "generation":generation,"addresses":[{"host":host,"port":45000}]}})
    };
    authority.receive(&signal(2, "192.168.1.10")).unwrap();
    authority.receive(&signal(1, "192.168.1.11")).unwrap();
    assert!(authority
        .allows(
            "session",
            2,
            &Address {
                host: "192.168.1.11".into(),
                port: 45000
            }
        )
        .is_err());
    assert!(authority.grant("session", 1).is_err());
}

#[tokio::test]
async fn delayed_open_cannot_replace_a_newer_generation() {
    let state = State::default();
    session(&state.authority);
    let events = || tauri::ipc::Channel::new(|_| Ok(()));
    let first = state.open("session".into(), 0, events()).await.unwrap();
    let old = state.group(&first).await.unwrap();
    let second = state.open("session".into(), 1, events()).await.unwrap();
    assert!(*old.cancel.borrow());
    assert!(state.open("session".into(), 0, events()).await.is_err());
    assert!(state.open("session".into(), 1, events()).await.is_err());
    assert!(state.group(&second).await.is_ok());
    state.authority.remove("session").unwrap();
    assert!(state.group(&second).await.is_err());
}
