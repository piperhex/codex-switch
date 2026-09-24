#[test]
fn gui_provider_request_keeps_its_account_while_shared_switches_and_polling_continue() {
    use crate::storage::write_json_atomic;
    let app = breakdown_responsiveness_test_app();
    app.manage(crate::codex_gui::web::WebEventState::default());
    let paths = resolve_paths(app.handle()).unwrap();
    let root = paths.state_file.parent().unwrap().to_path_buf();
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut provider = openai_provider(format!("http://{}", server.server_addr().to_ip().unwrap()));
    provider.id = "gui-provider".into();
    provider.api_key = "gui-credential".into();
    provider.api_format = ProviderApiFormat::OpenaiResponses;
    write_json_atomic(
        &paths.providers.join("gui-provider.json"),
        &serde_json::to_value(&provider).unwrap(),
    )
    .unwrap();
    write_json_atomic(
        &root.join("codex-gui-account.json"),
        &json!({"kind":"provider","id":"gui-provider"}),
    )
    .unwrap();
    let mut shared = ManagerStateFile {
        active_provider_id: Some("shared-provider".into()),
        ..Default::default()
    };
    write_state(&paths, &shared).unwrap();
    let session_id = format!("gui-routing-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".into(), session_id.clone())];
    let guard = begin_proxy_session_request(&headers, None, br#"{"input":"hello"}"#, None);
    let (received, incoming) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let upstream = thread::spawn(move || {
        let request = server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        let auth = request
            .headers()
            .iter()
            .find(|header| header.field.equiv("Authorization"))
            .unwrap();
        assert_eq!(auth.value.as_str(), "Bearer gui-credential");
        received.send(()).unwrap();
        released.recv_timeout(Duration::from_secs(5)).unwrap();
        request
            .respond(Response::from_string("{\"output\":[]}"))
            .unwrap();
    });
    let request_app = app.handle().clone();
    let request_session = session_id.clone();
    let worker = thread::spawn(move || {
        handle_proxy_request(
            &request_app,
            &Method::Post,
            "/codex-gui/v1/responses",
            &headers,
            br#"{"model":"test","input":"hello"}"#.to_vec(),
            Some(&request_session),
            None,
        )
        .unwrap()
    });
    incoming.recv_timeout(Duration::from_secs(5)).unwrap();
    // The remote command shares this service: validate and publish while a request is in flight.
    use crate::codex_gui::account_selection::{self, GuiAccountSelection};
    let selected = GuiAccountSelection::Provider("gui-provider".into());
    assert_eq!(account_selection::switch_account(app.handle(), selected.clone()).unwrap(), selected);
    assert!(account_selection::switch_account(
        app.handle(), GuiAccountSelection::Provider("../missing".into()),
    ).is_err());
    assert_eq!(read_state(&paths).active_provider_id, shared.active_provider_id);
    shared.active_provider_id = Some("another-shared-provider".into());
    write_state(&paths, &shared).unwrap();
    tauri::async_runtime::block_on(gui_context::record_usage(&json!({
        "threadId": session_id,
        "tokenUsage": {"modelContextWindow": 285_000, "last": {"totalTokens": 15_000}}
    })));
    for _ in 0..3 {
        assert!(active_proxy_session_ids().unwrap().contains(&session_id));
        assert_eq!(
            list_proxy_session_requests_blocking(&session_id)
                .unwrap()
                .len(),
            1
        );
        let session = proxy_sessions().lock().unwrap()[&session_id].metadata_snapshot();
        assert_eq!(session.gui_context.unwrap().capacity, Some(285_000));
        assert_eq!(session.context_tokens, Some(15_000));
        assert_eq!(session.active_requests, 1);
    }
    release.send(()).unwrap();
    let payload = worker.join().unwrap();
    assert_eq!(payload.status, 200);
    read_upstream_payload(payload);
    upstream.join().unwrap();
    assert_eq!(
        read_state(&paths).active_provider_id,
        shared.active_provider_id
    );
    assert_eq!(
        crate::codex_gui::account_selection::read(app.handle()).unwrap(),
        crate::codex_gui::account_selection::GuiAccountSelection::Provider("gui-provider".into())
    );
    drop(guard);
    proxy_sessions().lock().unwrap().remove(&session_id);
    // The mock application identifier owns this unique test directory.
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("com.codex-switch.breakdown-test."));
    fs::remove_dir_all(root).unwrap();
}
