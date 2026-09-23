use std::{
    net::TcpListener,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use serde_json::json;
use tungstenite::Message;

use super::{
    bridge::Bridge,
    config::Config,
    protocol::{Command, Envelope, Event, Outgoing},
    runtime::Runtime,
    sessions::{now_ms, Sessions},
    AckRequest,
};

#[test]
fn ipc_accepts_peer_frames_but_cannot_override_native_authentication() {
    assert!(serde_json::from_value::<Outgoing>(json!({
        "type": "authenticate", "accessToken": "injected", "role": "desktop"
    }))
    .is_err());
    let relay: Outgoing = serde_json::from_value(json!({
        "type": "relay", "sessionId": "phone", "payload": "aabb0011"
    }))
    .unwrap();
    assert!(relay.validate().is_ok());
    let invalid: Outgoing = serde_json::from_value(json!({
        "type": "relay", "sessionId": "phone", "payload": "plain text"
    }))
    .unwrap();
    assert!(invalid.validate().is_err());
}

#[test]
fn resume_credentials_expire_and_closed_sessions_are_not_reauthenticated() {
    let mut sessions = Sessions::default();
    for (id, expires_at) in [("expired", 1), ("active", now_ms() + 120_000)] {
        sessions
            .receive(
                &json!({"type": "peer-open", "sessionId": id, "transportVersion": 2,
            "resumeToken": "secret", "expiresAt": expires_at}),
            )
            .unwrap();
    }
    assert_eq!(
        serde_json::to_value(sessions.authentication()).unwrap(),
        json!([{"sessionId": "active", "resumeToken": "secret"}])
    );
    sessions
        .receive(&json!({"type": "peer-close", "sessionId": "active"}))
        .unwrap();
    assert!(sessions.authentication().is_empty());
}

#[test]
fn coordinator_admitted_sessions_are_not_capped_by_the_old_desktop_limit() {
    let mut sessions = Sessions::default();
    for index in 0..8 {
        let message = json!({"type": "peer-open", "sessionId": format!("phone-{index}"),
            "transportVersion": 2, "resumeToken": "proof", "expiresAt": now_ms() + 120_000});
        sessions.receive(&message).unwrap();
        assert!(sessions.receive(&message).is_err());
    }
    sessions
        .receive(&json!({"type": "chat-policy", "policy": {"chatSessionLimit": 1}}))
        .unwrap();
    assert_eq!(sessions.authentication().len(), 8);
}

#[test]
fn a_paused_frontend_has_bounded_buffers_and_stale_acknowledgements_do_not_release_batches() {
    let (sender, receiver) = mpsc::channel();
    let mut bridge = Bridge::new(
        "view".into(),
        Box::new(move |batch| sender.send(batch).is_ok()),
    );
    bridge.reset(1);
    assert!(bridge.flush());
    let first = receiver.recv().unwrap();
    for _ in 0..256 {
        assert!(bridge.enqueue(Envelope {
            generation: 1,
            event: Event::Disconnected
        }));
    }
    assert!(!bridge.enqueue(Envelope {
        generation: 1,
        event: Event::Disconnected
    }));
    bridge.reset(2);
    bridge.acknowledge(first.sequence + 1);
    assert!(bridge.flush());
    assert!(receiver.try_recv().is_err());
    bridge.acknowledge(first.sequence);
    assert!(bridge.flush());
    let reset = receiver.recv().unwrap();
    assert_eq!(reset.events.len(), 1);
    assert_eq!(reset.events[0].generation, 2);
    assert!(matches!(reset.events[0].event, Event::Reset));
}

fn config(url: String) -> Config {
    Config {
        websocket_url: url,
        access_token: "test-token".into(),
        device_id: "pc".into(),
        owner: "owner".into(),
    }
}

fn accept(listener: &TcpListener) -> tungstenite::WebSocket<std::net::TcpStream> {
    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                return tungstenite::accept(stream).unwrap();
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(5));
            }
            Err(error) => panic!("test server did not receive a connection: {error}"),
        }
    }
}

fn drive(runtime: &mut Runtime, server: thread::JoinHandle<()>) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !server.is_finished() && Instant::now() < deadline {
        runtime.tick();
        thread::sleep(Duration::from_millis(5));
    }
    server.join().unwrap();
}

#[test]
fn owner_or_cloud_changes_invalidate_resume_identity_but_token_renewal_does_not() {
    let original = config("ws://localhost/device-chat".into());
    let mut next = original.clone();
    next.access_token = "renewed-token".into();
    assert!(original.same_owner(&next));
    next.owner = "another-owner".into();
    assert!(!original.same_owner(&next));
    next.owner = original.owner.clone();
    next.websocket_url = "ws://another-cloud/device-chat".into();
    assert!(!original.same_owner(&next));
}

