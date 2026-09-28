use super::*;
use std::{fs, thread};

#[test]
fn loopback_requires_enabled_home_credentials_and_rejects_browser_requests() {
    let root = std::env::temp_dir().join(format!("csw-remote-bridge-{}", uuid::Uuid::new_v4()));
    let record = state::Record {
        home: root.join("home"),
        token: "test-token".into(),
        enabled: true,
    };
    state::save(&root, &record).unwrap();
    let id = state::home_id(&record.home);
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let address = format!("http://{}/", server.server_addr());
    let test_root = root.clone();
    let worker = thread::spawn(move || {
        for _ in 0..4 {
            let mut request = server
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap();
            let result = authorize(&test_root, &mut request).map(|access| {
                assert!(matches!(access.operation, ToolRequest::List));
                json!({"accepted":true})
            });
            respond(request, result);
        }
    });
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .unwrap();
    let request = || {
        client
            .post(&address)
            .header("X-Csw-Home", &id)
            .json(&ToolRequest::List)
    };
    let missing: Value = request().send().unwrap().json().unwrap();
    assert!(missing["error"].is_string());
    let wrong: Value = request()
        .header("Authorization", "wrong-token")
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert!(wrong["error"].is_string());
    let browser: Value = request()
        .header("Authorization", &record.token)
        .header("Origin", "https://untrusted.example")
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert!(browser["error"].is_string());
    let accepted: Value = request()
        .header("Authorization", &record.token)
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(accepted["result"]["accepted"], true);
    worker.join().unwrap();
    let disabled = state::Record {
        enabled: false,
        ..record
    };
    state::save(&root, &disabled).unwrap();
    assert!(matches!(
        call(&root, &id, &disabled.token, &ToolRequest::List),
        Err(RemoteError::Disabled)
    ));
    fs::remove_dir_all(root).unwrap();
}
