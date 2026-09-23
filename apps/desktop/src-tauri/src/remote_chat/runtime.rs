use std::{
    io::ErrorKind,
    net::TcpStream,
    sync::mpsc as sync_mpsc,
    thread,
    time::{Duration, Instant},
};

use crate::codex_gui::upload_policy::UploadPolicyStore;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::{mpsc, watch};
use tungstenite::{stream::MaybeTlsStream, Error as SocketError, Message, WebSocket};

use super::{
    bridge::Bridge,
    config::Config,
    protocol::{ChatError, Command, Envelope, Event, Outgoing, FRAME_LIMIT},
    sessions::Sessions,
    SendRequest,
};

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;
type Dial = sync_mpsc::Receiver<Result<Socket, ChatError>>;
#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const RECONNECT_DELAY: Duration = Duration::from_millis(1500);
const PING_INTERVAL: Duration = Duration::from_secs(20);
const RECEIVE_TIMEOUT: Duration = Duration::from_secs(60);
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const COMMANDS_PER_TICK: usize = 64;

pub(super) fn run(
    mut commands: mpsc::Receiver<Command>,
    mut configs: watch::Receiver<Option<Config>>,
    upload_policy: Arc<UploadPolicyStore>,
) {
    let mut runtime = Runtime {
        upload_policy,
        ..Runtime::default()
    };
    loop {
        for _ in 0..COMMANDS_PER_TICK {
            match commands.try_recv() {
                Ok(command) => runtime.command(command),
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => return,
            }
        }
        if configs.has_changed().unwrap_or(false) {
            runtime.configure(configs.borrow_and_update().clone());
        }
        runtime.tick();
        if runtime.socket.is_none() {
            thread::sleep(POLL_INTERVAL);
        }
    }
}

struct ConnectionTimes {
    opened: Instant,
    received: Instant,
    pinged: Instant,
}

pub(super) struct Runtime {
    upload_policy: Arc<UploadPolicyStore>,
    config: Option<Config>,
    bridge: Option<Bridge>,
    socket: Option<Socket>,
    dial: Option<(u64, Dial)>,
    generation: u64,
    sessions: Sessions,
    retry_at: Instant,
    times: ConnectionTimes,
    registered: bool,
    binary_relay: bool,
}

impl Default for Runtime {
    fn default() -> Self {
        let now = Instant::now();
        Self {
            upload_policy: Arc::default(),
            config: None,
            bridge: None,
            socket: None,
            dial: None,
            generation: 0,
            sessions: Sessions::default(),
            retry_at: now,
            registered: false,
            binary_relay: false,
            times: ConnectionTimes {
                opened: now,
                received: now,
                pinged: now,
            },
        }
    }
}

impl Runtime {
    pub(super) fn command(&mut self, command: Command) {
        match command {
            Command::Attach { client_id, deliver } => {
                self.bridge = Some(Bridge::new(client_id, deliver));
                self.reset();
                self.retry_at = Instant::now();
            }
            Command::Detach(id) if self.is_client(&id) => {
                self.reset();
                self.bridge = None;
            }
            Command::Reconnect(request)
                if self.is_client(&request.client_id) && request.generation == self.generation =>
            {
                if request.reset {
                    self.reset();
                } else if self.socket.is_some() {
                    self.disconnect();
                }
            }
            Command::Ack(request) if self.is_client(&request.client_id) => {
                if let Some(bridge) = self.bridge.as_mut() {
                    bridge.acknowledge(request.sequence);
                }
            }
            Command::Send(request) => self.send(request),
            _ => {}
        }
    }

    fn is_client(&self, id: &str) -> bool {
        self.bridge
            .as_ref()
            .is_some_and(|bridge| bridge.client_id == id)
    }

    pub(super) fn configure(&mut self, config: Option<Config>) {
        if self.config == config {
            return;
        }
        let same_owner = self
            .config
            .as_ref()
            .zip(config.as_ref())
            .is_some_and(|(old, new)| old.same_owner(new));
        self.config = config;
        if same_owner {
            self.disconnect();
        } else {
            self.reset();
            if self.upload_policy.update(&json!({})).is_err() {
                eprintln!("remote chat: could not reset upload policy");
            }
        }
        self.retry_at = Instant::now();
    }

