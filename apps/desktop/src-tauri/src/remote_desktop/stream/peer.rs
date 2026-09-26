use super::super::{DesktopError, Result};
use super::{model::IceServer, native::Stream};
use std::sync::{Arc, Weak};
use webrtc::{
    api::{
        interceptor_registry::register_default_interceptors,
        media_engine::{MediaEngine, MIME_TYPE_H264},
        APIBuilder,
    },
    data_channel::{data_channel_message::DataChannelMessage, RTCDataChannel},
    ice_transport::ice_server::RTCIceServer,
    interceptor::registry::Registry,
    peer_connection::{
        configuration::RTCConfiguration, peer_connection_state::RTCPeerConnectionState,
        RTCPeerConnection,
    },
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::{track_local_static_sample::TrackLocalStaticSample, TrackLocal},
};

pub(super) struct Peer {
    pub connection: Arc<RTCPeerConnection>,
    pub controls: Arc<RTCDataChannel>,
    pub video: Arc<TrackLocalStaticSample>,
    pub feedback: tokio::sync::watch::Receiver<super::feedback::Feedback>,
    pub transports: super::turn_transport::Transports,
}

pub(super) async fn create(mut servers: Vec<IceServer>) -> Result<Peer> {
    let transports = super::turn_transport::prepare(&mut servers).await?;
    let mut media = MediaEngine::default();
    media
        .register_default_codecs()
        .map_err(|_| DesktopError::Platform)?;
    let registry = register_default_interceptors(Registry::new(), &mut media)
        .map_err(|_| DesktopError::Platform)?;
    let api = APIBuilder::new()
        .with_media_engine(media)
        .with_interceptor_registry(registry)
        .build();
    let configuration = RTCConfiguration {
        ice_servers: servers
            .into_iter()
            .map(|server| RTCIceServer {
                urls: server.urls,
                username: server.username,
                credential: server.credential,
            })
            .collect(),
        ..Default::default()
    };
    #[cfg(test)]
    let configuration = RTCConfiguration {
        ice_transport_policy: if std::env::var_os("CSW_NATIVE_TEST_ICE").is_some() {
            webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy::Relay
        } else {
            webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy::All
        },
        ..configuration
    };
    let connection = Arc::new(
        api.new_peer_connection(configuration)
            .await
            .map_err(|_| DesktopError::Platform)?,
    );
    let video = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_H264.into(),
            clock_rate: 90_000,
            sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                .into(),
            ..Default::default()
        },
        "desktop-video".into(),
        "desktop".into(),
    ));
    let sender = connection
        .add_track(Arc::clone(&video) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|_| DesktopError::Platform)?;
    // Reading RTCP drives the default NACK/report interceptors. Periodic IDRs also bound recovery time.
    let feedback = super::feedback::listen(sender);
    let controls = connection
        .create_data_channel("remote-desktop-controls", None)
        .await
        .map_err(|_| DesktopError::Platform)?;
    Ok(Peer {
        connection,
        controls,
        video,
        feedback,
        transports,
    })
}

pub(super) fn bind(stream: &Arc<Stream>, inputs: tokio::sync::mpsc::Sender<bytes::Bytes>) {
    let weak = Arc::downgrade(stream);
    stream
        .peer
        .connection
        .on_ice_candidate(Box::new(move |candidate| {
            let weak = weak.clone();
            Box::pin(async move {
                let (Some(stream), Some(candidate)) = (weak.upgrade(), candidate) else {
                    return;
                };
                let Ok(candidate) = candidate.to_json() else {
                    stream.cancel.send_replace(true);
                    return;
                };
                let Ok(candidate) = serde_json::to_value(candidate) else {
                    stream.cancel.send_replace(true);
                    return;
                };
                let mut pending = stream.candidates.lock().await;
                if pending.len() < super::MAX_CANDIDATES {
                    pending.push(candidate);
                }
            })
        }));
    let weak = Arc::downgrade(stream);
    stream
        .peer
        .connection
        .on_peer_connection_state_change(Box::new(move |state| {
            if let Some(stream) = weak.upgrade() {
                if matches!(
                    state,
                    RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
                ) {
                    stream.cancel.send_replace(true);
                }
            }
            Box::pin(async {})
        }));
    let weak = Arc::downgrade(stream);
    stream.peer.controls.on_open(Box::new(move || {
        if let Some(stream) = weak.upgrade() {
            stream.connected.send_replace(true);
        }
        Box::pin(async {})
    }));
    let weak = Arc::downgrade(stream);
    stream.peer.controls.on_message(Box::new(move |message| {
        receive(&weak, &inputs, message);
        Box::pin(async {})
    }));
    let weak = Arc::downgrade(stream);
    stream.peer.controls.on_close(Box::new(move || {
        if let Some(stream) = weak.upgrade() {
            stream.cancel.send_replace(true);
        }
        Box::pin(async {})
    }));
}

fn receive(
    weak: &Weak<Stream>,
    inputs: &tokio::sync::mpsc::Sender<bytes::Bytes>,
    message: DataChannelMessage,
) {
    let Some(stream) = weak.upgrade() else {
        return;
    };
    if !message.is_string || message.data.len() > 8192 {
        stream.cancel.send_replace(true);
        return;
    }
    if message.data.as_ref() == br#"{"kind":"ping"}"# {
        stream.heartbeat.send_replace(std::time::Instant::now());
        return;
    }
    if inputs.try_send(message.data).is_err() {
        stream.cancel.send_replace(true);
    }
}
