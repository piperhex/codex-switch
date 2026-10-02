/// Keeps recovery and theme operations out of a prepared restart, including credential sync.
pub(crate) struct PreparedRuntimeSession {
    _operation: std::sync::MutexGuard<'static, ()>,
    paths: RuntimePaths,
    install: CodexInstall,
}

impl PreparedRuntimeSession {
    pub(crate) fn restart(self) -> Result<(), String> {
        start_managed_runtime(
            &self.paths,
            &self.install,
            SkinVerificationMode::Background,
            RuntimeLaunchReason::Explicit,
        )
    }
}

/// Resolve the launch service and installation before the caller closes ChatGPT.
pub(crate) fn prepare_runtime_session(
    executable: Option<&Path>,
) -> Result<PreparedRuntimeSession, String> {
    let _operation = crate::client_lifecycle::try_lock(&OPERATION_LOCK)
        .map_err(|error| error.to_string())?;
    let paths = MONITOR
        .get()
        .and_then(|control| {
            control
                .paths
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone()
        })
        .ok_or_else(|| "Codex 启动服务尚未就绪，请重新打开 Remote AI 后重试。".to_string())?;
    if let Some(executable) = executable {
        record_runtime_executable(executable)?;
    }
    let install = find_runtime_launch_install()?;
    Ok(PreparedRuntimeSession { _operation, paths, install })
}

/// All launch callers retain the same operation guard through process startup.
pub(crate) fn restart_runtime_session(executable: Option<&Path>) -> Result<(), String> {
    prepare_runtime_session(executable)?.restart()
}

fn record_runtime_executable(executable: &Path) -> Result<(), String> {
    if !executable.is_file() {
        return Err("Codex 的安装位置已变更，请稍后重试。".to_string());
    }
    let executable = executable.display().to_string();
    let mut state = read_session();
    if state.codex_executable.as_deref() == Some(executable.as_str()) {
        return Ok(());
    }
    state.codex_executable = Some(executable);
    write_session(&state)
}
