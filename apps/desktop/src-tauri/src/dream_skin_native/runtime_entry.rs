/// All application launch callers use this entry point. Recording the target and
/// launching share the recovery lock so another operation cannot replace the hint.
pub(crate) fn restart_runtime_session(executable: Option<&Path>) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "暂时无法启动 Codex，请稍后重试。".to_string())?;
    let paths = MONITOR
        .get()
        .and_then(|control| {
            control
                .paths
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone()
        })
        .ok_or_else(|| "Codex 启动服务尚未就绪，请重新打开 Codex Switch 后重试。".to_string())?;
    if let Some(executable) = executable {
        record_runtime_executable(executable)?;
    }
    // A failed or unavailable managed launch must never start a second profile.
    restart_managed_runtime(&paths, SkinVerificationMode::Background)
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
