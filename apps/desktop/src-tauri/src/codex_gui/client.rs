use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{oneshot, Mutex},
    time::{timeout, Duration},
};

use super::{
    error::{GuiError, Result},
    platform,
    protocol::{approval_response, ApprovalReply, GuiEvent},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
type Pending = HashMap<u64, oneshot::Sender<Result<Value>>>;

pub(super) struct Client {
    writer: Mutex<ChildStdin>,
    process: Mutex<Child>,
    pending: Mutex<Pending>,
    approvals: Mutex<HashMap<String, GuiEvent>>,
    active_turns: Mutex<HashSet<String>>,
    next_id: AtomicU64,
    pub(super) alive: AtomicBool,
    app: AppHandle,
}

impl Client {
    pub(super) async fn start(
        app: AppHandle,
        executable: PathBuf,
        home: PathBuf,
    ) -> Result<Arc<Self>> {
        let mut command = Command::new(executable);
        command
            .arg("app-server")
            .arg("-c")
            .arg(format!("sqlite_home={}", json!(home.to_string_lossy())))
            .arg("-c")
            .arg(format!(
                "log_dir={}",
                json!(home.join("log").to_string_lossy())
            ))
            .env("CODEX_HOME", &home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        platform::hide_window(&mut command);
        let mut process = command.spawn().map_err(|_| GuiError::Startup)?;
        let writer = process.stdin.take().ok_or(GuiError::Startup)?;
        let stdout = process.stdout.take().ok_or(GuiError::Startup)?;
        let client = Arc::new(Self {
            writer: Mutex::new(writer),
            process: Mutex::new(process),
            pending: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            active_turns: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            app,
        });
        tokio::spawn(client.clone().read(stdout));
        let handshake = client.request("initialize", json!({
            "clientInfo": {"name": "codex_switch_gui", "title": "Codex Switch", "version": "1.0.0"},
            "capabilities": {"experimentalApi": true}
        })).await;
        if handshake.is_err() {
            client.stop().await;
            return Err(GuiError::Startup);
        }
        client.write(json!({"method": "initialized"})).await?;
        Ok(client)
    }

    async fn write(&self, value: Value) -> Result<()> {
        let mut message = serde_json::to_vec(&value).map_err(|_| GuiError::InvalidRequest)?;
        message.push(b'\n');
        let mut writer = self.writer.lock().await;
        timeout(REQUEST_TIMEOUT, writer.write_all(&message))
            .await
            .map_err(|_| GuiError::Timeout)?
            .map_err(|_| GuiError::Disconnected)
    }

    pub(super) async fn request(&self, method: &str, params: Value) -> Result<Value> {
        if !self.alive.load(Ordering::Acquire) {
            return Err(GuiError::Disconnected);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        if let Err(error) = self
            .write(json!({"id": id, "method": method, "params": params}))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        let result = timeout(REQUEST_TIMEOUT, receiver).await;
        self.pending.lock().await.remove(&id);
        result
            .map_err(|_| GuiError::Timeout)?
            .map_err(|_| GuiError::Disconnected)?
    }

    async fn read(self: Arc<Self>, stdout: ChildStdout) {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => self.dispatch(value).await,
                Err(_) => eprintln!("Codex GUI ignored an invalid protocol message"),
            }
        }
        self.disconnect(true).await;
    }

    async fn dispatch(&self, value: Value) {
        if let Some(method) = value["method"].as_str() {
            // Legacy codex/event messages duplicate v2 events and can contain raw internal data.
            if method.starts_with("codex/event/") {
                return;
            }
            let event = GuiEvent {
                method: method.to_owned(),
                params: value["params"].clone(),
                id: value.get("id").cloned(),
            };
            if method == "turn/started" {
                if let Some(id) = event.params["turn"]["id"].as_str() {
                    self.active_turns.lock().await.insert(id.to_owned());
                }
            }
            if method == "turn/completed" {
                if let Some(id) = event.params["turn"]["id"].as_str() {
                    self.active_turns.lock().await.remove(id);
                    self.approvals
                        .lock()
                        .await
                        .retain(|_, approval| approval.params["turnId"] != id);
                }
            }
            if let Some(id) = &event.id {
                if !matches!(
                    method,
                    "item/commandExecution/requestApproval"
                        | "item/fileChange/requestApproval"
                        | "item/tool/requestUserInput"
                        | "item/permissions/requestApproval"
                ) {
                    if self
                        .write(json!({"id": id, "error": {"code": -32601,
                        "message": "This client does not support this request"}}))
                        .await
                        .is_err()
                    {
                        eprintln!("Codex GUI could not decline an unsupported request");
                    }
                    return;
                }
                self.approvals
                    .lock()
                    .await
                    .insert(id.to_string(), event.clone());
            }
            if method == "serverRequest/resolved" {
                self.approvals
                    .lock()
                    .await
                    .remove(&event.params["requestId"].to_string());
            }
            self.emit(event);
        } else if let Some(id) = value["id"].as_u64() {
            if let Some(sender) = self.pending.lock().await.remove(&id) {
                let result = if value.get("error").is_some() {
                    Err(GuiError::Rpc)
                } else {
                    Ok(value["result"].clone())
                };
                // A timed-out caller can drop its receiver before the response arrives.
                let _ = sender.send(result);
            }
        }
    }

    pub(super) async fn respond(&self, reply: ApprovalReply) -> Result<()> {
        let key = reply.id.to_string();
        let event = self
            .approvals
            .lock()
            .await
            .get(&key)
            .cloned()
            .ok_or(GuiError::InvalidRequest)?;
        let result = approval_response(&event, reply)?;
        self.write(json!({"id": event.id, "result": result}))
            .await?;
        self.approvals.lock().await.remove(&key);
        self.emit(GuiEvent {
            method: "serverRequest/resolved".into(),
            params: json!({"requestId": event.id}),
            id: None,
        });
        Ok(())
    }

    pub(super) async fn pending_approvals(&self) -> Vec<GuiEvent> {
        self.approvals.lock().await.values().cloned().collect()
    }

    pub(super) async fn is_running(&self) -> bool {
        !self.active_turns.lock().await.is_empty() || !self.pending.lock().await.is_empty()
    }

    fn emit(&self, event: GuiEvent) {
        if self.app.emit_to("main", "codex-gui-event", event).is_err() {
            eprintln!("Codex GUI could not deliver an event");
        }
    }

    async fn disconnect(&self, notify: bool) {
        if !self.alive.swap(false, Ordering::AcqRel) {
            return;
        }
        for (_, sender) in self.pending.lock().await.drain() {
            // Callers may already have timed out.
            let _ = sender.send(Err(GuiError::Disconnected));
        }
        self.approvals.lock().await.clear();
        if notify {
            self.emit(GuiEvent {
                method: "connection/closed".into(),
                params: json!({}),
                id: None,
            });
        }
    }

    pub(super) async fn stop(&self) {
        self.disconnect(false).await;
        if self.process.lock().await.kill().await.is_err() {
            eprintln!("Codex GUI process was already stopped");
        }
    }
}
