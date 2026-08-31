struct CdpSession {
    socket: WebSocket<TcpStream>,
    next_id: u64,
}

fn cdp_command_remaining(deadline: Instant, method: &str) -> Result<Duration, String> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        Err(format!("CDP command timed out: {method}"))
    } else {
        Ok(remaining)
    }
}

impl CdpSession {
    fn connect(target: &CdpTarget, port: u16) -> Result<Self, String> {
        validate_target(target, port)?;
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
            .map_err(|error| format!("Failed to connect to Codex CDP: {error}"))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| format!("Failed to configure CDP timeout: {error}"))?;
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| format!("Failed to configure CDP timeout: {error}"))?;
        let (socket, _) = client(target.web_socket_debugger_url.as_str(), stream)
            .map_err(|error| format!("Failed to open Codex CDP WebSocket: {error}"))?;
        Ok(Self { socket, next_id: 1 })
    }

    fn send(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.send_with_timeout(method, params, CDP_COMMAND_TIMEOUT)
    }

    fn send_with_timeout(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let deadline = Instant::now() + timeout;
        self.socket
            .send(Message::Text(
                json!({ "id": id, "method": method, "params": params })
                    .to_string()
                    .into(),
            ))
            .map_err(|error| format!("Failed to send CDP command {method}: {error}"))?;
        loop {
            let remaining = cdp_command_remaining(deadline, method)?;
            self.socket
                .get_mut()
                .set_read_timeout(Some(remaining))
                .map_err(|error| format!("Failed to configure CDP timeout: {error}"))?;
            let message = match self.socket.read() {
                Ok(message) => message,
                Err(tungstenite::Error::Io(error))
                    if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) =>
                {
                    return Err(format!("CDP command timed out: {method}"));
                }
                Err(error) => {
                    return Err(format!("Failed to read CDP response for {method}: {error}"));
                }
            };
            let Message::Text(text) = message else {
                continue;
            };
            let value: Value = serde_json::from_str(text.as_str())
                .map_err(|error| format!("Invalid CDP response: {error}"))?;
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = value.get("error") {
                return Err(format!("CDP command {method} failed: {error}"));
            }
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    fn enable(&mut self) -> Result<(), String> {
        self.send("Runtime.enable", json!({}))?;
        self.send("Page.enable", json!({}))?;
        Ok(())
    }

    fn evaluate(&mut self, expression: &str) -> Result<Value, String> {
        let response = self.send(
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "awaitPromise": true,
                "returnByValue": true,
                "userGesture": false
            }),
        )?;
        if let Some(exception) = response.get("exceptionDetails") {
            return Err(format!("Renderer evaluation failed: {exception}"));
        }
        Ok(response
            .get("result")
            .and_then(|result| result.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }

    fn register_early(&mut self, source: &str) -> Result<Option<String>, String> {
        let result = self.send(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": source }),
        )?;
        Ok(result
            .get("identifier")
            .and_then(Value::as_str)
            .map(str::to_string))
    }

    fn remove_early(&mut self, identifier: &str) {
        let _ = self.send(
            "Page.removeScriptToEvaluateOnNewDocument",
            json!({ "identifier": identifier }),
        );
    }
}

fn validate_target(target: &CdpTarget, port: u16) -> Result<(), String> {
    if target.kind != "page"
        || !target.url.starts_with("app://")
        || target.id.is_empty()
        || target.id.len() > 200
        || !target
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("Rejected an invalid Codex CDP page target.".to_string());
    }
    let parsed = Url::parse(&target.web_socket_debugger_url)
        .map_err(|error| format!("Invalid CDP WebSocket URL: {error}"))?;
    let host_ok = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    let expected_path = format!("/devtools/page/{}", target.id);
    if parsed.scheme() != "ws"
        || !host_ok
        || parsed.port() != Some(port)
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != expected_path
    {
        return Err("Rejected a CDP WebSocket outside the local Codex endpoint.".to_string());
    }
    Ok(())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|error| format!("Failed to create CDP client: {error}"))
}

fn list_targets(port: u16) -> Result<Vec<CdpTarget>, String> {
    let response = http_client()?
        .get(format!("http://127.0.0.1:{port}/json/list"))
        .send()
        .map_err(|error| format!("Codex CDP is unavailable on port {port}: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Codex CDP target request failed: {error}"))?;
    let targets: Vec<CdpTarget> = response
        .json()
        .map_err(|error| format!("Invalid Codex CDP target list: {error}"))?;
    Ok(targets
        .into_iter()
        .filter(|target| validate_target(target, port).is_ok())
        .collect())
}

#[cfg(test)]
fn is_codex_model_query_key(value: &Value) -> bool {
    value.as_array().is_some_and(|items| {
        CODEX_MODEL_QUERY_PREFIX
            .iter()
            .enumerate()
            .all(|(index, expected)| items.get(index).and_then(Value::as_str) == Some(*expected))
    })
}

pub(crate) fn refresh_codex_models(
    models: &[String],
    fast_mode_models: &[String],
    image_input_models: &[String],
    model_reasoning_efforts: &crate::models::ModelReasoningEfforts,
    selected_model: &str,
    reasoning_profile: crate::providers::ReasoningEffortProfile,
) -> Result<CodexModelRefreshResult, String> {
    let state = read_session();
    let Some(port) = state.port else {
        return Ok(CodexModelRefreshResult {
            refreshed: false,
            reason: Some("runtime-not-initialized".to_string()),
        });
    };
    let target = list_targets(port)?
        .into_iter()
        .find(|target| target.url == "app://-/index.html")
        .ok_or_else(|| "The Codex main window is not available.".to_string())?;
    let expression = codex_model_refresh_expression(
        models,
        fast_mode_models,
        image_input_models,
        model_reasoning_efforts,
        selected_model,
        reasoning_profile,
    )?;
    let mut session = CdpSession::connect(&target, port)?;
    session.enable()?;
    let result = session.evaluate(&expression)?;
    Ok(CodexModelRefreshResult {
        refreshed: result
            .get("refreshed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        reason: result
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn codex_probe_succeeded(probe: &Value) -> bool {
    probe.get("codex").and_then(Value::as_bool) == Some(true)
}

fn wait_for_codex_probe(session: &mut CdpSession, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let probe = session.evaluate(CODEX_PROBE_PAYLOAD)?;
        if codex_probe_succeeded(&probe) {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(50));
    }
}
