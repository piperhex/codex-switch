use super::*;

const PORT: u16 = 9335;

#[derive(Debug, PartialEq)]
enum ChannelCall {
    List,
    Probe,
    Bind,
}

struct SimulatedChannel {
    targets: Result<Vec<CdpTarget>, ()>,
    probe_passed: bool,
    bindings_fail: bool,
    calls: Vec<ChannelCall>,
}

impl Default for SimulatedChannel {
    fn default() -> Self {
        Self {
            targets: Ok(vec![main_target()]),
            probe_passed: true,
            bindings_fail: false,
            calls: Vec::new(),
        }
    }
}

impl RendererChannel for SimulatedChannel {
    fn targets(&mut self, port: u16) -> Result<Vec<CdpTarget>, ()> {
        assert_eq!(port, PORT);
        self.calls.push(ChannelCall::List);
        self.targets.clone()
    }

    fn probe(&mut self, _target: &CdpTarget, port: u16) -> bool {
        assert_eq!(port, PORT);
        self.calls.push(ChannelCall::Probe);
        self.probe_passed
    }

    fn restore_bindings(&mut self, _target: &CdpTarget, port: u16) -> Result<(), ConnectionError> {
        assert_eq!(port, PORT);
        self.calls.push(ChannelCall::Bind);
        if self.bindings_fail {
            Err(ConnectionError::BindingRestoreFailed)
        } else {
            Ok(())
        }
    }
}

fn main_target() -> CdpTarget {
    CdpTarget {
        id: "codex-main".to_string(),
        kind: "page".to_string(),
        url: MAIN_RENDERER_URL.to_string(),
        web_socket_debugger_url: format!("ws://127.0.0.1:{PORT}/devtools/page/codex-main"),
    }
}

#[test]
fn status_requires_a_live_main_renderer_and_does_not_restore_bindings() {
    let mut channel = SimulatedChannel::default();
    let result =
        check_existing_channel(Some(PORT), ConnectionAction::Inspect, &mut channel).unwrap();

    assert_eq!(result.state, CodexConnectionState::Connected);
    assert!(!result.restart_required);
    assert_eq!(channel.calls, vec![ChannelCall::List, ChannelCall::Probe]);
}

#[test]
fn reconnect_restores_only_verified_renderer_bindings() {
    let mut channel = SimulatedChannel::default();
    let result =
        check_existing_channel(Some(PORT), ConnectionAction::Reconnect, &mut channel).unwrap();

    assert_eq!(result.state, CodexConnectionState::Connected);
    assert!(!result.restart_required);
    assert_eq!(
        channel.calls,
        vec![ChannelCall::List, ChannelCall::Probe, ChannelCall::Bind]
    );
}

#[test]
fn missing_port_requires_confirmation_without_touching_the_channel() {
    let mut channel = SimulatedChannel::default();
    let result = check_existing_channel(None, ConnectionAction::Reconnect, &mut channel).unwrap();

    assert_eq!(result.state, CodexConnectionState::Disconnected);
    assert!(result.restart_required);
    assert!(channel.calls.is_empty());
}

#[test]
fn unavailable_and_empty_channels_require_restart_without_binding_side_effects() {
    for targets in [Err(()), Ok(Vec::new())] {
        let mut channel = SimulatedChannel {
            targets,
            ..Default::default()
        };
        let result =
            check_existing_channel(Some(PORT), ConnectionAction::Reconnect, &mut channel).unwrap();

        assert_eq!(result.state, CodexConnectionState::Disconnected);
        assert!(result.restart_required);
        assert_eq!(channel.calls, vec![ChannelCall::List]);
    }
}

