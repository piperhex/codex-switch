const GUI_HOME_TEST_APP_ID: &str = "CSW_GUI_HOME_ISOLATION_TEST_APP_ID";

#[test]
fn proxy_config_restore_preserves_gui_files_and_active_reply() {
    let app = breakdown_responsiveness_test_app();
    let root = app.path().app_data_dir().unwrap();
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "local_proxy::tests::gui_home_isolation_probe",
            "--nocapture",
        ])
        .env(GUI_HOME_TEST_APP_ID, &app.config().identifier)
        .env("CODEX_HOME", root.join(".codex"))
        .output()
        .unwrap();
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("com.codex-switch.breakdown-test."));
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

// A child process isolates the inherited environment and global home/proxy state from other tests.
#[test]
fn gui_home_isolation_probe() {
    let Ok(id) = std::env::var(GUI_HOME_TEST_APP_ID) else {
        return;
    };
    assert!(id.starts_with("com.codex-switch.breakdown-test."));
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = id;
    let app = tauri::test::mock_builder().build(context).unwrap();
    prepare_gui_home_isolation(&app);
    let upstream = Server::http("127.0.0.1:0").unwrap();
    let fixture = GuiRuntimeFixture::with_app(&upstream, app);
    let paths = prepare_external_proxy_files(&fixture);
    let gui = crate::codex_home::gui_home(fixture.app.handle()).unwrap();
    let before = gui_file_snapshot(&gui);
    providers::apply_local_proxy_config_for_state(fixture.app.handle()).unwrap();
    assert_eq!(gui_file_snapshot(&gui), before);
    assert!(fs::read_to_string(&paths.current_config)
        .unwrap()
        .contains("codex-switch-local"));
    run_gui_reply_during_config_restore(&fixture, upstream, &paths);
    assert_eq!(gui_file_snapshot(&gui), before);
    assert_restored_external_files(&paths);
}

fn assert_restored_external_files(paths: &Paths) {
    let restored: toml_edit::DocumentMut = fs::read_to_string(&paths.current_config)
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(restored["model_provider"].as_str(), Some("openai"));
    assert_eq!(
        crate::storage::read_json(&paths.current_auth).unwrap(),
        crate::storage::read_json(&crate::storage::managed_auth_path(
            paths,
            "external-account"
        ))
        .unwrap()
    );
    assert!(!read_state(paths).local_proxy_enabled);
}

fn prepare_gui_home_isolation(app: &tauri::App<tauri::test::MockRuntime>) {
    use crate::{
        codex_home,
        models::{AppSettings, CodexHomeEntry},
    };
    let gui = codex_home::gui_home(app.handle()).unwrap();
    let external = app.path().app_data_dir().unwrap().join("external");
    fs::create_dir_all(&gui).unwrap();
    fs::create_dir_all(&external).unwrap();
    write_gui_isolation_files(&gui);
    // Without startup initialization, the storage boundary must reject the inherited GUI path.
    assert!(crate::storage::resolve_enabled_paths(app.handle()).is_err());
    codex_home::initialize_paths(app.handle()).unwrap();
    let mut settings = AppSettings::default();
    for (id, path) in [
        ("stale-default", gui.clone()),
        ("gui-alias", gui.join("..").join(".codex")),
        ("external", external.clone()),
    ] {
        settings.codex_homes.push(CodexHomeEntry {
            id: id.into(),
            path: path.to_string_lossy().into_owned(),
            enabled: true,
        });
    }
    codex_home::initialize(&settings);
    assert_eq!(codex_home::resolve().unwrap(), external);
    let all = codex_home::resolve_all().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].path, external);
    assert_eq!(
        codex_home::replicated_paths(&external.join("auth.json")),
        vec![external.join("auth.json")]
    );
}

fn write_gui_isolation_files(gui: &std::path::Path) {
    fs::write(
        gui.join("config.toml"),
        "model_provider = \"codex-switch-gui\"\n",
    )
    .unwrap();
    fs::write(
        gui.join("auth.json"),
        "{\"credential\":\"private-gui-auth\"}",
    )
    .unwrap();
}

fn prepare_external_proxy_files(fixture: &GuiRuntimeFixture) -> Paths {
    use base64::Engine as _;
    let paths = resolve_paths(fixture.app.handle()).unwrap();
    let claims = json!({"email": "external@example.test", "sub": "test-user",
        "https://api.openai.com/auth": {"chatgpt_account_id": "test-account", "chatgpt_plan_type": "plus"}});
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims.to_string());
    let token = format!("test.{payload}.signature");
    let auth = json!({"auth_mode": "chatgpt", "tokens": {
        "access_token": token, "id_token": token, "refresh_token": "test-refresh"}});
    crate::storage::write_json_atomic(
        &crate::storage::managed_auth_path(&paths, "external-account"),
        &auth,
    )
    .unwrap();
    crate::storage::write_json_atomic(&paths.current_auth, &json!({"credential": "old-external"}))
        .unwrap();
    fs::write(&paths.current_config, "model_provider = \"openai\"\n").unwrap();
    let mut state = read_state(&paths);
    state.active_account_id = Some("external-account".into());
    state.local_proxy_enabled = true;
    write_state(&paths, &state).unwrap();
    paths
}

fn gui_file_snapshot(gui: &std::path::Path) -> [(Vec<u8>, std::time::SystemTime); 2] {
    ["auth.json", "config.toml"].map(|name| {
        let path = gui.join(name);
        (
            fs::read(&path).unwrap(),
            fs::metadata(path).unwrap().modified().unwrap(),
        )
    })
}

fn run_gui_reply_during_config_restore(
    fixture: &GuiRuntimeFixture,
    upstream: Server,
    paths: &Paths,
) {
    let (seen_tx, seen) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let worker = hold_gui_test_upstream(upstream, seen_tx, release_rx);
    let base = fixture.base_url.clone();
    let request = thread::spawn(move || runtime_request(&base, "gui-config-restore"));
    seen.recv_timeout(Duration::from_secs(10)).unwrap();
    verify_gui_polling_and_switches(fixture, "gui-config-restore");
    commit_stopped_proxy_configuration(fixture.app.handle(), paths, true, Some("external-account"))
        .unwrap();
    let sessions =
        tauri::async_runtime::block_on(list_proxy_sessions(fixture.app.handle().clone())).unwrap();
    assert!(sessions
        .iter()
        .any(|session| session.id == "gui-config-restore" && session.active_requests == 1));
    release.send(()).unwrap();
    assert_eq!(request.join().unwrap()["service_tier"], "default");
    assert_eq!(
        runtime_request(&fixture.base_url, "gui-after-stop")["service_tier"],
        "default"
    );
    worker.join().unwrap();
}

fn hold_gui_test_upstream(
    upstream: Server,
    seen: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for index in 0..2 {
            let mut request = upstream
                .recv_timeout(Duration::from_secs(10))
                .unwrap()
                .unwrap();
            let body: Value = serde_json::from_reader(request.as_reader()).unwrap();
            seen.send(()).unwrap();
            if index == 0 {
                release.recv_timeout(Duration::from_secs(10)).unwrap();
            }
            runtime_upstream_reply(request, body["service_tier"].as_str().unwrap());
        }
    })
}
