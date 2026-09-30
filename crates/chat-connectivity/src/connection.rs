use std::{sync::Arc, time::Duration};

use easytier::instance::factory::{create_native_instance, NativeCoreInstance};
use easytier_core::gateway::DataPlaneTcpStream;
use serde::Serialize;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, watch, Mutex},
};

use crate::{
    config::CHAT_PORT,
    route::{self, RouteStatus},
    Config, Error, Result,
};

const QUEUE_MESSAGES: usize = 8;
const MAX_FRAME: usize = 128 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Event {
    Status { route: RouteStatus },
    Open,
    Data { text: String },
    Closed,
}

/// One bounded, authenticated stream. Dropping it cancels the engine and its mapping leases.
pub struct Connection {
    sender: mpsc::Sender<String>,
    events: Mutex<mpsc::Receiver<Event>>,
    cancel: watch::Sender<bool>,
    deadline: watch::Sender<u64>,
}

impl Connection {
    pub fn start(config: Config) -> Result<Arc<Self>> {
        config.validate()?;
        let (sender, incoming) = mpsc::channel(QUEUE_MESSAGES);
        let (events, receiver) = mpsc::channel(QUEUE_MESSAGES);
        let cancel = watch::channel(false).0;
        let deadline = watch::channel(config.expires_at).0;
        let canceled = cancel.subscribe();
        let expiry = deadline.subscribe();
        tokio::spawn(async move {
            // All exit paths close the event stream, including engine initialization errors.
            let _outcome = serve(config, incoming, &events, (canceled, expiry)).await;
            // A stopped/suspended frontend must not prevent native resource cleanup.
            let _delivered =
                tokio::time::timeout(Duration::from_secs(1), events.send(Event::Closed)).await;
        });
        Ok(Arc::new(Self {
            sender,
            events: Mutex::new(receiver),
            cancel,
            deadline,
        }))
    }

    pub async fn send(&self, text: String) -> Result<()> {
        if self.is_closed() {
            return Err(Error::Closed);
        }
        if text.is_empty() || text.len() > MAX_FRAME {
            return Err(Error::Invalid);
        }
        tokio::time::timeout(CONNECT_TIMEOUT, self.sender.send(text))
            .await
            .map_err(|_| Error::Unavailable)?
            .map_err(|_| Error::Closed)
    }

    pub async fn receive(&self) -> Option<Event> {
        self.events.lock().await.recv().await
    }

    pub fn close(&self) {
        self.cancel.send_replace(true);
    }
    pub fn is_closed(&self) -> bool {
        self.sender.is_closed() || *self.cancel.borrow()
    }

    /// Only an authenticated signaling renewal may extend the lease.
    pub fn renew(&self, expires_at: u64) -> Result<()> {
        if expires_at <= crate::lease::now_ms() || *self.cancel.borrow() {
            return Err(Error::Closed);
        }
        self.deadline.send_replace(expires_at);
        Ok(())
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.close();
    }
}

async fn serve(
    config: Config,
    incoming: mpsc::Receiver<String>,
    events: &mpsc::Sender<Event>,
    controls: (watch::Receiver<bool>, watch::Receiver<u64>),
) -> Result<()> {
    let (mut canceled, expiry) = controls;
    let core = config.core()?;
    let engine = tokio::task::spawn_blocking(move || create_native_instance(core))
        .await
        .map_err(|_| Error::Unavailable)?
        .map_err(|_| Error::Unavailable)?;
    let result = tokio::select! {
        _ = canceled.changed() => Ok(()),
        _ = crate::lease::expired(expiry) => Ok(()),
        result = run(&engine, &config, incoming, events.clone()) => result,
    };
    engine.stop().await;
    result
}

async fn run(
    instance: &Arc<NativeCoreInstance>,
    config: &Config,
    mut incoming: mpsc::Receiver<String>,
    events: mpsc::Sender<Event>,
) -> Result<()> {
    instance.start().await.map_err(|_| Error::Unavailable)?;
    loop {
        let connected = connect(instance, config).await;
        let Ok(stream) = connected else {
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        };
        if !route::status(instance, config.remote_name()).await.direct {
            continue;
        }
        events.send(Event::Open).await.map_err(|_| Error::Closed)?;
        let _disconnected = pump(instance, config, stream, (&mut incoming, &events)).await;
        events
            .send(Event::Status {
                route: RouteStatus::default(),
            })
            .await
            .map_err(|_| Error::Closed)?;
        if incoming.is_closed() {
            return Ok(());
        }
    }
}

async fn connect(
    instance: &Arc<NativeCoreInstance>,
    config: &Config,
) -> Result<DataPlaneTcpStream> {
    if config.desktop {
        let mut listener = instance
            .data_plane_tcp_bind(CHAT_PORT, CONNECT_TIMEOUT)
            .await
            .map_err(|_| Error::Unavailable)?;
        let (stream, _) = listener.accept().await?;
        return Ok(stream);
    }
    while !route::status(instance, config.remote_name()).await.direct {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    instance
        .data_plane_tcp_connect(config.remote_address(), CONNECT_TIMEOUT)
        .await
        .map_err(|_| Error::Unavailable)
}

async fn pump(
    instance: &Arc<NativeCoreInstance>,
    config: &Config,
    stream: DataPlaneTcpStream,
    queues: (&mut mpsc::Receiver<String>, &mpsc::Sender<Event>),
) -> Result<()> {
    let (read, write) = tokio::io::split(stream);
    let (incoming, events) = queues;
    // Each I/O future stays alive across health ticks; canceling a partial frame would corrupt framing.
    tokio::try_join!(
        read_frames(read, events),
        write_frames(write, incoming),
        monitor(instance, config.remote_name(), events)
    )?;
    Ok(())
}

async fn monitor(
    instance: &NativeCoreInstance,
    remote: &str,
    events: &mpsc::Sender<Event>,
) -> Result<()> {
    let mut timer = tokio::time::interval(Duration::from_millis(500));
    let mut previous = RouteStatus::default();
    loop {
        timer.tick().await;
        let status = route::status(instance, remote).await;
        if !status.direct {
            return Err(Error::Unavailable);
        }
        if status != previous {
            events
                .send(Event::Status {
                    route: status.clone(),
                })
                .await
                .map_err(|_| Error::Closed)?;
            previous = status;
        }
    }
}

async fn read_frames(
    mut read: impl AsyncReadExt + Unpin,
    events: &mpsc::Sender<Event>,
) -> Result<()> {
    loop {
        let text = read_frame(&mut read).await?;
        events
            .send(Event::Data { text })
            .await
            .map_err(|_| Error::Closed)?;
    }
}

async fn write_frames(
    mut write: impl AsyncWriteExt + Unpin,
    incoming: &mut mpsc::Receiver<String>,
) -> Result<()> {
    while let Some(text) = incoming.recv().await {
        write.write_u32(text.len() as u32).await?;
        write.write_all(text.as_bytes()).await?;
    }
    Err(Error::Closed)
}

async fn read_frame(read: &mut (impl AsyncReadExt + Unpin)) -> Result<String> {
    let length = read.read_u32().await? as usize;
    if length == 0 || length > MAX_FRAME {
        return Err(Error::Invalid);
    }
    let mut bytes = vec![0; length];
    read.read_exact(&mut bytes).await?;
    String::from_utf8(bytes).map_err(|_| Error::Invalid)
}
