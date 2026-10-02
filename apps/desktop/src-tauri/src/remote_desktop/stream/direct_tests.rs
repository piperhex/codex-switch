use super::*;
use crate::remote_desktop::{
    displays::{Bounds, DisplayInfo},
    monitors::Monitor,
};
use tokio::sync::{mpsc, watch, Mutex};
use webrtc::{
    data_channel::RTCDataChannel, peer_connection::sdp::session_description::RTCSessionDescription,
};

#[test]
fn reservations_bound_concurrent_creation_and_ignore_replayed_generations() {
    let mut state = Upgrades::default();
    reserve(&mut state, 1).unwrap();
    state.started = Some(Instant::now() - Duration::from_secs(10));
    assert!(reserve(&mut state, 2).is_err());
    state.creating = false;
    assert!(reserve(&mut state, 1).is_err());
    reserve(&mut state, 2).unwrap();
    assert_eq!(state.generation, 2);
}

async fn fixture() -> Arc<Stream> {
    let peer = Arc::new(peer::create(vec![], false).await.unwrap());
    let stream = Arc::new(Stream {
        id: "direct-upgrade-unit-test".into(),
        display: Monitor {
            handle: 0,
            bounds: Bounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
            info: DisplayInfo {
                id: "fixture".into(),
                name: "fixture".into(),
                width: 1,
                height: 1,
                primary: true,
            },
        },
        peer: watch::channel(Arc::clone(&peer)).0,
        initial_peer: Arc::downgrade(&peer),
        upgrades: Mutex::new(Upgrades::default()),
        ice_servers: vec![],
        separate_clipboard: false,
        inputs: mpsc::channel(1).0,
        clipboard_inputs: mpsc::channel(1).0,
        profile: watch::channel(Profile {
            adaptive_fps: false,
            width: 1280,
            fps: 30,
            bitrate: 1_000_000,
        })
        .0,
        connected: watch::channel(true).0,
        cancel: watch::channel(false).0,
        heartbeat: watch::channel(Instant::now()).0,
        stats: Mutex::new(StreamStats::default()),
        last_frame: Mutex::new(Instant::now()),
        audio: Mutex::new(AudioState::Unavailable),
    });
    peer::bind(&stream, &peer);
    stream
}

async fn pending(stream: &Arc<Stream>) -> Arc<Peer> {
    let peer = Arc::new(peer::create(vec![], false).await.unwrap());
    peer::bind(stream, &peer);
    let mut state = stream.upgrades.lock().await;
    state.generation = 1;
    state.pending = Some(Arc::clone(&peer));
    peer
}

async fn connect(host: &Arc<Peer>) -> (Peer, Arc<RTCDataChannel>) {
    let client = peer::create(vec![], false).await.unwrap();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    client.connection.on_data_channel(Box::new(move |channel| {
        sender.send(channel).unwrap();
        Box::pin(async {})
    }));
    let mut gathering = host.connection.gathering_complete_promise().await;
    host.offer().await.unwrap();
    gathering.recv().await;
    client
        .connection
        .set_remote_description(host.connection.local_description().await.unwrap())
        .await
        .unwrap();
    let mut gathering = client.connection.gathering_complete_promise().await;
    let answer = client.connection.create_answer(None).await.unwrap();
    client
        .connection
        .set_local_description(answer)
        .await
        .unwrap();
    gathering.recv().await;
    let sdp = client.connection.local_description().await.unwrap().sdp;
    host.connection
        .set_remote_description(RTCSessionDescription::answer(sdp).unwrap())
        .await
        .unwrap();
    let channel = tokio::time::timeout(Duration::from_secs(10), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while host.controls.ready_state()
            != webrtc::data_channel::data_channel_state::RTCDataChannelState::Open
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    (client, channel)
}

#[tokio::test]
async fn failed_probe_and_stale_requests_never_close_the_active_peer() {
    let stream = fixture().await;
    let original = Arc::clone(&stream.peer.borrow());
    let probe = pending(&stream).await;
    assert_eq!(commit(&stream, 1).await.unwrap().committed, Some(false));
    assert!(commit(&stream, 2).await.is_err());
    cancel(&stream, 2).await;
    assert!(stream.upgrades.lock().await.pending.is_some());
    cancel(&stream, 1).await;
    assert_eq!(
        probe.connection.connection_state(),
        RTCPeerConnectionState::Closed
    );
    assert_eq!(commit(&stream, 1).await.unwrap().committed, Some(false));
    assert!(Arc::ptr_eq(&stream.peer.borrow(), &original));
    assert!(!*stream.cancel.borrow());
    stream.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn promotion_is_idempotent_and_retires_the_old_peer_only_after_new_channel_ping() {
    let stream = fixture().await;
    let original = Arc::clone(&stream.peer.borrow());
    let probe = pending(&stream).await;
    let (client, channel) = connect(&probe).await;
    assert!(probe.direct().await);
    for _ in 0..2 {
        assert_eq!(commit(&stream, 1).await.unwrap().committed, Some(true));
    }
    cancel(&stream, 1).await;
    assert!(Arc::ptr_eq(&stream.peer.borrow(), &probe));
    assert!(is_retiring(&stream, &original).await);
    assert_ne!(
        original.connection.connection_state(),
        RTCPeerConnectionState::Closed
    );
    channel.send_text(r#"{"kind":"ping"}"#).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while original.connection.connection_state() != RTCPeerConnectionState::Closed {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(!*stream.cancel.borrow());
    assert_eq!(
        probe.connection.connection_state(),
        RTCPeerConnectionState::Connected
    );
    stream.close().await;
    client.close().await;
}
