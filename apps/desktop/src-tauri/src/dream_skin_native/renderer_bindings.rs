const SERVICE_TIER_BINDING: &str = "codexSwitchSetServiceTier";
const USAGE_SUMMARY_BINDING: &str = "codexSwitchRequestUsageSummary";
const RENDERER_BINDING_POLL: Duration = Duration::from_millis(500);
static RENDERER_BINDING_GENERATION: AtomicU64 = AtomicU64::new(0);

struct RendererBindingCall {
    name: String,
    payload: String,
}

impl CdpSession {
    fn read_renderer_binding(&mut self) -> Result<Option<RendererBindingCall>, String> {
        self.socket
            .get_mut()
            .set_read_timeout(Some(RENDERER_BINDING_POLL))
            .map_err(|error| format!("Failed to configure CDP binding timeout: {error}"))?;
        loop {
            let message = match self.socket.read() {
                Ok(message) => message,
                Err(tungstenite::Error::Io(error))
                    if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) =>
                {
                    return Ok(None);
                }
                Err(error) => return Err(format!("Failed to read CDP binding event: {error}")),
            };
            let Message::Text(text) = message else {
                continue;
            };
            let value: Value = serde_json::from_str(text.as_str())
                .map_err(|error| format!("Invalid CDP binding event: {error}"))?;
            let Some(call) = renderer_binding_call(&value) else {
                continue;
            };
            return Ok(Some(call));
        }
    }
}

fn renderer_binding_call(value: &Value) -> Option<RendererBindingCall> {
    if value.get("method").and_then(Value::as_str) != Some("Runtime.bindingCalled") {
        return None;
    }
    let params = value.get("params")?;
    let name = params.get("name")?.as_str()?;
    if !matches!(name, SERVICE_TIER_BINDING | USAGE_SUMMARY_BINDING) {
        return None;
    }
    Some(RendererBindingCall {
        name: name.to_string(),
        payload: params.get("payload")?.as_str()?.to_string(),
    })
}

fn evaluate_for_binding(target: &CdpTarget, port: u16, expression: &str) -> Result<Value, String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    session.evaluate(expression)
}

fn acknowledge_service_tier(target: &CdpTarget, port: u16, tier: &str, succeeded: bool) {
    let Ok(tier) = serde_json::to_string(tier) else {
        return;
    };
    let expression =
        format!("window.__CODEX_SWITCH_SPEED_SELECTOR__?.completeSelection?.({tier}, {succeeded})");
    let _ = evaluate_for_binding(target, port, &expression);
}

fn publish_usage_summary(target: &CdpTarget, port: u16) {
    let summary = match crate::codex_usage_summary::load() {
        Ok(summary) => summary,
        Err(error) => {
            eprintln!("Failed to load the Codex usage summary: {error}");
            complete_usage_request(target, port);
            return;
        }
    };
    let summary = match serde_json::to_string(&summary) {
        Ok(summary) => summary,
        Err(error) => {
            eprintln!("Failed to serialize the Codex usage summary: {error}");
            complete_usage_request(target, port);
            return;
        }
    };
    let expression = format!("window.__CODEX_SWITCH_SPEED_SELECTOR__?.updateUsage?.({summary})");
    if let Err(error) = evaluate_for_binding(target, port, &expression) {
        eprintln!("Failed to publish the Codex usage summary: {error}");
        complete_usage_request(target, port);
    }
}

fn complete_usage_request(target: &CdpTarget, port: u16) {
    let expression = "window.__CODEX_SWITCH_SPEED_SELECTOR__?.completeUsageRequest?.(); true";
    if let Err(error) = evaluate_for_binding(target, port, expression) {
        eprintln!("Failed to acknowledge the Codex usage request: {error}");
    }
}

fn handle_renderer_binding(call: RendererBindingCall, target: &CdpTarget, port: u16) {
    if call.name == USAGE_SUMMARY_BINDING {
        publish_usage_summary(target, port);
        return;
    }
    let succeeded = crate::local_proxy::is_running()
        && crate::local_proxy::set_proxy_service_tier_by_name(&call.payload);
    acknowledge_service_tier(target, port, &call.payload, succeeded);
    if succeeded {
        crate::codex_runtime::notify_service_tier_changed();
    }
}

fn run_renderer_bindings(mut session: CdpSession, target: CdpTarget, port: u16, generation: u64) {
    while RENDERER_BINDING_GENERATION.load(Ordering::Acquire) == generation {
        let call = match session.read_renderer_binding() {
            Ok(Some(call)) => call,
            Ok(None) => continue,
            Err(error) => {
                eprintln!("Codex renderer bindings stopped: {error}");
                return;
            }
        };
        if RENDERER_BINDING_GENERATION.load(Ordering::Acquire) != generation {
            return;
        }
        handle_renderer_binding(call, &target, port);
    }
}

fn install_renderer_bindings(target: &CdpTarget, port: u16) -> Result<(), String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    session.add_binding(SERVICE_TIER_BINDING)?;
    session.add_binding(USAGE_SUMMARY_BINDING)?;
    session.evaluate(
        "setTimeout(() => { \
            window.__CODEX_SWITCH_SPEED_SELECTOR__?.completeUsageRequest?.(); \
            window.__CODEX_SWITCH_SPEED_SELECTOR__?.requestUsage?.(); \
        }, 0); true",
    )?;
    let target = target.clone();
    let (ready, activation) = std::sync::mpsc::sync_channel(1);
    thread::Builder::new()
        .name("codex-renderer-bindings".to_string())
        .spawn(move || {
            if let Ok(generation) = activation.recv() {
                run_renderer_bindings(session, target, port, generation);
            }
        })
        .map_err(|error| format!("Failed to start the Codex renderer bindings: {error}"))?;
    // Keep the previous listener alive until the replacement is fully initialized
    // and its worker exists. The worker waits for this generation before reading.
    let generation = RENDERER_BINDING_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    ready
        .send(generation)
        .map_err(|_| "Failed to activate the Codex renderer bindings.".to_string())
}

pub(crate) fn request_usage_summary_refresh() -> Result<(), String> {
    let Some(port) = read_session().port else {
        return Ok(());
    };
    let Some(target) = list_targets(port)?
        .into_iter()
        .find(|target| target.url == "app://-/index.html")
    else {
        return Ok(());
    };
    evaluate_for_binding(
        &target,
        port,
        "window.__CODEX_SWITCH_SPEED_SELECTOR__?.requestUsage?.(); true",
    )?;
    Ok(())
}
