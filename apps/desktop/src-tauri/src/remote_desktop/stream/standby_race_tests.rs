use super::*;

async fn send_before_direct_ping(stream: &Stream, channel: &RTCDataChannel, message: &str) {
    let mut heartbeat = stream.heartbeat.subscribe();
    channel.send_text(message).await.unwrap();
    // Both messages use the same ordered channel; this proves the early control was processed.
    channel.send_text(r#"{"kind":"ping"}"#).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), heartbeat.changed())
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn early_standby_controls_never_cancel_a_promoted_desktop() {
    let stream = fixture(true).await;
    let original = Arc::clone(&stream.peer.borrow());
    let (relay_client, relay_channel) = connect(&original).await;
    let probe = pending(&stream).await;
    let (direct_client, _) = connect(&probe).await;
    assert_eq!(commit(&stream, 1).await.unwrap().committed, Some(true));
    for message in [
        r#"{"kind":"standby-ping"}"#,
        r#"{"kind":"standby-activate"}"#,
    ] {
        send_before_direct_ping(&stream, &relay_channel, message).await;
        assert!(
            !*stream.cancel.borrow(),
            "early standby control cancelled capture"
        );
        assert!(Arc::ptr_eq(&stream.peer.borrow(), &probe));
        assert!(is_retiring(&stream, &original).await);
    }
    stream.close().await;
    direct_client.close().await;
    relay_client.close().await;
}

#[tokio::test]
async fn unregistered_standby_controls_are_consumed_without_granting_liveness() {
    let stream = fixture(true).await;
    let peer = Arc::clone(&stream.peer.borrow());
    let heartbeat = *stream.heartbeat.borrow();
    for message in [
        br#"{"kind":"standby-ping"}"#.as_slice(),
        br#"{"kind":"standby-activate"}"#.as_slice(),
    ] {
        assert!(super::super::super::relay::receive(&stream, &peer, message).await);
        assert_eq!(*stream.heartbeat.borrow(), heartbeat);
        assert!(Arc::ptr_eq(&stream.peer.borrow(), &peer));
    }
    assert!(!super::super::super::relay::receive(&stream, &peer, br#"{"kind":"move"}"#).await);
    stream.close().await;
}
