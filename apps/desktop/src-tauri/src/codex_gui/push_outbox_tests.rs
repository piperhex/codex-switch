use super::*;

struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("push-outbox-{}", uuid::Uuid::new_v4())))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn identity() -> PushIdentity {
    PushIdentity {
        base_url: "https://example.test/api".into(),
        owner_id: "owner".into(),
        device_id: "pc".into(),
    }
}
fn notice(id: usize) -> Notice {
    Notice {
        thread_id: "thread".into(),
        event_id: format!("event-{id}"),
        kind: "completed".into(),
    }
}

#[test]
fn survives_restart_and_more_than_the_old_queue_capacity() {
    let root = Fixture::new();
    {
        let connection = open(&root.0).unwrap();
        for id in 0..260 {
            insert(&connection, &identity(), &notice(id)).unwrap();
        }
    }
    let connection = open(&root.0).unwrap();
    let mut delivered = 0;
    loop {
        let batch = due(&connection, &identity(), 0).unwrap();
        if batch.is_empty() {
            break;
        }
        delivered += batch.len();
        for entry in batch {
            acknowledge(&connection, entry.id).unwrap();
        }
    }
    assert_eq!(delivered, 260);
}

#[test]
fn retries_keep_events_until_acknowledged_without_resetting_backoff() {
    let root = Fixture::new();
    let connection = open(&root.0).unwrap();
    insert(&connection, &identity(), &notice(1)).unwrap();
    let entry = due(&connection, &identity(), 0).unwrap().remove(0);
    retry(&connection, &entry, 100).unwrap();
    insert(&connection, &identity(), &notice(1)).unwrap();
    assert!(due(&connection, &identity(), 104).unwrap().is_empty());
    let mut entry = due(&connection, &identity(), 105).unwrap().remove(0);
    assert_eq!(entry.attempts, 1);
    entry.attempts = 100;
    retry(&connection, &entry, 1000).unwrap();
    assert!(due(&connection, &identity(), 1299).unwrap().is_empty());
    assert_eq!(
        due(&connection, &identity(), 1300).unwrap()[0].attempts,
        101
    );
    acknowledge(&connection, entry.id).unwrap();
    assert!(due(&connection, &identity(), i64::MAX).unwrap().is_empty());
}

#[test]
fn scopes_isolate_accounts_servers_devices_and_threads() {
    let root = Fixture::new();
    let connection = open(&root.0).unwrap();
    let original = identity();
    insert(&connection, &original, &notice(1)).unwrap();
    for changed in [
        PushIdentity {
            owner_id: "other".into(),
            ..original.clone()
        },
        PushIdentity {
            base_url: "https://other.test".into(),
            ..original.clone()
        },
        PushIdentity {
            device_id: "other".into(),
            ..original.clone()
        },
    ] {
        assert!(due(&connection, &changed, i64::MAX).unwrap().is_empty());
    }
    let mut other_thread = notice(1);
    other_thread.thread_id = "other".into();
    insert(&connection, &original, &other_thread).unwrap();
    assert_eq!(due(&connection, &original, i64::MAX).unwrap().len(), 2);
}
