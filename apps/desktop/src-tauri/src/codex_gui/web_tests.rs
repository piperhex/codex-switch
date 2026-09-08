use super::*;
use serde_json::json;

fn append(log: &mut EventLog, text: &str, bytes: usize) {
    log.push(
        WebEvent {
            name: "codex-gui-event".into(),
            payload: json!({ "delta": text }),
        },
        bytes,
    );
}

#[test]
fn independent_browsers_replay_the_same_ordered_events_without_draining() {
    let mut log = EventLog::default();
    append(&mut log, "old", 3);
    let initial = log.read(None);
    assert!(initial.events.is_empty());
    append(&mut log, "first", 5);
    append(&mut log, "second", 6);
    for _ in 0..2 {
        let batch = log.read(Some(initial.cursor.clone()));
        assert!(!batch.reset);
        assert_eq!(batch.events.len(), 2);
        assert_eq!(batch.events[0].payload["delta"], "first");
        assert_eq!(batch.events[1].payload["delta"], "second");
        assert!(log.read(Some(batch.cursor)).events.is_empty());
    }
}

#[test]
fn lagging_or_restarted_browsers_get_an_explicit_reset() {
    let mut log = EventLog::default();
    let start = log.cursor.clone();
    for _ in 0..=MAX_EVENTS {
        append(&mut log, "delta", 5);
    }
    assert_eq!(log.entries.len(), MAX_EVENTS);
    let batch = log.read(Some(start));
    assert!(batch.reset);
    assert!(batch.events.is_empty());
    assert!(EventLog::default().read(Some(batch.cursor)).reset);
}

#[test]
fn replay_is_bounded_by_bytes_including_oversized_events() {
    let mut log = EventLog::default();
    let start = log.cursor.clone();
    append(&mut log, "large", MAX_EVENT_BYTES);
    append(&mut log, "small", 1);
    assert_eq!(log.bytes, 1);
    assert!(log.read(Some(start)).reset);
    let cursor = log.cursor.clone();
    append(&mut log, "oversized", MAX_EVENT_BYTES + 1);
    assert_eq!(log.bytes, 0);
    assert!(log.entries.is_empty());
    assert!(log.read(Some(cursor)).reset);
}
