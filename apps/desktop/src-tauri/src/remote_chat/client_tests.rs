use super::*;
use serde_json::{json, Value};
use std::{net::TcpListener, sync::mpsc as sync_mpsc, thread, time::Duration};
use tauri::ipc::InvokeResponseBody;
use tungstenite::Message;

fn request() -> OpenRequest {
    OpenRequest {
        client_id: uuid::Uuid::new_v4().to_string(),
        device_id: "other-pc".into(),
        identity: crate::cloud::GuiCloudIdentity {
            base_url: "https://example.test/api".into(),
            user_id: "owner".into(),
        },
        public_key: "ab".repeat(32),
        resume: None,
    }
}

#[test]
fn native_remote_gui_is_bound_to_the_logged_in_owner_and_server() {
    let request = request();
    let config = Config {
        websocket_url: "wss://example.test/api/device-chat".into(),
        access_token: "secret".into(),
        device_id: "this-pc".into(),
        owner: "\"owner\"".into(),
    };
    assert!(request.matches(&config));
    assert!(!request.matches(&Config {
        owner: "\"other-owner\"".into(),
        ..config.clone()
    }));
    assert!(!request.matches(&Config {
        websocket_url: "wss://elsewhere.test/device-chat".into(),
        ..config.clone()
    }));
    assert!(!request.matches(&Config {
        device_id: "other-pc".into(),
        ..config
    }));
}

#[test]
fn native_remote_gui_validates_peer_keys_and_resume_limits() {
    let mut request = request();
    assert!(request.validate());
    request.public_key = "z".repeat(64);
    assert!(!request.validate());
    request.public_key = "ab".repeat(31);
    assert!(!request.validate());
    request.public_key = "ab".repeat(32);
    request.resume = Some(ResumeRequest {
        session_id: "session".into(),
        resume_token: "token".into(),
    });
    assert!(request.validate());
    request.resume.as_mut().unwrap().resume_token = "t".repeat(513);
    assert!(!request.validate());
    request.resume = None;
    request.client_id = "unknown-window".into();
    assert!(!request.validate());
}

#[test]
fn native_peer_authenticates_routes_its_session_and_closes_after_logout() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (relayed, relay_received) = sync_mpsc::channel();
    let (stop_server, stopped) = sync_mpsc::channel();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        let auth: Value =
            serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(auth["accessToken"], "native-secret");
        assert_eq!(auth["deviceId"], "other-pc");
        assert_eq!(auth["role"], "mobile");
        socket
            .send(Message::Text(
                json!({"type":"paired", "sessionId":"paired-session"})
                    .to_string()
                    .into(),
            ))
            .unwrap();
        let frame: Value =
            serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(
            frame,
            json!({"type":"relay", "sessionId":"paired-session", "payload":"aabb"})
        );
        relayed.send(()).unwrap();
        stopped.recv_timeout(Duration::from_secs(5)).unwrap();
    });
    let config = Config {
        websocket_url: format!("ws://{address}/device-chat"),
        access_token: "native-secret".into(),
        device_id: "this-pc".into(),
        owner: "\"owner\"".into(),
    };
    let (configs, receiver) = watch::channel(Some(config));
    let (commands, command_receiver) = mpsc::channel(8);
    let (delivered, events) = sync_mpsc::channel();
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(text) = body {
            delivered.send(text).unwrap();
        }
        Ok(())
    });
    let mut request = request();
    request.identity.base_url = format!("http://{address}");
    let worker = thread::spawn(move || {
        super::super::client_runtime::run(
            request,
            channel,
            command_receiver,
            (receiver, Arc::new(AtomicBool::new(false))),
        )
    });
    let text = events.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(!text.contains("native-secret"));
    assert!(text.contains("paired-session"));
    commands
        .blocking_send(ClientCommand::Send(Outgoing::Relay {
            session_id: "paired-session".into(),
            payload: "aabb".into(),
        }))
        .unwrap();
    relay_received.recv_timeout(Duration::from_secs(5)).unwrap();
    configs.send_replace(None);
    let closed: Value =
        serde_json::from_str(&events.recv_timeout(Duration::from_secs(5)).unwrap()).unwrap();
    assert_eq!(closed["events"][0]["code"], 4001);
    stop_server.send(()).unwrap();
    worker.join().unwrap();
    server.join().unwrap();
}
