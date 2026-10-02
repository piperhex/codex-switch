fn start_managed_runtime(
    paths: &RuntimePaths,
    install: &CodexInstall,
    verification_mode: SkinVerificationMode,
    reason: RuntimeLaunchReason,
) -> Result<(), String> {
    let _launch = RuntimeLaunchGuard::acquire();
    let mut state = read_session();
    state.begin_launch(&install.executable, reason);
    write_session(&state)?;
    let result = launch_runtime_renderer(paths, install, &mut state)
        .and_then(|()| verify_runtime_skin(verification_mode, state.port));
    if result.is_err() {
        state.fail_launch();
        write_session(&state)?;
    }
    result
}

fn launch_runtime_renderer(
    paths: &RuntimePaths,
    install: &CodexInstall,
    state: &mut NativeSessionState,
) -> Result<(), String> {
    stop_codex(install)?;
    if !runtime_enhancements_enabled() {
        // begin_launch already cleared the previous CDP port and recovery session.
        // Use the app's own profile and never wait for a renderer debug endpoint.
        launch_codex(install, &[])?;
        state.session = NativeRuntimeStatus::Ready;
        return write_session(state);
    }
    let port = select_port()?;
    let profile = cdp_profile_path()?;
    ensure_directory(&profile)?;
    let arguments = managed_runtime_arguments(port, &profile);
    state.port = Some(port);
    write_session(state)?;
    launch_codex(install, &arguments)?;
    ensure_monitor(paths.clone());
    wake_monitor();
    wait_for_targets(port, CODEX_RENDERER_START_TIMEOUT)?;
    state.session = NativeRuntimeStatus::Active;
    write_session(state)?;
    refresh_models_after_runtime_ready(paths);
    Ok(())
}