    fn emit(&mut self, event: Event) {
        let envelope = Envelope {
            generation: self.generation,
            event,
        };
        if self
            .bridge
            .as_mut()
            .is_some_and(|bridge| !bridge.enqueue(envelope))
        {
            // Resume credentials are unsafe after dropping application frames. Start a fresh session.
            self.reset();
        }
    }

    fn disconnect(&mut self) {
        self.socket = None;
        self.generation += 1;
        self.registered = false;
        self.retry_at = Instant::now() + RECONNECT_DELAY;
        // Pairing may have arrived while the WebView was paused. Such peers do not yet have
        // usable encryption keys and must not be claimed on a replacement connection.
        for session_id in self.sessions.disconnected() {
            self.emit(Event::Message {
                data: json!({ "type": "peer-close", "sessionId": session_id }).to_string(),
            });
        }
        self.emit(Event::Disconnected);
    }

    fn reset(&mut self) {
        self.socket = None;
        self.generation += 1;
        self.registered = false;
        self.sessions.clear();
        self.retry_at = Instant::now() + RECONNECT_DELAY;
        if let Some(bridge) = self.bridge.as_mut() {
            bridge.reset(self.generation);
        }
    }

    pub(super) fn tick(&mut self) {
        self.finish_dial();
        if self.bridge.as_mut().is_some_and(|bridge| !bridge.flush()) {
            self.reset();
            self.bridge = None;
        }
        self.start_dial();
        if self.socket.is_none() {
            return;
        }
        if self.read().is_err() {
            self.disconnect();
            return;
        }
        let now = Instant::now();
        if now.duration_since(self.times.received) > RECEIVE_TIMEOUT
            || (!self.registered && now.duration_since(self.times.opened) > AUTH_TIMEOUT)
        {
            self.disconnect();
            return;
        }
        if now.duration_since(self.times.pinged) >= PING_INTERVAL {
            self.times.pinged = now;
            if self.write(Message::Ping(Vec::new().into())).is_err() {
                self.disconnect();
            }
        }
    }

    fn start_dial(&mut self) {
        if self.socket.is_some()
            || self.dial.is_some()
            || self.bridge.is_none()
            || Instant::now() < self.retry_at
        {
            return;
        }
        let Some(config) = self.config.as_ref() else {
            return;
        };
        let url = config.websocket_url.clone();
        let (sender, receiver) = sync_mpsc::channel();
        self.dial = Some((self.generation, receiver));
        // DNS, proxy CONNECT and TLS may block. Control commands remain responsive while dialing.
        thread::spawn(move || {
            let socket = dial(&url);
            // A closed receiver means the host stopped while the connection was being established.
            if sender.send(socket).is_err() {
                eprintln!("remote chat: canceled connection attempt");
            }
        });
    }

    fn finish_dial(&mut self) {
        let Some((generation, receiver)) = &self.dial else {
            return;
        };
        let result = match receiver.try_recv() {
            Ok(result) => result,
            Err(sync_mpsc::TryRecvError::Empty) => return,
            Err(sync_mpsc::TryRecvError::Disconnected) => Err(ChatError::Transport),
        };
        let generation = *generation;
        self.dial = None;
        if generation != self.generation || self.bridge.is_none() {
            return;
        }
        match result.and_then(|socket| self.authenticate(socket)) {
            Ok(()) => {}
            Err(_) => self.disconnect(),
        }
    }

    fn authenticate(&mut self, mut socket: Socket) -> Result<(), ChatError> {
        self.binary_relay = false;
        let config = self.config.as_ref().ok_or(ChatError::Transport)?;
        let frame = json!({ "type": "authenticate", "role": "desktop", "transportVersion": 2, "binaryRelay": true,
            "accessToken": config.access_token, "deviceId": config.device_id,
            "sessions": self.sessions.authentication() });
        socket
            .send(Message::Text(frame.to_string().into()))
            .map_err(|_| ChatError::Transport)?;
        let now = Instant::now();
        self.times = ConnectionTimes {
            opened: now,
            received: now,
            pinged: now,
        };
        self.socket = Some(socket);
        // Resume notifications can precede `registered`; their encrypted probes must be writable.
        self.emit(Event::Ready);
        Ok(())
    }

