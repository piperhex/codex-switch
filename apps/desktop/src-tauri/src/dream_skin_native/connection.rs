//! Checks an existing renderer channel without authorizing process recovery.
//! Reconnection skips busy lifecycle operations instead of waiting.

use std::{
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, TryLockError,
    },
    time::Duration,
};

use serde_json::{json, Value};

use crate::codex_connection::{CodexConnectionResult, CodexConnectionState, ConnectionAction};

use super::{
    codex_probe_succeeded, install_renderer_bindings, list_targets, read_session, validate_target,
    CdpSession, CdpTarget, CODEX_PROBE_PAYLOAD, MONITOR, OPERATION_LOCK, RUNTIME_LAUNCHING,
};

const MAIN_RENDERER_URL: &str = "app://-/index.html";
const CONNECTION_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
static CONNECTION_CHECK_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug)]
pub(crate) enum ConnectionError {
    BindingRestoreFailed,
    RuntimeUnavailable,
}

impl fmt::Display for ConnectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::BindingRestoreFailed => "连接已建立，但暂时无法恢复同步，请稍后重试。",
            Self::RuntimeUnavailable => "暂时无法连接 Codex，请稍后重试。",
        })
    }
}

impl std::error::Error for ConnectionError {}

struct ConnectionCheckGuard;

impl ConnectionCheckGuard {
    fn acquire() -> Option<Self> {
        CONNECTION_CHECK_RUNNING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for ConnectionCheckGuard {
    fn drop(&mut self) {
        CONNECTION_CHECK_RUNNING.store(false, Ordering::Release);
    }
}

/// Narrow capabilities keep a connection request separate from launch/recovery.
trait RendererChannel {
    fn targets(&mut self, port: u16) -> Result<Vec<CdpTarget>, ()>;
    fn probe(&mut self, target: &CdpTarget, port: u16) -> bool;
    fn restore_bindings(&mut self, target: &CdpTarget, port: u16) -> Result<(), ConnectionError>;
}

struct ExistingRendererChannel;

impl RendererChannel for ExistingRendererChannel {
    fn targets(&mut self, port: u16) -> Result<Vec<CdpTarget>, ()> {
        list_targets(port).map_err(|_| ())
    }

    fn probe(&mut self, target: &CdpTarget, port: u16) -> bool {
        let Ok(mut session) = CdpSession::connect(target, port) else {
            return false;
        };
        session
            .send_with_timeout(
                "Runtime.evaluate",
                json!({
                    "expression": CODEX_PROBE_PAYLOAD,
                    "returnByValue": true,
                    "awaitPromise": true,
                }),
                CONNECTION_PROBE_TIMEOUT,
            )
            .is_ok_and(|response| probe_response_succeeded(&response))
    }

    fn restore_bindings(&mut self, target: &CdpTarget, port: u16) -> Result<(), ConnectionError> {
        install_renderer_bindings(target, port).map_err(|error| {
            eprintln!("Failed to restore Codex connection bindings: {error}");
            ConnectionError::BindingRestoreFailed
        })
    }
}

fn probe_response_succeeded(response: &Value) -> bool {
    response.get("exceptionDetails").is_none()
        && response
            .get("result")
            .and_then(|result| result.get("value"))
            .is_some_and(codex_probe_succeeded)
}

fn disconnected(action: ConnectionAction) -> CodexConnectionResult {
    CodexConnectionResult {
        state: CodexConnectionState::Disconnected,
        restart_required: action == ConnectionAction::Reconnect,
    }
}

fn connecting() -> CodexConnectionResult {
    CodexConnectionResult {
        state: CodexConnectionState::Connecting,
        restart_required: false,
    }
}

fn with_connection_operation(
    action: ConnectionAction,
    operation_lock: &Mutex<()>,
    check: impl FnOnce() -> Result<CodexConnectionResult, ConnectionError>,
) -> Result<CodexConnectionResult, ConnectionError> {
    if action == ConnectionAction::Inspect {
        return check();
    }
    let _operation = match operation_lock.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::WouldBlock) => return Ok(connecting()),
        Err(TryLockError::Poisoned(_)) => return Err(ConnectionError::RuntimeUnavailable),
    };
    check()
}

fn check_existing_channel(
    port: Option<u16>,
    action: ConnectionAction,
    channel: &mut impl RendererChannel,
) -> Result<CodexConnectionResult, ConnectionError> {
    let Some(port) = port else {
        return Ok(disconnected(action));
    };
    let Ok(targets) = channel.targets(port) else {
        return Ok(disconnected(action));
    };
    let target = targets.into_iter().find(|target| {
        target.url == MAIN_RENDERER_URL
            && validate_target(target, port).is_ok()
            && channel.probe(target, port)
    });
    let Some(target) = target else {
        return Ok(disconnected(action));
    };
    if action == ConnectionAction::Reconnect {
        // Do not wake the general monitor: an outage there could authorize an
        // automatic restart before the user has confirmed taking over this app.
        channel.restore_bindings(&target, port)?;
    }
    Ok(CodexConnectionResult {
        state: CodexConnectionState::Connected,
        restart_required: false,
    })
}

pub(crate) fn inspect_connection(
    action: ConnectionAction,
) -> Result<CodexConnectionResult, ConnectionError> {
    if MONITOR.get().is_none() {
        return Ok(CodexConnectionResult {
            state: CodexConnectionState::Unsupported,
            restart_required: false,
        });
    }
    if RUNTIME_LAUNCHING.load(Ordering::Acquire) {
        return Ok(connecting());
    }
    let Some(_check) = ConnectionCheckGuard::acquire() else {
        return Ok(connecting());
    };
    with_connection_operation(action, &OPERATION_LOCK, || {
        if RUNTIME_LAUNCHING.load(Ordering::Acquire) {
            return Ok(connecting());
        }
        // One small session file supplies the port. Polling never scans process
        // tables, Provider catalogs, skin directories, or token databases.
        let port = read_session().port;
        check_existing_channel(port, action, &mut ExistingRendererChannel)
    })
}

#[cfg(test)]
mod tests;