#[test]
fn wrong_window_and_external_endpoints_never_receive_a_probe_or_binding() {
    let mut settings = main_target();
    settings.url = "app://-/settings.html".to_string();
    let mut external = main_target();
    external.web_socket_debugger_url = "ws://example.com:9335/devtools/page/codex-main".to_string();
    let mut worker = main_target();
    worker.kind = "worker".to_string();
    for target in [settings, external, worker] {
        let mut channel = SimulatedChannel {
            targets: Ok(vec![target]),
            ..Default::default()
        };
        let result =
            check_existing_channel(Some(PORT), ConnectionAction::Reconnect, &mut channel).unwrap();

        assert_eq!(result.state, CodexConnectionState::Disconnected);
        assert!(result.restart_required);
        assert_eq!(channel.calls, vec![ChannelCall::List]);
    }
}

#[test]
fn a_main_page_without_a_codex_probe_never_counts_as_connected() {
    let mut channel = SimulatedChannel {
        probe_passed: false,
        ..Default::default()
    };
    let result =
        check_existing_channel(Some(PORT), ConnectionAction::Reconnect, &mut channel).unwrap();

    assert_eq!(result.state, CodexConnectionState::Disconnected);
    assert!(result.restart_required);
    assert_eq!(channel.calls, vec![ChannelCall::List, ChannelCall::Probe]);
}

#[test]
fn binding_failure_is_reported_without_turning_into_a_restart() {
    let mut channel = SimulatedChannel {
        bindings_fail: true,
        ..Default::default()
    };
    let result = check_existing_channel(Some(PORT), ConnectionAction::Reconnect, &mut channel);

    assert!(matches!(result, Err(ConnectionError::BindingRestoreFailed)));
    assert_eq!(
        channel.calls,
        vec![ChannelCall::List, ChannelCall::Probe, ChannelCall::Bind]
    );
}

#[test]
fn probe_requires_boolean_codex_success_without_javascript_exceptions() {
    assert!(probe_response_succeeded(
        &json!({"result": {"value": {"codex": true}}})
    ));
    for response in [
        json!({"result": {"value": {"codex": false}}}),
        json!({"result": {"value": {"codex": "true"}}}),
        json!({"result": {"value": {"codex": true}}, "exceptionDetails": {}}),
        json!({"result": {"value": true}}),
    ] {
        assert!(!probe_response_succeeded(&response));
    }
}

#[test]
fn connection_results_have_the_frontend_contract() {
    let value = serde_json::to_value(disconnected(ConnectionAction::Reconnect)).unwrap();
    assert_eq!(
        value,
        json!({"state": "disconnected", "restartRequired": true})
    );
    let value = serde_json::to_value(connecting()).unwrap();
    assert_eq!(
        value,
        json!({"state": "connecting", "restartRequired": false})
    );
}

#[test]
fn overlapping_connection_checks_return_without_waiting() {
    let check = ConnectionCheckGuard::acquire().expect("the check should be idle");
    assert!(ConnectionCheckGuard::acquire().is_none());
    drop(check);
    assert!(ConnectionCheckGuard::acquire().is_some());
}

#[test]
fn a_busy_runtime_returns_connecting_without_probing_or_binding() {
    let lock = Mutex::new(());
    let _busy = lock.lock().unwrap();
    let result = with_connection_operation(ConnectionAction::Reconnect, &lock, || {
        panic!("a busy runtime must not read the session, probe, or restore bindings")
    })
    .unwrap();
    assert_eq!(result.state, CodexConnectionState::Connecting);
    assert!(!result.restart_required);
}

#[test]
fn status_checks_do_not_wait_for_a_busy_runtime_operation() {
    let lock = Mutex::new(());
    let _busy = lock.lock().unwrap();
    let mut channel = SimulatedChannel::default();
    let result = with_connection_operation(ConnectionAction::Inspect, &lock, || {
        check_existing_channel(Some(PORT), ConnectionAction::Inspect, &mut channel)
    })
    .unwrap();
    assert_eq!(result.state, CodexConnectionState::Connected);
    assert_eq!(channel.calls, vec![ChannelCall::List, ChannelCall::Probe]);
}
