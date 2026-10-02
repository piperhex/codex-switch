use super::*;
use crate::tests::{endpoint as engine_endpoint, engine, local_core};
use webrtc::{
    api::{media_engine::MediaEngine, APIBuilder},
    ice_transport::ice_server::RTCIceServer,
    peer_connection::{
        configuration::RTCConfiguration, policy::ice_transport_policy::RTCIceTransportPolicy,
        RTCPeerConnection,
    },
};

pub(super) async fn pair() -> (Arc<NativeCoreInstance>, Arc<NativeCoreInstance>) {
    let host = engine(local_core(true, "native-media"));
    let client = engine(local_core(false, "native-media"));
    host.start().await.unwrap();
    client.start().await.unwrap();
    client.add_connector(engine_endpoint(&host)).unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if crate::route::status(&client, "csw-host").await.direct
                && crate::route::status(&host, "csw-client").await.direct
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    (host, client)
}

async fn peer(endpoint: MediaEndpoint) -> Arc<RTCPeerConnection> {
    let mut media = MediaEngine::default();
    media.register_default_codecs().unwrap();
    let api = APIBuilder::new().with_media_engine(media).build();
    Arc::new(
        api.new_peer_connection(RTCConfiguration {
            ice_servers: vec![RTCIceServer {
                urls: endpoint.urls,
                username: endpoint.username,
                credential: endpoint.credential,
            }],
            ice_transport_policy: RTCIceTransportPolicy::Relay,
            ..Default::default()
        })
        .await
        .unwrap(),
    )
}

