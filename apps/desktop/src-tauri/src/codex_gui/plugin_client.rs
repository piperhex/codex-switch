//! Short-lived plugin sessions use the GUI-managed binary and the selected home.
//! They never share the chat connection or forward its events.
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};

#[derive(Debug, thiserror::Error)]
pub(crate) enum PluginError {
    #[error("请先安装 Codex，再加载官方插件。")]
    MissingCli,
    #[error("无法打开所选 Codex Home，请重新选择。")]
    Home,
    #[error("无法连接 Codex，请重试。")]
    Connection,
    #[error("操作超时，请检查网络后重试。")]
    Timeout,
    #[error("插件操作未完成，请刷新后重试，并确认 Codex 已更新。")]
    Request,
    #[error("插件列表加载失败，请检查网络和登录状态后重试。")]
    Catalog,
    #[error("该插件当前不可用，请刷新列表。")]
    Selection,
}

pub(crate) type Result<T> = std::result::Result<T, PluginError>;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) struct PluginClient {
    process: Child,
    writer: ChildStdin,
    reader: Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

impl PluginClient {
    pub(crate) async fn start(app: tauri::AppHandle, home_id: String) -> Result<Self> {
        let (binary, home) = tauri::async_runtime::spawn_blocking(move || {
            let binary = super::releases::executable(&app).map_err(|_| PluginError::MissingCli)?;
            let home = crate::codex_home::resolve_selected(&app, Some(&home_id))
                .map_err(|_| PluginError::Home)?;
            std::fs::create_dir_all(&home).map_err(|_| PluginError::Home)?;
            Ok((binary, home))
        })
        .await
        .map_err(|_| PluginError::Connection)??;
        Self::connect(binary, home).await
    }

    async fn connect(binary: PathBuf, home: PathBuf) -> Result<Self> {
        let mut command = Command::new(binary);
        command
            .arg("app-server")
            .env("CODEX_HOME", &home)
            .current_dir(&home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        super::platform::hide_window(&mut command);
        let mut process = command.spawn().map_err(|_| PluginError::Connection)?;
        let writer = process.stdin.take().ok_or(PluginError::Connection)?;
        let reader = BufReader::new(process.stdout.take().ok_or(PluginError::Connection)?).lines();
        let mut client = Self {
            process,
            writer,
            reader,
            next_id: 1,
        };
        client.request("initialize", json!({
            "clientInfo": {"name": "codex_switch_plugins", "version": env!("CARGO_PKG_VERSION")},
            "capabilities": {"experimentalApi": true}
        })).await?;
        client.write(json!({"method": "initialized"})).await?;
        Ok(client)
    }

    async fn write(&mut self, value: Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(&value).map_err(|_| PluginError::Request)?;
        bytes.push(b'\n');
        self.writer
            .write_all(&bytes)
            .await
            .map_err(|_| PluginError::Connection)
    }

    pub(crate) async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        timeout(REQUEST_TIMEOUT, self.exchange(method, params))
            .await
            .map_err(|_| PluginError::Timeout)?
    }

    async fn exchange(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(json!({"id": id, "method": method, "params": params}))
            .await?;
        while let Some(line) = self
            .reader
            .next_line()
            .await
            .map_err(|_| PluginError::Connection)?
        {
            let message: Value =
                serde_json::from_str(&line).map_err(|_| PluginError::Connection)?;
            if message.get("method").is_some() {
                if let Some(request_id) = message.get("id") {
                    self.write(json!({"id": request_id, "error": {
                        "code": -32601, "message": "Unsupported request"
                    }}))
                    .await?;
                }
                continue;
            }
            if message["id"] == id {
                if message.get("error").is_some() {
                    return Err(PluginError::Request);
                }
                return message.get("result").cloned().ok_or(PluginError::Request);
            }
        }
        Err(PluginError::Connection)
    }
}

impl Drop for PluginClient {
    fn drop(&mut self) {
        // A session is finished or cancelled; do not leave a background app-server behind.
        if self.process.start_kill().is_err() {
            eprintln!("Plugin session was already stopped");
        }
    }
}
