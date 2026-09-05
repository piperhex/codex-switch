fn runtime_proxy_running() -> bool {
    crate::local_proxy::is_running()
}

fn inject_target(
    target: &CdpTarget,
    port: u16,
    payload: &LoadedPayload,
    previous_script: Option<&str>,
) -> Result<InjectedTarget, String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    if let Some(identifier) = previous_script {
        session.remove_early(identifier);
    }
    let early = early_payload(payload);
    let early_script_id = session.register_early(&early)?;
    let result = (|| -> Result<bool, String> {
        session.evaluate(&early)?;
        if !wait_for_codex_probe(&mut session, Duration::from_millis(1800))? {
            return Ok(false);
        }

        let revision_json =
            serde_json::to_string(&payload.revision).map_err(|error| error.to_string())?;
        let early_applied = session.evaluate(&format!(
            "window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ === {revision_json}"
        ))?;
        if early_applied.as_bool() != Some(true) {
            let fallback_generation =
                serde_json::to_string(&format!("fallback:{}", payload.revision))
                    .map_err(|error| error.to_string())?;
            session.evaluate(&format!(
                "window.__CODEX_DREAM_SKIN_EARLY_GENERATION__ = {fallback_generation}"
            ))?;
            session.evaluate(&payload.source)?;
        }

        let verification = session.evaluate(VERIFY_PAYLOAD)?;
        if verification.get("pass").and_then(Value::as_bool) != Some(true) {
            return Err(format!(
                "Dream Skin target verification failed: {}",
                serde_json::to_string(&verification).unwrap_or_default()
            ));
        }
        Ok(true)
    })();

    match result {
        Ok(true) => Ok(InjectedTarget {
            revision: payload.revision.clone(),
            early_script_id,
        }),
        Ok(false) => {
            if let Some(identifier) = early_script_id.as_deref() {
                session.remove_early(identifier);
            }
            Ok(InjectedTarget {
                revision: payload.revision.clone(),
                early_script_id: None,
            })
        }
        Err(error) => {
            if let Some(identifier) = early_script_id.as_deref() {
                session.remove_early(identifier);
            }
            Err(error)
        }
    }
}

fn remove_target(
    target: &CdpTarget,
    port: u16,
    previous_script: Option<&str>,
) -> Result<(), String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    if let Some(identifier) = previous_script {
        session.remove_early(identifier);
    }
    session.evaluate(REMOVE_PAYLOAD)?;
    Ok(())
}

fn monitor_iteration(
    paths: &RuntimePaths,
    injected: &mut HashMap<String, InjectedTarget>,
    last_port: &mut Option<u16>,
    recovery: &mut RendererRecovery,
) -> Result<(), String> {
    let skin_enabled = marker_path()?.is_file();
    let state = read_session();
    let Some(port) = state.port else {
        injected.clear();
        *last_port = None;
        recovery.reset();
        return Ok(());
    };
    if *last_port != Some(port) {
        injected.clear();
        *last_port = Some(port);
    }
    let paused = !skin_enabled || pause_path()?.is_file();
    let payload = if paused {
        None
    } else {
        Some(load_payload(paths)?)
    };
    let targets = match list_targets(port) {
        Ok(targets) => {
            recovery.reset();
            targets
        }
        Err(error) if error.contains("CDP is unavailable") => {
            recover_after_outage(paths, &state, recovery)?;
            return Ok(());
        }
        Err(error) => {
            recovery.reset();
            return Err(error);
        }
    };
    injected.retain(|id, _| targets.iter().any(|target| &target.id == id));
    for target in targets {
        let current = injected.get(&target.id).cloned();
        if paused {
            if current
                .as_ref()
                .is_none_or(|entry| entry.revision != "paused")
            {
                remove_target(
                    &target,
                    port,
                    current
                        .as_ref()
                        .and_then(|entry| entry.early_script_id.as_deref()),
                )?;
                injected.insert(
                    target.id,
                    InjectedTarget {
                        revision: "paused".to_string(),
                        early_script_id: None,
                    },
                );
            }
        } else if let Some(payload) = &payload {
            let needs_injection = current
                .as_ref()
                .is_none_or(|entry| entry.revision != payload.revision);
            if needs_injection {
                match inject_target(
                    &target,
                    port,
                    payload,
                    current
                        .as_ref()
                        .and_then(|entry| entry.early_script_id.as_deref()),
                ) {
                    Ok(next) => {
                        injected.insert(target.id, next);
                    }
                    Err(error) => {
                        eprintln!("Dream Skin target {}: {error}", target.id);
                    }
                }
            }
        }
    }
    Ok(())
}

