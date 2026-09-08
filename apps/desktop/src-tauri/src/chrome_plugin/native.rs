use std::{
    collections::HashMap,
    fs, io,
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use uuid::Uuid;

use super::{config, protocol::*, transport, BrowserError, Result};

const MAX_CONNECTIONS: usize = 16;
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(130);
const STATUS_TIMEOUT: Duration = Duration::from_secs(1);
const REVOCATION_INTERVAL: Duration = Duration::from_millis(250);
type Pending = HashMap<String, mpsc::Sender<BrowserReply>>;

struct Host {
    root: PathBuf,
    writer: Mutex<io::Stdout>,
    pending: Mutex<Pending>,
    alive: AtomicBool,
    connections: AtomicUsize,
}

pub(super) fn run(root: PathBuf) -> Result<()> {
    fs::create_dir_all(root.join("endpoints")).map_err(|_| BrowserError::Storage)?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| BrowserError::Transport)?;
    let port = listener
        .local_addr()
        .map_err(|_| BrowserError::Transport)?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|_| BrowserError::Transport)?;
    let host = Arc::new(Host {
        root,
        writer: Mutex::new(io::stdout()),
        pending: Mutex::new(HashMap::new()),
        alive: AtomicBool::new(true),
        connections: AtomicUsize::new(0),
    });
    let id = Uuid::new_v4().to_string();
    let endpoint_path = host.root.join("endpoints").join(format!("{id}.json"));
    let server = host.clone();
    thread::spawn(move || serve(server, listener));
    let result = receive(
        &host,
        &Endpoint {
            id,
            port,
            name: "Chrome".into(),
        },
    );
    host.alive.store(false, Ordering::Release);
    if let Ok(mut pending) = host.pending.lock() {
        pending.clear();
    }
    if endpoint_path.exists() {
        fs::remove_file(endpoint_path).map_err(|_| BrowserError::Storage)?;
    }
    result
}

fn receive(host: &Host, endpoint: &Endpoint) -> Result<()> {
    let mut input = io::stdin().lock();
    while let Some(message) = transport::read_frame(&mut input, transport::MAX_RESPONSE_BYTES)? {
        match message {
            ExtensionMessage::Ready { name } => publish(host, endpoint, name)?,
            ExtensionMessage::Reply { id, reply } => {
                let sender = host
                    .pending
                    .lock()
                    .map_err(|_| BrowserError::Transport)?
                    .remove(&id);
                if let Some(sender) = sender {
                    // A disconnected MCP caller can abandon a response while Chrome is still finishing it.
                    if sender.send(reply).is_err() {
                        continue;
                    }
                }
            }
        }
    }
    Ok(())
}

fn publish(host: &Host, endpoint: &Endpoint, name: String) -> Result<()> {
    if name.len() > 100 || name.chars().any(char::is_control) {
        return Err(BrowserError::InvalidRequest);
    }
    let endpoint = Endpoint {
        name,
        ..endpoint.clone()
    };
    let path = host
        .root
        .join("endpoints")
        .join(format!("{}.json", endpoint.id));
    crate::storage::write_json_atomic(
        &path,
        &serde_json::to_value(endpoint).map_err(|_| BrowserError::Storage)?,
    )
    .map_err(|_| BrowserError::Storage)
}

fn serve(host: Arc<Host>, listener: TcpListener) {
    while host.alive.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, _)) => {
                if host.connections.load(Ordering::Acquire) >= MAX_CONNECTIONS {
                    continue;
                }
                host.connections.fetch_add(1, Ordering::AcqRel);
                let host = host.clone();
                thread::spawn(move || {
                    if let Err(error) = handle(&host, stream) {
                        eprintln!("{error}");
                    }
                    host.connections.fetch_sub(1, Ordering::AcqRel);
                });
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50))
            }
            Err(_) => break,
        }
    }
}

