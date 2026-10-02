use super::*;

#[test]
fn publishes_only_actionable_metadata() {
    let mut event = GuiEvent {
        method: "turn/completed".into(),
        id: None,
        params: serde_json::json!({"threadId":"thread","turn":{
            "id":"turn","status":"completed", "items":["secret"]}}),
    };
    let value = serde_json::to_string(&notice(&event, "engine-1").unwrap()).unwrap();
    assert!(!value.contains("secret"));
    event.params["turn"]["status"] = "failed".into();
    assert_eq!(notice(&event, "engine-1").unwrap().kind, "failed");
    event.params["turn"]["status"] = "interrupted".into();
    assert!(notice(&event, "engine-1").is_none());
    event.method = "item/commandExecution/requestApproval".into();
    event.id = Some(serde_json::json!(42));
    identify(&mut event, "engine-1");
    assert_eq!(
        event.params["notificationEventId"],
        notice(&event, "engine-1").unwrap().event_id
    );
    assert_ne!(
        notice(&event, "engine-1").unwrap().event_id,
        notice(&event, "engine-2").unwrap().event_id
    );
    assert_eq!(notice(&event, "engine-1").unwrap().kind, "attention");
    assert_eq!(
        notice(&event, "engine-1").unwrap().event_id,
        notice(&event, "engine-1").unwrap().event_id
    );
    event.method = "item/completed".into();
    event.params["item"] = serde_json::json!({"id":"item","delivery":"async","questions":[{}]});
    assert_eq!(
        notice(&event, "engine-1").unwrap().event_id,
        "question-item"
    );
}

#[test]
fn requires_the_durable_queue_acknowledgement() {
    for status in [204, 200, 301, 401, 404, 429, 503] {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr();
        let worker = std::thread::spawn(move || {
            let mut request = server.recv().unwrap();
            assert_eq!(request.url(), "/api/chat-push/events");
            let mut payload = String::new();
            request.as_reader().read_to_string(&mut payload).unwrap();
            let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
            assert_eq!(value["deviceId"], "pc");
            assert_eq!(value.as_object().unwrap().len(), 4);
            request.respond(tiny_http::Response::empty(status)).unwrap();
        });
        let identity = PushIdentity {
            base_url: format!("http://{address}/api"),
            owner_id: "owner".into(),
            device_id: "pc".into(),
        };
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let notice = Notice {
            thread_id: "thread".into(),
            event_id: "turn".into(),
            kind: "completed".into(),
        };
        assert_eq!(
            send(&client, &identity, "test-token", &notice).is_ok(),
            status == 204
        );
        worker.join().unwrap();
    }
}
