//! Local owner controls: status, permission changes, and the fixed desktop RPCs. Credentials are never returned.
use super::{configuration, installer, platform, supervisor, Result, ServiceError};
use crate::remote_desktop::{permissions::Permissions, service_worker::Call};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{os::windows::io::AsRawHandle, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::windows::named_pipe::ClientOptions,
};

const PIPE: &str = r"\\.\pipe\codex-switch-desktop-control";
const MAX_BYTES: u64 = 1024 * 1024;
#[derive(Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
enum Request {
    Status,
    Permissions { permissions: Permissions },
    Desktop { call: Call },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub permissions: Permissions,
    pub base_url: String,
    pub name: String,
}
#[derive(Deserialize, Serialize)]
struct Response {
    data: Option<Value>,
    error: Option<String>,
}

fn snapshot(config: configuration::Configuration) -> Snapshot {
    Snapshot {
        permissions: config.permissions,
        base_url: config.base_url,
        name: config.name,
    }
}
pub(super) async fn serve() -> Result<()> {
    let config = configuration::read()?;
    let acl = format!(
        "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;{})",
        config.owner_sid
    );
    loop {
        let pipe = platform::pipe_with_acl(PIPE, &acl)?;
        pipe.connect()
            .await
            .map_err(|_| ServiceError::Unavailable)?;
        let mut pipe = BufReader::new(pipe);
        let mut bytes = Vec::new();
        let read = tokio::time::timeout(
            Duration::from_secs(5),
            (&mut pipe)
                .take(MAX_BYTES + 1)
                .read_until(b'\n', &mut bytes),
        )
        .await;
        if !matches!(read, Ok(Ok(_)))
            || bytes.len() as u64 > MAX_BYTES
            || bytes.last() != Some(&b'\n')
        {
            continue;
        }
        let result = match serde_json::from_slice::<Request>(&bytes) {
            Ok(request) => handle(request).await,
            Err(_) => Err(ServiceError::Invalid),
        };
        let response = match result {
            Ok(data) => Response {
                data: Some(data),
                error: None,
            },
            Err(error) => Response {
                data: None,
                error: Some(error.to_string()),
            },
        };
        let mut bytes = serde_json::to_vec(&response).map_err(|_| ServiceError::Invalid)?;
        bytes.push(b'\n');
        if !matches!(
            tokio::time::timeout(Duration::from_secs(5), pipe.get_mut().write_all(&bytes)).await,
            Ok(Ok(()))
        ) {
            eprintln!("desktop owner response unavailable");
            continue;
        }
        // Keep the server handle alive until the client consumes its reply, without an unbounded FlushFileBuffers.
        let mut acknowledgement = [0u8; 1];
        if !matches!(
            tokio::time::timeout(
                Duration::from_secs(3),
                pipe.read_exact(&mut acknowledgement)
            )
            .await,
            Ok(Ok(_))
        ) {
            eprintln!("desktop owner acknowledgement unavailable");
        }
    }
}
async fn handle(request: Request) -> Result<Value> {
    match request {
        Request::Desktop { call } => supervisor::desktop_call(call).await,
        Request::Status => {
            let config = tauri::async_runtime::spawn_blocking(configuration::read)
                .await
                .map_err(|_| ServiceError::Unavailable)??;
            serde_json::to_value(snapshot(config)).map_err(|_| ServiceError::Invalid)
        }
        Request::Permissions { permissions } => {
            let config = tauri::async_runtime::spawn_blocking(move || {
                let mut config = configuration::read()?;
                config.permissions = permissions;
                configuration::write(&config)?;
                Ok(config)
            })
            .await
            .map_err(|_| ServiceError::Unavailable)??;
            supervisor::reset_worker().await;
            serde_json::to_value(snapshot(config)).map_err(|_| ServiceError::Invalid)
        }
    }
}

async fn request(request: Request) -> Result<Value> {
    let status = tauri::async_runtime::spawn_blocking(installer::query)
        .await
        .map_err(|_| ServiceError::Unavailable)??
        .ok_or(ServiceError::Unavailable)?;
    let expected = status.process_id.ok_or(ServiceError::Unavailable)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    let pipe = loop {
        match ClientOptions::new().open(PIPE) {
            Ok(pipe) => break pipe,
            Err(_) if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(50)).await
            }
            Err(_) => return Err(ServiceError::Unavailable),
        }
    };
    let mut pid = 0;
    // SAFETY: the pipe handle and PID output are live; SCM supplies the trusted expected service process.
    if unsafe {
        windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId(
            pipe.as_raw_handle(),
            &mut pid,
        )
    } == 0
        || pid != expected
    {
        return Err(ServiceError::Denied);
    }
    let mut pipe = BufReader::new(pipe);
    let mut bytes = serde_json::to_vec(&request).map_err(|_| ServiceError::Invalid)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(ServiceError::Invalid);
    }
    bytes.push(b'\n');
    pipe.get_mut()
        .write_all(&bytes)
        .await
        .map_err(|_| ServiceError::Unavailable)?;
    bytes.clear();
    tokio::time::timeout(
        Duration::from_secs(25),
        (&mut pipe)
            .take(MAX_BYTES + 1)
            .read_until(b'\n', &mut bytes),
    )
    .await
    .map_err(|_| ServiceError::Unavailable)?
    .map_err(|_| ServiceError::Unavailable)?;
    if bytes.len() as u64 > MAX_BYTES || bytes.last() != Some(&b'\n') {
        return Err(ServiceError::Invalid);
    }
    let response: Response = serde_json::from_slice(&bytes).map_err(|_| ServiceError::Invalid)?;
    pipe.get_mut()
        .write_all(b"\x01")
        .await
        .map_err(|_| ServiceError::Unavailable)?;
    match response.error {
        Some(error) => Err(ServiceError::Remote(error)),
        None => Ok(response.data.unwrap_or(Value::Null)),
    }
}
pub(crate) async fn read() -> Result<Snapshot> {
    serde_json::from_value(request(Request::Status).await?).map_err(|_| ServiceError::Invalid)
}
pub(crate) async fn update(permissions: Permissions) -> Result<()> {
    request(Request::Permissions { permissions }).await?;
    Ok(())
}
pub(super) async fn desktop(command: &str, args: Value) -> Result<Value> {
    request(Request::Desktop {
        call: Call {
            id: 1,
            command: command.into(),
            args,
        },
    })
    .await
}
pub(crate) async fn running() -> Result<bool> {
    let status = tauri::async_runtime::spawn_blocking(installer::query)
        .await
        .map_err(|_| ServiceError::Unavailable)??;
    Ok(status.is_some_and(|status| {
        status.current_state == windows_service::service::ServiceState::Running
    }))
}