async fn negotiate(host: &RTCPeerConnection, viewer: &RTCPeerConnection) {
    let mut gathering = host.gathering_complete_promise().await;
    host.set_local_description(host.create_offer(None).await.unwrap())
        .await
        .unwrap();
    gathering.recv().await;
    viewer
        .set_remote_description(host.local_description().await.unwrap())
        .await
        .unwrap();
    let mut gathering = viewer.gathering_complete_promise().await;
    viewer
        .set_local_description(viewer.create_answer(None).await.unwrap())
        .await
        .unwrap();
    gathering.recv().await;
    host.set_remote_description(viewer.local_description().await.unwrap())
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn webrtc_media_and_control_use_native_direct_datagrams_and_close_with_the_grant() {
    let (host_engine, viewer_engine) = pair().await;
    let (grant, lifetime) = watch::channel(false);
    let (route, status) = watch::channel(crate::route::status(&host_engine, "csw-client").await);
    let host_adapter =
        MediaProxy::start(host_engine.clone(), true, status.clone(), lifetime.clone())
            .await
            .unwrap();
    let viewer_adapter = MediaProxy::start(viewer_engine.clone(), false, status, lifetime)
        .await
        .unwrap();
    let host = peer(host_adapter.endpoint()).await;
    let viewer = peer(viewer_adapter.endpoint()).await;
    let result = tokio::time::timeout(Duration::from_secs(20), exchange(&host, &viewer)).await;
    let selected = host
        .sctp()
        .transport()
        .ice_transport()
        .get_selected_candidate_pair()
        .await;
    grant.send_replace(true);
    assert!(!host_adapter.status().direct && !viewer_adapter.status().direct);
    route.send_replace(RouteStatus::default());
    host.close().await.unwrap();
    viewer.close().await.unwrap();
    host_engine.stop().await;
    viewer_engine.stop().await;
    assert!(
        result.is_ok(),
        "native WebRTC video/control exchange timed out"
    );
    let selected = selected.unwrap();
    assert_eq!(selected.local.address, "10.253.0.1");
    assert_eq!(selected.remote.address, "10.253.0.2");
}

async fn exchange(host: &RTCPeerConnection, viewer: &RTCPeerConnection) {
    let (control_tx, mut control_rx) = tokio::sync::mpsc::channel(1);
    viewer.on_data_channel(Box::new(move |channel| {
        let output = control_tx.clone();
        Box::pin(async move {
            channel.on_message(Box::new(move |message| {
                let output = output.clone();
                Box::pin(async move {
                    output.send(message.data).await.unwrap();
                })
            }));
        })
    }));
    let (video_tx, mut video_rx) = tokio::sync::mpsc::channel(1);
    viewer.on_track(Box::new(move |track, _, _| {
        let output = video_tx.clone();
        Box::pin(async move {
            output
                .send(track.read_rtp().await.unwrap().0.payload)
                .await
                .unwrap();
        })
    }));
    let track = video_track(host).await;
    let controls = host
        .create_data_channel("remote-desktop-controls", None)
        .await
        .unwrap();
    let ready = Arc::new(tokio::sync::Notify::new());
    let opened = ready.clone();
    controls.on_open(Box::new(move || {
        let opened = opened.clone();
        Box::pin(async move {
            opened.notify_one();
        })
    }));
    negotiate(host, viewer).await;
    ready.notified().await;
    controls.send_text("native desktop control").await.unwrap();
    assert_eq!(
        control_rx.recv().await.unwrap().as_ref(),
        b"native desktop control"
    );
    let payload = bytes::Bytes::from_static(b"\0\0\0\x01\x65\x88\x84\x21");
    track
        .write_sample(&webrtc::media::Sample {
            data: payload,
            duration: Duration::from_millis(33),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(video_rx.recv().await.unwrap().starts_with(b"\x65\x88"));
}

async fn video_track(
    host: &RTCPeerConnection,
) -> Arc<webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample> {
    use webrtc::track::track_local::{
        track_local_static_sample::TrackLocalStaticSample, TrackLocal,
    };
    let track = Arc::new(TrackLocalStaticSample::new(
        webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
            mime_type: "video/H264".into(),
            clock_rate: 90_000,
            ..Default::default()
        },
        "video".into(),
        "desktop".into(),
    ));
    host.add_track(track.clone() as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .unwrap();
    track
}

#[test]
fn loopback_credentials_are_scoped_to_the_native_adapter() {
    let descriptor = endpoint("127.0.0.1:12345".parse().unwrap(), true);
    let auth = Authentication(generate_auth_key(
        &descriptor.username,
        REALM,
        &descriptor.credential,
    ));
    assert!(auth
        .auth_handle(
            &descriptor.username,
            REALM,
            "127.0.0.1:23456".parse().unwrap()
        )
        .is_ok());
    assert!(auth
        .auth_handle(
            &descriptor.username,
            REALM,
            "192.0.2.1:23456".parse().unwrap()
        )
        .is_err());
    assert!(auth
        .auth_handle("other", REALM, "127.0.0.1:23456".parse().unwrap())
        .is_err());
    assert!(auth
        .auth_handle(
            &descriptor.username,
            "other",
            "127.0.0.1:23456".parse().unwrap()
        )
        .is_err());
    assert_ne!(
        descriptor.credential,
        endpoint("127.0.0.1:12346".parse().unwrap(), true).credential
    );
}

/// Requires the desktop workspace's Playwright dependency and an installed Edge browser.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "Run explicitly with Edge and npm dependencies installed"]
async fn browser_media_uses_native_datagrams_for_decoded_video_audio_and_controls() {
    let (host_engine, viewer_engine) = pair().await;
    let (_grant, lifetime) = watch::channel(false);
    let (_route, status) = watch::channel(crate::route::status(&host_engine, "csw-client").await);
    let host = MediaProxy::start(host_engine.clone(), true, status.clone(), lifetime.clone())
        .await
        .unwrap();
    let viewer = MediaProxy::start(viewer_engine.clone(), false, status, lifetime)
        .await
        .unwrap();
    let endpoints = serde_json::to_vec(&[host.endpoint(), viewer.endpoint()]).unwrap();
    let result = tokio::task::spawn_blocking(move || {
        use std::{
            io::Write,
            process::{Command, Stdio},
        };
        let runner = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/e2e/native-desktop-media.mjs");
        let mut child = Command::new("node")
            .arg(runner)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&endpoints).unwrap();
        child.wait_with_output().unwrap()
    })
    .await
    .unwrap();
    host.close();
    viewer.close();
    host_engine.stop().await;
    viewer_engine.stop().await;
    println!("{}", String::from_utf8_lossy(&result.stdout));
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
