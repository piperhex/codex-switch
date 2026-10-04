use super::*;
use std::time::Duration;

fn pending(owner: &str, event: &str) -> PendingNotice {
    PendingNotice {
        route: PushRoute {
            base_url: "https://example.test/api".into(),
            owner_id: owner.into(),
        },
        notice: Notice {
            thread_id: "thread".into(),
            event_id: event.into(),
            kind: "completed".into(),
        },
    }
}

#[test]
fn slow_persistence_does_not_block_enqueue_and_preserves_order_and_recipients() {
    let (started, waiting) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let (saved, stored) = mpsc::channel();
    let writer = PushWriter::start(move |notice| {
        if notice.notice.event_id == "first" {
            started.send(()).unwrap();
            blocked.recv_timeout(Duration::from_secs(3)).unwrap();
        }
        saved
            .send((notice.route.owner_id, notice.notice.event_id))
            .unwrap();
    })
    .unwrap();
    writer.enqueue(pending("original", "first")).unwrap();
    waiting.recv_timeout(Duration::from_secs(3)).unwrap();
    writer.enqueue(pending("original", "second")).unwrap();
    writer.enqueue(pending("new-login", "third")).unwrap();
    assert!(stored.try_recv().is_err());
    release.send(()).unwrap();
    for expected in [
        ("original", "first"),
        ("original", "second"),
        ("new-login", "third"),
    ] {
        let actual = stored.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!((actual.0.as_str(), actual.1.as_str()), expected);
    }
}

#[test]
fn saturation_and_a_stopped_worker_return_errors_without_waiting() {
    let (sender, receiver) = mpsc::sync_channel(1);
    let writer = PushWriter(sender);
    writer.enqueue(pending("owner", "first")).unwrap();
    assert!(writer.enqueue(pending("owner", "full")).is_err());
    assert_eq!(receiver.recv().unwrap().notice.event_id, "first");
    drop(receiver);
    assert!(writer.enqueue(pending("owner", "stopped")).is_err());
}