fn handle(host: &Host, mut stream: TcpStream) -> Result<()> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| BrowserError::Transport)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| BrowserError::Transport)?;
    let request: BridgeRequest = transport::read_frame(&mut stream, transport::MAX_REQUEST_BYTES)?
        .ok_or(BrowserError::InvalidRequest)?;
    let result = forward(host, request).unwrap_or_else(BrowserReply::error);
    transport::write_frame(&mut stream, &result, transport::MAX_RESPONSE_BYTES)
}

fn forward(host: &Host, request: BridgeRequest) -> Result<BrowserReply> {
    config::authorize(&host.root, &request.client_id, &request.token)?;
    request.request.validate()?;
    let id = Uuid::new_v4().to_string();
    let (sender, receiver) = mpsc::channel();
    host.pending
        .lock()
        .map_err(|_| BrowserError::Transport)?
        .insert(id.clone(), sender);
    let outgoing = ExtensionRequest {
        id: id.clone(),
        client_id: request.client_id.clone(),
        request: request.request.clone(),
    };
    let sent = host
        .writer
        .lock()
        .map_err(|_| BrowserError::Transport)
        .and_then(|mut writer| {
            transport::write_frame(&mut *writer, &outgoing, transport::MAX_REQUEST_BYTES)
        });
    let result = sent.and_then(|()| await_reply(host, &request, receiver));
    host.pending
        .lock()
        .map_err(|_| BrowserError::Transport)?
        .remove(&id);
    if result.is_err() {
        let cancellation = serde_json::json!({"type":"cancel", "id":id});
        // Best effort: a closed Chrome pipe has no remaining request to cancel.
        if let Ok(mut writer) = host.writer.lock() {
            if let Err(error) =
                transport::write_frame(&mut *writer, &cancellation, transport::MAX_REQUEST_BYTES)
            {
                eprintln!("{error}");
            }
        }
    }
    result
}

fn await_reply(
    host: &Host,
    request: &BridgeRequest,
    receiver: mpsc::Receiver<BrowserReply>,
) -> Result<BrowserReply> {
    let timeout = if matches!(request.request.operation, Operation::Status) {
        STATUS_TIMEOUT
    } else {
        REQUEST_TIMEOUT
    };
    let deadline = Instant::now() + timeout;
    loop {
        config::authorize(&host.root, &request.client_id, &request.token)?;
        if !host.alive.load(Ordering::Acquire) {
            return Err(BrowserError::Disconnected);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(BrowserError::Timeout);
        }
        match receiver.recv_timeout(remaining.min(REVOCATION_INTERVAL)) {
            Ok(reply) => {
                config::authorize(&host.root, &request.client_id, &request.token)?;
                return Ok(reply);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(BrowserError::Disconnected),
        }
    }
}

pub(super) fn endpoints(root: &std::path::Path) -> Vec<Endpoint> {
    let Ok(entries) = fs::read_dir(root.join("endpoints")) else {
        return Vec::new();
    };
    // Stale files left by a terminated browser are ignored; liveness is checked by the caller.
    entries
        .flatten()
        .take(256)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() || metadata.len() > 1024 {
                return None;
            }
            let bytes = fs::read(entry.path()).ok()?;
            let endpoint: Endpoint = serde_json::from_slice(&bytes).ok()?;
            (Uuid::parse_str(&endpoint.id).is_ok()
                && endpoint.port != 0
                && entry.file_name().to_str() == Some(&format!("{}.json", endpoint.id)))
            .then_some(endpoint)
        })
        .take(32)
        .collect()
}

pub(super) fn call(endpoint: &Endpoint, request: &BridgeRequest) -> Result<BrowserReply> {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(400))
        .map_err(|_| BrowserError::Disconnected)?;
    let timeout = if matches!(request.request.operation, Operation::Status) {
        Duration::from_secs(2)
    } else {
        REQUEST_TIMEOUT + Duration::from_secs(5)
    };
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| BrowserError::Transport)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| BrowserError::Transport)?;
    transport::write_frame(&mut stream, request, transport::MAX_REQUEST_BYTES)?;
    transport::read_frame(&mut stream, transport::MAX_RESPONSE_BYTES)?
        .ok_or(BrowserError::Disconnected)
}
