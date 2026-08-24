#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "codex-switch-thread-test-{label}-{}",
            Uuid::new_v4()
        ))
    }

    #[test]
    fn scans_rollouts_with_index_titles() {
        let root = test_root("scan");
        let session_dir = root.join("sessions/2026/08/08");
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            session_dir.join("rollout-thread-a.jsonl"),
            concat!(
                r#"{"timestamp":"2026-08-08T10:00:00Z","type":"session_meta","payload":{"#,
                r#""id":"thread-a","cwd":"F:\\projects\\alpha","model_provider":"openai"}}"#,
                "\n",
                r#"{"type":"event_msg","payload":{"type":"token_count","info":{"#,
                r#""total_token_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}}"#,
                "\n",
                r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"#,
                r#""type":"input_text","text":"Please inspect the Alpha search result carefully."}]}}"#,
                "\n",
            ),
        )
        .unwrap();
        fs::write(
            root.join(INDEX_NAME),
            r#"{"id":"thread-a","thread_name":"Alpha session","updated_at":"2026-08-08T10:30:00Z"}
"#,
        )
        .unwrap();

        let snapshots = gather_snapshots(&root).unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].session_id, "thread-a");
        assert_eq!(snapshots[0].title, "Alpha session");
        assert_eq!(snapshots[0].cwd, r#"F:\projects\alpha"#);
        assert_eq!(token_totals(&snapshots[0].path), Some((10, 5, 15)));
        assert_eq!(
            locate_rollout_text(&snapshots[0].path, "alpha")
                .unwrap()
                .as_deref(),
            Some("Please inspect the Alpha search result carefully.")
        );
        assert!(locate_rollout_text(&snapshots[0].path, "missing")
            .unwrap()
            .is_none());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn package_paths_cannot_escape_codex_home() {
        assert!(safe_relative_path("sessions/2026/rollout-a.jsonl").is_some());
        assert!(safe_relative_path("").is_none());
        assert!(safe_relative_path("../auth.json").is_none());
        assert!(safe_relative_path("/outside/rollout.jsonl").is_none());
        assert!(safe_relative_path("C:/outside/rollout.jsonl").is_none());
        assert!(safe_relative_path(r"C:\outside\rollout.jsonl").is_none());
        assert!(safe_relative_path("C:outside/rollout.jsonl").is_none());
        assert!(safe_relative_path(r"\\server\share\rollout.jsonl").is_none());
    }

    #[test]
    fn scans_searches_and_rewrites_compressed_rollouts() {
        let root = test_root("compressed");
        let session_dir = root.join("sessions/2026/08/09");
        fs::create_dir_all(&session_dir).unwrap();
        let rollout = session_dir.join("rollout-thread-z.jsonl.zst");
        let source = concat!(
            r#"{"timestamp":"2026-08-09T10:00:00Z","type":"session_meta","payload":{"#,
            r#""id":"thread-z","cwd":"F:\\projects\\zeta","model_provider":"openai"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"#,
            r#""total_token_usage":{"input_tokens":20,"output_tokens":7,"total_tokens":27}}}}"#,
            "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"#,
            r#""type":"input_text","text":"Compressed Zeta history"}]}}"#,
            "\n",
        );
        let output = File::create(&rollout).unwrap();
        let mut encoder = zstd::stream::write::Encoder::new(output, 3).unwrap();
        encoder.write_all(source.as_bytes()).unwrap();
        encoder.finish().unwrap();

        let snapshots = gather_snapshots(&root).unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].path, rollout);
        assert_eq!(token_totals(&snapshots[0].path), Some((20, 7, 27)));
        assert_eq!(
            locate_rollout_text(&snapshots[0].path, "zeta")
                .unwrap()
                .as_deref(),
            Some("Compressed Zeta history")
        );

        assert!(rewrite_rollout_provider(&snapshots[0].path, "custom").unwrap());
        let meta = first_rollout_value(&snapshots[0].path).unwrap().unwrap();
        assert_eq!(meta["payload"]["model_provider"], "custom");
        assert!(locate_rollout_text(&snapshots[0].path, "compressed")
            .unwrap()
            .is_some());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn recycle_visibility_roundtrips_the_codex_state_row() {
        let root = test_root("state-visibility");
        fs::create_dir_all(&root).unwrap();
        let state_db = root.join("state_5.sqlite");
        let connection = Connection::open(&state_db).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    archived INTEGER NOT NULL,
                    archived_at INTEGER,
                    preview TEXT NOT NULL
                );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO threads (id, rollout_path, archived, archived_at, preview) VALUES (?1, ?2, 0, NULL, ?3)",
                params!["thread-a", "sessions/rollout-thread-a.jsonl", "Visible thread"],
            )
            .unwrap();
        drop(connection);

        let visibility = state_visibility_snapshot(Some(&state_db), "thread-a")
            .unwrap()
            .unwrap();
        hide_thread_in_state(
            Some(&state_db),
            "thread-a",
            &root.join("bin/rollout-thread-a.jsonl"),
        )
        .unwrap();
        let hidden = state_visibility_snapshot(Some(&state_db), "thread-a")
            .unwrap()
            .unwrap();
        assert_eq!(hidden.archived, 1);
        assert!(hidden.preview.is_empty());

        restore_thread_visibility(Some(&state_db), "thread-a", Some(&visibility)).unwrap();
        let restored = state_visibility_snapshot(Some(&state_db), "thread-a")
            .unwrap()
            .unwrap();
        assert_eq!(restored.archived, 0);
        assert_eq!(restored.preview, "Visible thread");
        assert_eq!(restored.rollout_path, "sessions/rollout-thread-a.jsonl");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn purging_a_thread_removes_its_codex_catalog_entry() {
        let root = test_root("catalog-purge");
        let catalog_dir = root.join("sqlite");
        fs::create_dir_all(&catalog_dir).unwrap();
        let catalog_path = catalog_dir.join("codex.db");
        let connection = Connection::open(&catalog_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE local_thread_catalog (
                    thread_id TEXT PRIMARY KEY,
                    model_provider TEXT NOT NULL
                );
                INSERT INTO local_thread_catalog (thread_id, model_provider)
                VALUES ('thread-a', 'openai'), ('thread-b', 'openai');",
            )
            .unwrap();
        drop(connection);

        purge_thread_catalogs(&root, "thread-a").unwrap();

        let connection = Connection::open(&catalog_path).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM local_thread_catalog WHERE thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM local_thread_catalog WHERE thread_id = 'thread-b'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        drop(connection);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn related_sqlite_state_roundtrips_for_import() {
        let source = test_root("related-state-source");
        let target = test_root("related-state-target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();

        for root in [&source, &target] {
            Connection::open(root.join("state_2.sqlite"))
                .unwrap()
                .execute_batch(
                    "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL);
                     CREATE TABLE thread_dynamic_tools (
                         thread_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL,
                         PRIMARY KEY (thread_id, position)
                     );
                     CREATE TABLE thread_spawn_edges (
                         parent_thread_id TEXT NOT NULL, child_thread_id TEXT PRIMARY KEY, status TEXT NOT NULL
                     );",
                )
                .unwrap();
            Connection::open(root.join("thread_history_3.sqlite"))
                .unwrap()
                .execute_batch(
                    "CREATE TABLE thread_turns (
                         thread_id TEXT NOT NULL, turn_id TEXT NOT NULL,
                         PRIMARY KEY (thread_id, turn_id)
                     );
                     CREATE TABLE thread_items (
                         thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, item_id TEXT NOT NULL,
                         PRIMARY KEY (thread_id, turn_id, item_id)
                     );
                     CREATE TABLE thread_history_projection_state (
                         thread_id TEXT PRIMARY KEY, next_rollout_ordinal INTEGER NOT NULL
                     );",
                )
                .unwrap();
            Connection::open(root.join("queue_1.sqlite"))
                .unwrap()
                .execute_batch(
                    "CREATE TABLE queued_items (
                         id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, payload_json TEXT NOT NULL
                     );",
                )
                .unwrap();
        }

        Connection::open(source.join("state_2.sqlite"))
            .unwrap()
            .execute_batch(
                "INSERT INTO threads VALUES ('thread-a', 'sessions/source.jsonl');
                 INSERT INTO thread_dynamic_tools VALUES ('thread-a', 0, 'tool-a');
                 INSERT INTO thread_spawn_edges VALUES ('thread-a', 'thread-b', 'completed');",
            )
            .unwrap();
        Connection::open(source.join("thread_history_3.sqlite"))
            .unwrap()
            .execute_batch(
                "INSERT INTO thread_turns VALUES ('thread-a', 'turn-a');
                 INSERT INTO thread_items VALUES ('thread-a', 'turn-a', 'item-a');
                 INSERT INTO thread_history_projection_state VALUES ('thread-a', 7);",
            )
            .unwrap();
        Connection::open(source.join("queue_1.sqlite"))
            .unwrap()
            .execute(
                "INSERT INTO queued_items VALUES ('queue-a', 'thread-a', '{}')",
                [],
            )
            .unwrap();

        let thread_row =
            snapshot_thread_row(latest_state_db(&source).as_deref(), "thread-a").unwrap();
        restore_thread_row(
            latest_state_db(&target).as_deref(),
            thread_row.as_ref(),
            &target.join("sessions/rollout-thread-a.jsonl.zst"),
            "thread-a",
        )
        .unwrap();
        let included = HashSet::from(["thread-a".to_string(), "thread-b".to_string()]);
        let related = snapshot_related_state(&source, "thread-a", &included).unwrap();
        restore_related_state(&target, &related, "thread-a").unwrap();

        let state = Connection::open(target.join("state_2.sqlite")).unwrap();
        let restored_path: String = state
            .query_row(
                "SELECT rollout_path FROM threads WHERE id = 'thread-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(restored_path.ends_with("rollout-thread-a.jsonl"));
        assert_eq!(
            state
                .query_row(
                    "SELECT COUNT(*) FROM thread_dynamic_tools WHERE thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            state
                .query_row(
                    "SELECT COUNT(*) FROM thread_spawn_edges WHERE parent_thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            Connection::open(target.join("thread_history_3.sqlite"))
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM thread_items WHERE thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            Connection::open(target.join("queue_1.sqlite"))
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM queued_items WHERE thread_id = 'thread-a'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        drop(state);
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn migration_rewrites_thread_ids_and_clears_old_parent_links() {
        let mut value = serde_json::json!({
            "type": "session_meta",
            "payload": {
                "id": "thread-old",
                "session_id": "thread-old",
                "parent_thread_id": "thread-old",
                "message": "thread-old should remain in user content"
            }
        });

        rewrite_thread_identifiers(&mut value, "thread-old", "thread-new");

        assert_eq!(value["payload"]["id"], "thread-new");
        assert_eq!(value["payload"]["session_id"], "thread-new");
        assert!(value["payload"]["parent_thread_id"].is_null());
        assert_eq!(value["payload"]["message"], "thread-old should remain in user content");
    }

    #[test]
    fn initial_ownership_scan_keeps_legacy_threads_unknown() {
        let mut state = crate::models::ManagerStateFile::default();
        let snapshots = vec![snapshot_for_ownership_test("legacy-thread")];

        assert!(observe_threads(&snapshots, &mut state, Some("current-account")));

        assert!(state.conversation_ownership_initialized);
        assert!(state.observed_conversation_ids.contains("legacy-thread"));
        assert!(!state.conversation_account_ids.contains_key("legacy-thread"));
    }

    #[test]
    fn later_ownership_scan_assigns_new_threads_to_the_current_account() {
        let mut state = crate::models::ManagerStateFile {
            conversation_ownership_initialized: true,
            ..crate::models::ManagerStateFile::default()
        };
        let snapshots = vec![snapshot_for_ownership_test("new-thread")];

        assert!(observe_threads(&snapshots, &mut state, Some("current-account")));

        assert_eq!(
            state.conversation_account_ids.get("new-thread").map(String::as_str),
            Some("current-account")
        );
    }

    fn snapshot_for_ownership_test(session_id: &str) -> RolloutSnapshot {
        RolloutSnapshot {
            session_id: session_id.to_string(),
            title: session_id.to_string(),
            cwd: "C:\\workspace".to_string(),
            updated_at: None,
            path: PathBuf::new(),
            physical_paths: Vec::new(),
            relative_path: PathBuf::new(),
            index_value: serde_json::json!({ "id": session_id }),
            size_bytes: 0,
            history_base_thread_id: None,
            parent_thread_id: None,
        }
    }
}
