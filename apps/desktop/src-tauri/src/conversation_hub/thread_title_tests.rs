use super::*;

fn test_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "codex-switch-thread-title-test-{label}-{}",
        Uuid::new_v4()
    ))
}

fn write_rollout(root: &Path, session_id: &str) {
    let session_dir = root.join("sessions/2026/09/04");
    fs::create_dir_all(&session_dir).unwrap();
    fs::write(
        session_dir.join(format!("rollout-{session_id}.jsonl")),
        format!(
            "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session_id}\",\"cwd\":\"D:\\\\work\"}}}}\n"
        ),
    )
    .unwrap();
}

#[test]
fn paginated_sqlite_name_overrides_stale_index_title() {
    let root = test_root("paginated");
    write_rollout(&root, "thread-paginated");
    fs::write(
        root.join(INDEX_NAME),
        "{\"id\":\"thread-paginated\",\"thread_name\":\"stale index title\"}\n",
    )
    .unwrap();
    let connection = Connection::open(root.join("state_5.sqlite")).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                history_mode TEXT NOT NULL,
                name TEXT,
                title TEXT,
                first_user_message TEXT,
                preview TEXT
            );
            INSERT INTO threads VALUES (
                'thread-paginated', 'paginated', '分页会话中文名',
                'first prompt', 'first prompt', 'first prompt'
            );",
        )
        .unwrap();
    drop(connection);

    let snapshots = gather_snapshots(&root).unwrap();
    assert_eq!(snapshots[0].title, "分页会话中文名");
    assert_eq!(
        snapshots[0].explicit_name.as_deref(),
        Some("分页会话中文名")
    );
    rebuild_index_from_snapshots(&root, &snapshots).unwrap();
    let rebuilt = index_values(&root).unwrap();
    assert_eq!(rebuilt["thread-paginated"]["thread_name"], "分页会话中文名");

    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn legacy_sqlite_title_is_used_without_a_session_index() {
    let root = test_root("legacy");
    write_rollout(&root, "thread-legacy");
    let connection = Connection::open(root.join("state_5.sqlite")).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                history_mode TEXT NOT NULL,
                title TEXT,
                first_user_message TEXT,
                preview TEXT
            );
            INSERT INTO threads VALUES (
                'thread-legacy', 'legacy', '旧会话中文名', 'first prompt', 'first prompt'
            );",
        )
        .unwrap();
    drop(connection);

    let snapshots = gather_snapshots(&root).unwrap();
    assert_eq!(snapshots[0].title, "旧会话中文名");
    assert_eq!(snapshots[0].explicit_name.as_deref(), Some("旧会话中文名"));

    fs::remove_dir_all(&root).unwrap();
}
