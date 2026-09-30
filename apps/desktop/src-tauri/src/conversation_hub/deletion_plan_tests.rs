use super::*;

use super::super::bin_test_support::{Fixture, OTHER, STATE, THREAD};

fn child(fixture: &Fixture, id: &str, parent: &str) -> PathBuf {
    let path = fixture.rollout(&format!("sessions/rollout-{id}.jsonl"), id);
    let connection = Connection::open(fixture.home.join(STATE)).unwrap();
    connection.execute(
        "INSERT INTO threads SELECT ?1, ?2, archived, archived_at, preview, title, model_provider
         FROM threads WHERE id = ?3", params![id, path.to_string_lossy(), THREAD],
    ).unwrap();
    connection
        .execute(
            "INSERT OR REPLACE INTO thread_spawn_edges VALUES (?1, ?2, 'completed')",
            params![parent, id],
        )
        .unwrap();
    path
}

#[test]
fn deletion_includes_all_descendants_but_not_parents_siblings_or_unrelated_chats() {
    let fixture = Fixture::new();
    child(&fixture, "child-a", THREAD);
    child(&fixture, "child-b", THREAD);
    child(&fixture, "grandchild", "child-a");
    assert_eq!(
        plan(&fixture.home, THREAD.into()).unwrap().thread_ids,
        ["child-a", "child-b", "grandchild", THREAD]
    );
    assert_eq!(
        plan(&fixture.home, "child-a".into()).unwrap().thread_ids,
        ["child-a", "grandchild"]
    );
    assert_eq!(
        plan(&fixture.home, OTHER.into()).unwrap().thread_ids,
        [OTHER]
    );
}

#[test]
fn archived_history_references_and_spawn_metadata_are_included() {
    let fixture = Fixture::new();
    child(&fixture, "child-a", THREAD);
    for (id, payload) in [
        ("history", json!({"history_base": {"thread_id": "child-a"}})),
        (
            "spawn",
            json!({"source": {"subagent": {"thread_spawn": {"parent_thread_id": "history"}}}}),
        ),
        ("fork", json!({"forked_from_id": "spawn"})),
    ] {
        let path = fixture.rollout(&format!("archived_sessions/rollout-{id}.jsonl"), id);
        let mut meta = json!({"id": id, "cwd": "D:/work"});
        meta.as_object_mut()
            .unwrap()
            .extend(payload.as_object().unwrap().clone());
        fs::write(
            path,
            format!("{}\n", json!({"type": "session_meta", "payload": meta})),
        )
        .unwrap();
    }
    assert_eq!(
        plan(&fixture.home, THREAD.into()).unwrap().thread_ids,
        ["child-a", "fork", "history", "spawn", THREAD]
    );
}

#[test]
fn repeated_edges_and_cycles_do_not_loop_or_duplicate_ids() {
    let edges = [
        ("one", "two"),
        ("one", "two"),
        ("two", "one"),
        ("two", "three"),
    ]
    .map(|(parent, child)| (parent.into(), child.into()));
    assert_eq!(
        descendants("one", &edges),
        HashSet::from(["one".into(), "two".into(), "three".into()])
    );
}

#[test]
fn missing_child_history_stops_before_any_deletion() {
    let fixture = Fixture::new();
    let before = fixture.dump(THREAD);
    assert!(matches!(
        plan(&fixture.home, THREAD.into()),
        Err(DeletionError::MissingHistory)
    ));
    assert_eq!(before, fixture.dump(THREAD));
    assert!(fixture.snapshot().path.exists());
    assert!(fixture.entries().is_empty());
}

#[test]
fn deleting_a_child_preserves_parent_and_sibling_history() {
    let fixture = Fixture::new();
    let child_path = child(&fixture, "child-a", THREAD);
    let sibling_path = child(&fixture, "child-b", THREAD);
    let parent_path = fixture.snapshot().path;
    let parent_bytes = fs::read(&parent_path).unwrap();
    let sibling = fixture.dump("child-b");
    let checked = plan(&fixture.home, "child-a".into()).unwrap();
    let snapshots = checked_snapshots(&fixture.home, &checked).unwrap();
    super::super::deletion_batch::discard(&fixture.home, &fixture.bin, snapshots).unwrap();
    assert!(!child_path.exists());
    assert!(sibling_path.exists());
    assert_eq!(fs::read(parent_path).unwrap(), parent_bytes);
    assert_eq!(fixture.dump("child-b"), sibling);
    assert_eq!(
        plan(&fixture.home, THREAD.into()).unwrap().thread_ids,
        ["child-b", THREAD]
    );
    assert_eq!(fixture.entries().len(), 1);
}

#[test]
fn newly_created_child_must_be_checked_before_it_can_be_deleted() {
    let fixture = Fixture::new();
    child(&fixture, "child-a", THREAD);
    let checked = plan(&fixture.home, THREAD.into()).unwrap();
    let new_child = child(&fixture, "new-child", THREAD);
    assert!(matches!(
        checked_snapshots(&fixture.home, &checked),
        Err(DeletionError::Changed)
    ));
    assert!(new_child.exists());
    assert!(fixture.entries().is_empty());
}

#[test]
fn tree_roundtrip_preserves_every_relation_and_unrelated_conversations() {
    let fixture = Fixture::new();
    child(&fixture, "child-a", THREAD);
    child(&fixture, "grandchild", "child-a");
    let checked = plan(&fixture.home, THREAD.into()).unwrap();
    let originals: Vec<_> = checked
        .thread_ids
        .iter()
        .map(|id| fixture.dump(id))
        .collect();
    let unrelated = fixture.dump(OTHER);
    let snapshots = checked_snapshots(&fixture.home, &checked).unwrap();
    super::super::deletion_batch::discard(&fixture.home, &fixture.bin, snapshots).unwrap();
    assert_eq!(fixture.dump(OTHER), unrelated);
    assert_eq!(fixture.entries().len(), 3);
    assert!(plan(&fixture.home, THREAD.into()).is_err());
    for item in fixture.entries() {
        assert!(item.manifest.detached);
        assert!(recover_bin_snapshot(&fixture.home, &item).unwrap());
    }
    for (id, original) in checked.thread_ids.iter().zip(originals) {
        assert_eq!(fixture.dump(id), original);
    }
    assert_eq!(
        plan(&fixture.home, THREAD.into()).unwrap().thread_ids,
        checked.thread_ids
    );
}

#[test]
fn failed_tree_deletion_rolls_back_files_state_and_relationships() {
    let fixture = Fixture::new();
    child(&fixture, "child-a", THREAD);
    let checked = plan(&fixture.home, THREAD.into()).unwrap();
    let originals: Vec<_> = checked
        .thread_ids
        .iter()
        .map(|id| fixture.dump(id))
        .collect();
    let snapshots = checked_snapshots(&fixture.home, &checked).unwrap();
    let files: Vec<_> = snapshots
        .iter()
        .map(|item| (item.path.clone(), fs::read(&item.path).unwrap()))
        .collect();
    fixture.sql(
        STATE,
        "CREATE TRIGGER reject_delete BEFORE DELETE ON threads WHEN OLD.id = 'thread-a'
        BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END",
    );
    let error =
        super::super::deletion_batch::discard(&fixture.home, &fixture.bin, snapshots).unwrap_err();
    assert!(error.contains("simulated storage failure"));
    for (id, original) in checked.thread_ids.iter().zip(originals) {
        assert_eq!(fixture.dump(id), original);
    }
    for (path, bytes) in files {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    assert!(fixture.entries().is_empty());
}
