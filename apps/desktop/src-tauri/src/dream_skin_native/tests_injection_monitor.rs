use super::*;

#[derive(Default)]
struct RendererSimulation {
    ready: AtomicBool,
    verification_passes: AtomicBool,
    registrations: AtomicU64,
    removals: AtomicU64,
}

fn simulated_reply(request: &Value, state: &RendererSimulation) -> Value {
    match request["method"].as_str().unwrap() {
        "Page.addScriptToEvaluateOnNewDocument" => {
            state.registrations.fetch_add(1, Ordering::SeqCst);
            json!({ "identifier": "early-script" })
        }
        "Page.removeScriptToEvaluateOnNewDocument" => {
            state.removals.fetch_add(1, Ordering::SeqCst);
            json!({})
        }
        "Runtime.evaluate" => {
            let expression = request["params"]["expression"].as_str().unwrap();
            let value = match expression {
                CODEX_PROBE_PAYLOAD => json!({ "codex": state.ready.load(Ordering::SeqCst) }),
                VERIFY_PAYLOAD => {
                    json!({ "pass": state.verification_passes.load(Ordering::SeqCst) })
                }
                _ => Value::Bool(true),
            };
            json!({ "result": { "value": value } })
        }
        _ => json!({}),
    }
}

fn simulated_renderer(
    connections: usize,
    state: Arc<RendererSimulation>,
) -> (CdpTarget, u16, thread::JoinHandle<()>) {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(15);
        for _ in 0..connections {
            let stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "missing injection retry");
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("CDP test listener failed: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            while let Ok(Message::Text(text)) = socket.read() {
                let request: Value = serde_json::from_str(&text).unwrap();
                let response =
                    json!({ "id": request["id"], "result": simulated_reply(&request, &state) });
                socket
                    .send(Message::Text(response.to_string().into()))
                    .unwrap();
            }
        }
    });
    let target = CdpTarget {
        id: "slow-renderer".to_string(),
        kind: "page".to_string(),
        url: "app://-/index.html".to_string(),
        web_socket_debugger_url: format!("ws://127.0.0.1:{port}/devtools/page/slow-renderer"),
    };
    (target, port, worker)
}

fn test_payload() -> LoadedPayload {
    LoadedPayload {
        source: "true".to_string(),
        revision: "new-theme".to_string(),
    }
}

#[test]
fn a_slow_shell_is_retried_and_cached_only_after_verification() {
    let state = Arc::new(RendererSimulation::default());
    let (target, port, worker) = simulated_renderer(2, Arc::clone(&state));
    let payload = test_payload();
    let mut injected = HashMap::new();

    refresh_skin_target(&target, port, &payload, &mut injected).unwrap();
    assert!(injected.is_empty(), "a loading shell must remain pending");
    assert_eq!(state.removals.load(Ordering::SeqCst), 1);

    state.ready.store(true, Ordering::SeqCst);
    state.verification_passes.store(true, Ordering::SeqCst);
    refresh_skin_target(&target, port, &payload, &mut injected).unwrap();
    assert_eq!(injected[&target.id].revision, payload.revision);
    assert_eq!(
        injected[&target.id].early_script_id.as_deref(),
        Some("early-script")
    );

    // Verified targets must stay single-flight on later monitor ticks.
    refresh_skin_target(&target, port, &payload, &mut injected).unwrap();
    assert_eq!(state.registrations.load(Ordering::SeqCst), 2);
    worker.join().unwrap();
}

#[test]
fn failed_visual_verification_is_not_cached_as_applied() {
    let state = Arc::new(RendererSimulation::default());
    state.ready.store(true, Ordering::SeqCst);
    let (target, port, worker) = simulated_renderer(1, Arc::clone(&state));
    let mut injected = HashMap::new();

    assert!(refresh_skin_target(&target, port, &test_payload(), &mut injected).is_err());
    assert!(injected.is_empty());
    assert_eq!(state.removals.load(Ordering::SeqCst), 1);
    worker.join().unwrap();
}

#[test]
fn pet_surfaces_do_not_receive_skin_or_delay_the_main_window() {
    for url in [
        "app://-/index.html?initialRoute=%2Favatar-overlay",
        "app://-/index.html?initialRoute=%2Favatar-overlay%2Fpet",
        "app://-/avatar-overlay-composition-surface.html",
        "app://-/avatar-overlay",
        "https://example.com/index.html",
    ] {
        assert!(!is_skin_surface_url(url), "{url}");
    }
    for url in [
        "app://-/index.html",
        "app://-/index.html?initialRoute=%2Fsettings",
    ] {
        assert!(is_skin_surface_url(url), "{url}");
    }
}