#[test]
fn native_registration_and_pong_continue_without_frontend_callbacks_or_timers() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://{}/device-chat", listener.local_addr().unwrap());
    let (sender, received) = mpsc::channel();
    let server = thread::spawn(move || {
        let mut socket = accept(&listener);
        let auth = socket.read().unwrap().into_text().unwrap();
        sender
            .send(serde_json::from_str::<serde_json::Value>(&auth).unwrap())
            .unwrap();
        socket
            .send(Message::Text(
                json!({"type": "registered"}).to_string().into(),
            ))
            .unwrap();
        socket.send(Message::Ping(vec![7, 8, 9].into())).unwrap();
        assert_eq!(socket.read().unwrap(), Message::Pong(vec![7, 8, 9].into()));
    });
    let mut runtime = Runtime::default();
    runtime.configure(Some(config(url)));
    // The WebView never acknowledges the initial reset batch. Rust still authenticates and responds to ping.
    runtime.command(Command::Attach {
        client_id: "view".into(),
        deliver: Box::new(|_| true),
    });
    drive(&mut runtime, server);
    let auth = received.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!(auth["role"], "desktop");
    assert_eq!(auth["accessToken"], "test-token");
    assert_eq!(auth["transportVersion"], 2);
}

#[test]
fn native_reconnect_does_not_resume_a_pairing_the_paused_frontend_never_completed() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://{}/device-chat", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let mut first = accept(&listener);
        let auth: serde_json::Value =
            serde_json::from_str(&first.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(auth["sessions"], json!([]));
        first
            .send(Message::Text(
                json!({"type": "registered"}).to_string().into(),
            ))
            .unwrap();
        first
            .send(Message::Text(
                json!({"type": "peer-open", "sessionId": "phone", "transportVersion": 2,
            "resumeToken": "proof", "expiresAt": now_ms() + 120_000})
                .to_string()
                .into(),
            ))
            .unwrap();
        first.close(None).unwrap();
        let mut second = accept(&listener);
        let resumed: serde_json::Value =
            serde_json::from_str(&second.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(resumed["sessions"], json!([]));
    });
    let mut runtime = Runtime::default();
    runtime.configure(Some(config(url)));
    runtime.command(Command::Attach {
        client_id: "view".into(),
        deliver: Box::new(|_| true),
    });
    drive(&mut runtime, server);
}

#[test]
fn stale_view_cleanup_does_not_detach_the_replacement() {
    let (sender, receiver) = mpsc::channel();
    let mut runtime = Runtime::default();
    runtime.command(Command::Attach {
        client_id: "old".into(),
        deliver: Box::new(|_| true),
    });
    runtime.command(Command::Attach {
        client_id: "new".into(),
        deliver: Box::new(move |batch| sender.send(batch).is_ok()),
    });
    runtime.command(Command::Detach("old".into()));
    runtime.tick();
    let batch = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
    runtime.command(Command::Ack(AckRequest {
        client_id: "new".into(),
        sequence: batch.sequence,
    }));
    assert!(matches!(batch.events[0].event, Event::Reset));
}

fn accept_pairing(runtime: &mut Runtime, batch: super::bridge::Batch) {
    for envelope in batch.events {
        let Event::Message { data } = envelope.event else {
            continue;
        };
        let message: serde_json::Value = serde_json::from_str(&data).unwrap();
        if message["type"] != "peer-open" {
            continue;
        }
        runtime.command(Command::Send(super::SendRequest {
            client_id: "view".into(),
            generation: envelope.generation,
            message: Outgoing::Signal {
                session_id: "phone".into(),
                payload: json!({ "kind": "key", "key": "ab".repeat(32) }),
            },
        }));
    }
    runtime.command(Command::Ack(AckRequest {
        client_id: "view".into(),
        sequence: batch.sequence,
    }));
}

#[test]
fn native_reconnect_preserves_a_session_after_its_key_was_sent() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://{}/device-chat", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let mut first = accept(&listener);
        first.read().unwrap();
        first
            .send(Message::Text(
                json!({ "type": "registered" }).to_string().into(),
            ))
            .unwrap();
        first
            .send(Message::Text(
                json!({ "type": "peer-open", "sessionId": "phone", "transportVersion": 2,
            "resumeToken": "proof", "expiresAt": now_ms() + 120_000 })
                .to_string()
                .into(),
            ))
            .unwrap();
        let key: serde_json::Value =
            serde_json::from_str(&first.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(key["payload"]["kind"], "key");
        first.close(None).unwrap();
        let mut second = accept(&listener);
        let auth: serde_json::Value =
            serde_json::from_str(&second.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(
            auth["sessions"],
            json!([{ "sessionId": "phone", "resumeToken": "proof" }])
        );
    });
    let (sender, receiver) = mpsc::channel();
    let mut runtime = Runtime::default();
    runtime.configure(Some(config(url)));
    runtime.command(Command::Attach {
        client_id: "view".into(),
        deliver: Box::new(move |batch| sender.send(batch).is_ok()),
    });
    let deadline = Instant::now() + Duration::from_secs(8);
    while !server.is_finished() && Instant::now() < deadline {
        runtime.tick();
        for batch in receiver.try_iter() {
            accept_pairing(&mut runtime, batch);
        }
        thread::sleep(Duration::from_millis(5));
    }
    server.join().unwrap();
}
