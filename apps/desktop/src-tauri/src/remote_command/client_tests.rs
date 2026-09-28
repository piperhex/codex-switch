use super::super::protocol::{CommandRequest, ExecuteRequest, Shell};
use super::*;
use std::{net::TcpListener, thread};

const TARGET: &str = "df73d734-9cda-43ba-9e27-9d496af3fd05";

fn connected(
    server: impl FnOnce(WebSocket<TcpStream>) + Send + 'static,
) -> (WebSocket<MaybeTlsStream<TcpStream>>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let worker = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        server(tungstenite::accept(stream).unwrap());
    });
    let stream = TcpStream::connect(address).unwrap();
    let (mut client, _) =
        tungstenite::client(format!("ws://{address}"), MaybeTlsStream::Plain(stream)).unwrap();
    set_timeout(&mut client).unwrap();
    (client, worker)
}

fn snapshot(online: bool, capabilities: Value) -> Value {
    json!({"type":"devices-snapshot", "devices":[
        {"deviceId":"current", "name":"Here", "online":true},
        {"deviceId":TARGET, "name":"Office", "platform":"windows", "online":online,
            "capabilities":capabilities, "activeAccountId":"must-not-leak"}
    ]})
}

fn execution() -> ToolRequest {
    ToolRequest::Execute {
        request: ExecuteRequest {
            device_id: TARGET.into(),
            command: CommandRequest {
                command: "whoami".into(),
                cwd: None,
                shell: Shell::Auto,
                timeout_seconds: 30,
            },
        },
    }
}

#[test]
fn directory_excludes_current_pc_and_private_account_fields() {
    let (mut socket, server) = connected(|mut socket| {
        socket
            .send(Message::Text(
                snapshot(true, json!(["remote-command"])).to_string().into(),
            ))
            .unwrap();
    });
    let result = receive(&mut socket, "current", ToolRequest::List, || true).unwrap();
    assert_eq!(result["computers"].as_array().unwrap().len(), 1);
    assert_eq!(result["computers"][0]["available"], true);
    assert!(!result.to_string().contains("must-not-leak"));
    server.join().unwrap();
}

#[test]
fn sends_exact_target_and_correlates_result_despite_other_events() {
    let (mut socket, server) = connected(|mut socket| {
        socket
            .send(Message::Text(
                snapshot(true, json!(["remote-command"])).to_string().into(),
            ))
            .unwrap();
        let request: Value =
            serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(request["deviceId"], TARGET);
        assert_eq!(request["request"]["command"], "whoami");
        socket
            .send(Message::Text(
                json!({"type":"remote-command-result", "requestId":"unrelated"})
                    .to_string()
                    .into(),
            ))
            .unwrap();
        socket
            .send(Message::Text(
                json!({"type":"remote-command-result", "requestId":request["requestId"],
            "data":{"stdout":"office-user", "exitCode":0}, "error":""})
                .to_string()
                .into(),
            ))
            .unwrap();
    });
    let result = receive(&mut socket, "current", execution(), || true).unwrap();
    assert_eq!(result["deviceId"], TARGET);
    assert_eq!(result["data"]["stdout"], "office-user");
    server.join().unwrap();
}

#[test]
fn offline_or_uninstalled_targets_never_receive_a_command() {
    for (online, capabilities) in [(false, json!(["remote-command"])), (true, json!([]))] {
        let (mut socket, server) = connected(move |mut socket| {
            socket
                .send(Message::Text(
                    snapshot(online, capabilities).to_string().into(),
                ))
                .unwrap();
            assert!(socket.read().is_err());
        });
        assert!(receive(&mut socket, "current", execution(), || true).is_err());
        drop(socket);
        server.join().unwrap();
    }
}
