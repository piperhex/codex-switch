fn save_gui_prompt(fixture: &GuiRuntimeFixture, text: &str) {
    let settings = gui_system_prompts::GuiSystemPromptSettings {
        injection_enabled: true,
        injection_prompts: vec![crate::models::SystemPromptRule {
            name: "GUI".into(),
            text: text.into(),
            enabled: true,
        }],
        ..Default::default()
    };
    tauri::async_runtime::block_on(gui_system_prompts::codex_gui_set_system_prompt_settings(
        fixture.app.handle().clone(),
        settings,
    ))
    .unwrap();
}

struct RestoreExternalPrompts {
    enabled: bool,
    rules: Vec<crate::models::SystemPromptRule>,
}

impl RestoreExternalPrompts {
    fn install() -> Self {
        let previous = Self {
            enabled: SYSTEM_PROMPT_INJECTION_ENABLED.load(Ordering::Relaxed),
            rules: runtime_system_prompt_injection_prompts(),
        };
        set_system_prompt_injection_runtime_config(
            true,
            vec![crate::models::SystemPromptRule {
                name: "External".into(),
                text: "External instruction".into(),
                enabled: true,
            }],
        );
        previous
    }
}

impl Drop for RestoreExternalPrompts {
    fn drop(&mut self) {
        set_system_prompt_injection_runtime_config(self.enabled, std::mem::take(&mut self.rules));
    }
}

#[test]
fn gui_prompt_changes_are_independent_during_active_requests_and_polling() {
    let _guard = GUI_SPEED_TEST_LOCK.lock().unwrap();
    let _prompts = RestoreExternalPrompts::install();
    let upstream = Server::http("127.0.0.1:0").unwrap();
    let fixture = GuiRuntimeFixture::new(&upstream);
    save_gui_prompt(&fixture, "GUI first");
    let (seen_tx, seen) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let upstream_worker = thread::spawn(move || {
        for index in 0..3 {
            let mut request = upstream
                .recv_timeout(Duration::from_secs(10))
                .unwrap()
                .unwrap();
            let body: Value = serde_json::from_reader(request.as_reader()).unwrap();
            seen_tx.send(body["instructions"].clone()).unwrap();
            if index == 0 {
                release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            }
            runtime_upstream_reply(request, "default");
        }
    });
    let base = fixture.base_url.clone();
    let in_flight = thread::spawn(move || runtime_request(&base, "gui-prompt-first"));
    assert_eq!(
        seen.recv_timeout(Duration::from_secs(10)).unwrap(),
        "GUI first"
    );
    save_gui_prompt(&fixture, "GUI next");
    verify_gui_polling_and_switches(&fixture, "gui-prompt-first");
    release.send(()).unwrap();
    in_flight.join().unwrap();
    runtime_request(&fixture.base_url, "gui-prompt-next");
    assert_eq!(
        seen.recv_timeout(Duration::from_secs(10)).unwrap(),
        "GUI next"
    );
    let external = fixture.external_listener();
    runtime_request(&external, "external-prompt-unchanged");
    assert_eq!(
        seen.recv_timeout(Duration::from_secs(10)).unwrap(),
        "External instruction"
    );
    upstream_worker.join().unwrap();
}