fn monitor_loop(control: Arc<MonitorControl>) {
    let mut injected = HashMap::new();
    let mut last_port = None;
    let mut recovery = RendererRecovery::default();
    loop {
        let paths = {
            let guard = control
                .paths
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let (guard, _) = control
                .wake
                .wait_timeout(guard, Duration::from_millis(250))
                .unwrap_or_else(|error| error.into_inner());
            guard.clone()
        };
        let Some(paths) = paths else {
            continue;
        };
        if let Err(error) = monitor_iteration(&paths, &mut injected, &mut last_port, &mut recovery)
        {
            if !error.contains("CDP is unavailable") {
                eprintln!("Codex renderer monitor: {error}");
            }
        }
    }
}

fn ensure_monitor(paths: RuntimePaths) {
    let control = MONITOR.get_or_init(|| {
        let control = Arc::new(MonitorControl {
            paths: Mutex::new(None),
            wake: Condvar::new(),
        });
        let background = Arc::clone(&control);
        thread::Builder::new()
            .name("codex-renderer-monitor".to_string())
            .spawn(move || monitor_loop(background))
            .expect("failed to start Codex renderer monitor");
        control
    });
    *control
        .paths
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(paths);
    control.wake.notify_all();
}

fn wake_monitor() {
    if let Some(control) = MONITOR.get() {
        control.wake.notify_all();
    }
}

fn wait_for_targets(port: u16, timeout: Duration) -> Result<Vec<CdpTarget>, String> {
    let deadline = Instant::now() + timeout;
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match list_targets(port) {
            Ok(targets) if !targets.is_empty() => return Ok(targets),
            Ok(_) => last_error = "no Codex renderer target was published".to_string(),
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_millis(300));
    }
    Err(format!(
        "Codex did not expose a renderer on 127.0.0.1:{port}: {last_error}"
    ))
}

fn verification_succeeded(results: &[Value]) -> bool {
    results.iter().any(|entry| {
        entry
            .get("result")
            .and_then(|result| result.get("pass"))
            .and_then(Value::as_bool)
            == Some(true)
    })
}

fn verification_timeout_reason(last_error: &str, results: &[Value]) -> String {
    if results.iter().any(|entry| entry.get("result").is_some()) {
        "the skin could not be confirmed in the Codex window".to_string()
    } else if !last_error.is_empty() {
        last_error.to_string()
    } else {
        "no Codex main window was ready for verification".to_string()
    }
}

fn wait_for_verified(port: u16, timeout: Duration) -> Result<Vec<Value>, String> {
    let deadline = Instant::now() + timeout;
    let mut last_results = Vec::new();
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match list_targets(port) {
            Ok(targets) => {
                last_results.clear();
                last_error.clear();
                for target in targets {
                    match CdpSession::connect(&target, port).and_then(|mut session| {
                        session.enable()?;
                        let probe = session.evaluate(CODEX_PROBE_PAYLOAD)?;
                        if !codex_probe_succeeded(&probe) {
                            return Ok(None);
                        }
                        session.evaluate(VERIFY_PAYLOAD).map(Some)
                    }) {
                        Ok(Some(value)) => last_results.push(json!({
                            "targetId": target.id,
                            "result": value,
                        })),
                        Ok(None) => {}
                        Err(error) => last_error = error,
                    }
                }
                if verification_succeeded(&last_results) {
                    return Ok(last_results);
                }
            }
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_millis(400));
    }
    let reason = verification_timeout_reason(&last_error, &last_results);
    Err(format!(
        "Dream Skin verification timed out: {}; last result: {}",
        reason,
        serde_json::to_string(&last_results).unwrap_or_default()
    ))
}

fn select_port() -> Result<u16, String> {
    for port in DEFAULT_CDP_PORT..=DEFAULT_CDP_PORT + 100 {
        if TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok() {
            return Ok(port);
        }
    }
    Err("No free local CDP port was found between 9335 and 9435.".to_string())
}

fn path_eq(left: &Path, right: &Path) -> bool {
    #[cfg(target_os = "windows")]
    return windows_path_key(left).eq_ignore_ascii_case(&windows_path_key(right));
    #[cfg(not(target_os = "windows"))]
    return left == right;
}