    fn read(&mut self) -> Result<(), ChatError> {
        let Some(socket) = self.socket.as_mut() else {
            return Ok(());
        };
        match socket.read() {
            Ok(Message::Text(text)) => {
                self.times.received = Instant::now();
                self.receive(text.as_str())?;
            }
            Ok(Message::Ping(payload)) => {
                self.times.received = Instant::now();
                self.write(Message::Pong(payload))?;
            }
            Ok(Message::Pong(_)) => self.times.received = Instant::now(),
            Ok(Message::Close(frame)) => {
                if frame.is_some_and(|frame| matches!(u16::from(frame.code), 4000 | 4001)) {
                    self.reset();
                }
                return Err(ChatError::Transport);
            }
            Err(SocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Ok(Message::Binary(bytes)) if self.binary_relay => {
                self.times.received = Instant::now();
                self.receive(&super::wire::decode(&bytes)?)?;
            }
            Err(_) | Ok(Message::Binary(_)) => return Err(ChatError::Transport),
            Ok(_) => {}
        }
        Ok(())
    }

    fn receive(&mut self, text: &str) -> Result<(), ChatError> {
        if text.len() > FRAME_LIMIT {
            return Err(ChatError::InvalidFrame);
        }
        let message: serde_json::Value =
            serde_json::from_str(text).map_err(|_| ChatError::InvalidFrame)?;
        if message["type"] == "chat-policy" {
            self.binary_relay |= message["binaryRelay"] == true;
            self.upload_policy
                .update(&message["policy"])
                .map_err(|_| ChatError::InvalidFrame)?;
        }
        self.sessions.receive(&message)?;
        if message["type"] == "registered" {
            self.registered = true;
        } else {
            self.emit(Event::Message {
                data: text.to_owned(),
            });
        }
        Ok(())
    }

    fn send(&mut self, request: SendRequest) {
        if !self.is_client(&request.client_id)
            || !self.sessions.contains(request.message.session_id())
        {
            return;
        }
        if let Outgoing::PeerClose { session_id } = &request.message {
            // A local expiry may race a native reconnect. Never resume keys that the frontend destroyed.
            // Session UUIDs are not reused across owners, so forgetting is safe across socket generations.
            self.sessions.remove(session_id);
        } else if request.generation != self.generation {
            return;
        }
        if self.socket.is_none() {
            return;
        }
        let Ok(frame) = super::wire::encode(&request.message, self.binary_relay) else {
            return;
        };
        if self.write(frame).is_err() {
            self.disconnect();
        } else if matches!(&request.message, Outgoing::Signal { payload, .. } if payload["kind"] == "key")
        {
            self.sessions.key_sent(request.message.session_id());
        }
    }

    fn write(&mut self, message: Message) -> Result<(), ChatError> {
        self.socket
            .as_mut()
            .ok_or(ChatError::Transport)?
            .send(message)
            .map_err(|_| ChatError::Transport)
    }
}

fn dial(url: &str) -> Result<Socket, ChatError> {
    let (mut socket, _) =
        crate::remote_websocket::connect_remote_websocket(url).map_err(|_| ChatError::Transport)?;
    let stream = match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream,
        MaybeTlsStream::Rustls(stream) => &mut stream.sock,
        _ => return Err(ChatError::Transport),
    };
    stream
        .set_read_timeout(Some(POLL_INTERVAL))
        .map_err(|_| ChatError::Transport)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| ChatError::Transport)?;
    socket.set_config(|config| {
        config.max_message_size = Some(FRAME_LIMIT);
        config.max_frame_size = Some(FRAME_LIMIT);
        config.max_write_buffer_size = 2 * FRAME_LIMIT;
        config.write_buffer_size = 0;
    });
    Ok(socket)
}
