use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CodexConnectionState {
    Connected,
    Disconnected,
    Connecting,
    Unsupported,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexConnectionStatus {
    pub(crate) state: CodexConnectionState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexConnectionResult {
    pub(crate) state: CodexConnectionState,
    pub(crate) restart_required: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConnectionAction {
    Inspect,
    Reconnect,
}

fn inspect_connection(action: ConnectionAction) -> Result<CodexConnectionResult, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return crate::dream_skin_native::inspect_connection(action).map_err(|error| error.to_string());
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = action;
        Ok(CodexConnectionResult {
            state: CodexConnectionState::Unsupported,
            restart_required: false,
        })
    }
}

async fn run_connection_check(action: ConnectionAction) -> Result<CodexConnectionResult, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_connection(action))
        .await
        .map_err(|_| "暂时无法检查 Codex 连接，请稍后重试。".to_string())?
}

#[tauri::command]
pub(crate) async fn get_codex_connection_status() -> Result<CodexConnectionStatus, String> {
    run_connection_check(ConnectionAction::Inspect)
        .await
        .map(|result| CodexConnectionStatus {
            state: result.state,
        })
}

#[tauri::command]
pub(crate) async fn connect_codex() -> Result<CodexConnectionResult, String> {
    run_connection_check(ConnectionAction::Reconnect).await
}
