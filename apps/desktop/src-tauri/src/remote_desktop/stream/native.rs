use super::super::{DesktopError, Result};
use super::{
    encoder::Encoder,
    model::*,
    peer::{self, Peer},
    pump,
};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch, Mutex};
use webrtc::{
    ice_transport::ice_candidate::RTCIceCandidateInit,
    peer_connection::sdp::session_description::RTCSessionDescription,
};

pub(super) struct Stream {
    pub id: String,
    pub peer: Peer,
    pub candidates: Mutex<Vec<serde_json::Value>>,
    pub profile: watch::Sender<Profile>,
    pub connected: watch::Sender<bool>,
    pub cancel: watch::Sender<bool>,
    pub heartbeat: watch::Sender<Instant>,
    pub stats: Mutex<StreamStats>,
    pub last_frame: Mutex<Instant>,
    received_candidates: Mutex<usize>,
}

impl Stream {
    pub async fn open(path: PathBuf, request: OpenRequest) -> Result<(Arc<Self>, Offer)> {
        let profile = request.profile.validate()?;
        if request.ice_servers.len() > 8 {
            return Err(DesktopError::Invalid);
        }
        for server in &request.ice_servers {
            server.validate()?;
        }
        let (mut encoder, _) = Encoder::open(&path, profile).await?;
        let peer = match peer::create(request.ice_servers).await {
            Ok(peer) => peer,
            Err(error) => {
                encoder.stop().await;
                return Err(error);
            }
        };
        let stream = Arc::new(Self {
            id: request.id,
            peer,
            candidates: Mutex::new(Vec::new()),
            profile: watch::channel(profile).0,
            connected: watch::channel(false).0,
            cancel: watch::channel(false).0,
            heartbeat: watch::channel(Instant::now()).0,
            stats: Mutex::new(StreamStats::default()),
            last_frame: Mutex::new(Instant::now()),
            received_candidates: Mutex::new(0),
        });
        let (inputs, receiver) = mpsc::channel(64);
        peer::bind(&stream, inputs);
        let offer = stream.offer().await;
        if offer.is_err() {
            encoder.stop().await;
            stream.close().await;
        }
        let offer = offer?;
        tokio::spawn(pump::run(Arc::clone(&stream), path, encoder));
        tokio::spawn(pump::inputs(Arc::clone(&stream), receiver));
        Ok((stream, offer))
    }

    async fn offer(&self) -> Result<Offer> {
        let offer = self
            .peer
            .connection
            .create_offer(None)
            .await
            .map_err(|_| DesktopError::Platform)?;
        let sdp = offer.sdp.clone();
        self.peer
            .connection
            .set_local_description(offer)
            .await
            .map_err(|_| DesktopError::Platform)?;
        Ok(Offer { sdp })
    }

    pub async fn signal(&self, request: SignalRequest) -> Result<SignalReply> {
        let mut received = self.received_candidates.lock().await;
        if request.candidates.len() + *received > super::MAX_CANDIDATES {
            return Err(DesktopError::Invalid);
        }
        if let Some(answer) = request.answer {
            if answer.len() > 64_000 || self.peer.connection.remote_description().await.is_some() {
                return Err(DesktopError::Invalid);
            }
            let description =
                RTCSessionDescription::answer(answer).map_err(|_| DesktopError::Invalid)?;
            self.peer
                .connection
                .set_remote_description(description)
                .await
                .map_err(|_| DesktopError::Platform)?;
        }
        for candidate in request.candidates {
            let candidate: RTCIceCandidateInit =
                serde_json::from_value(candidate).map_err(|_| DesktopError::Invalid)?;
            if candidate.candidate.len() > 4096 {
                return Err(DesktopError::Invalid);
            }
            self.peer
                .connection
                .add_ice_candidate(candidate)
                .await
                .map_err(|_| DesktopError::Platform)?;
            *received += 1;
        }
        Ok(SignalReply {
            candidates: self.candidates.lock().await.drain(..).collect(),
        })
    }

    pub async fn close(&self) {
        self.cancel.send_replace(true);
        self.stats.lock().await.closed = true;
        if let Err(error) = self.peer.connection.close().await {
            eprintln!("desktop media cleanup: {error}");
        }
        self.peer.transports.close();
    }

    pub async fn keep_alive(&self) -> Result<()> {
        if *self.connected.borrow() && self.heartbeat.borrow().elapsed() > Duration::from_secs(12) {
            return Err(DesktopError::Expired);
        }
        let id = self.id.clone();
        tauri::async_runtime::spawn_blocking(move || super::super::with_session(&id, || Ok(())))
            .await
            .map_err(|_| DesktopError::Platform)?
    }
}
