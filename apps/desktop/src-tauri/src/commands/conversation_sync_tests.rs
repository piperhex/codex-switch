    #[test]
    fn syncs_openai_conversations_into_the_local_proxy_history() {
        let codex_home = temporary_sync_test_dir();
        let rollout_path = codex_home.join("rollout.jsonl");
        fs::write(
            &rollout_path,
            format!(
                "{}\n{}\n",
                json!({
                    "type": "session_meta",
                    "payload": { "model_provider": "openai" }
                }),
                json!({ "type": "event_msg", "payload": { "type": "task_started" } })
            ),
        )
        .expect("write rollout");

        let state_path = codex_home.join("state_5.sqlite");
        let state = Connection::open(&state_path).expect("open state database");
        state
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    model_provider TEXT NOT NULL
                );",
            )
            .expect("create threads table");
        state
            .execute(
                "INSERT INTO threads (id, rollout_path, model_provider) VALUES (?1, ?2, 'openai')",
                ("thread-1", rollout_path.to_string_lossy().as_ref()),
            )
            .expect("insert thread");
        drop(state);

        let catalog_dir = codex_home.join("sqlite");
        fs::create_dir_all(&catalog_dir).expect("create catalog directory");
        let catalog_path = catalog_dir.join("codex-dev.db");
        let catalog = Connection::open(&catalog_path).expect("open catalog database");
        catalog
            .execute_batch(
                "CREATE TABLE local_thread_catalog (
                    thread_id TEXT PRIMARY KEY,
                    model_provider TEXT NOT NULL
                );
                INSERT INTO local_thread_catalog (thread_id, model_provider)
                VALUES ('thread-1', 'openai');",
            )
            .expect("create catalog");
        drop(catalog);

        let mut progress_updates = Vec::new();
        let result = sync_conversation_metadata_if_present_with_progress(
            &codex_home,
            &mut |processed, total| progress_updates.push((processed, total)),
        )
        .expect("sync conversations");
        assert_eq!(result.conversations_updated, 1);
        assert_eq!(result.rollout_files_updated, 1);
        assert_eq!(progress_updates, vec![(0, 1), (1, 1)]);

        let state = Connection::open(&state_path).expect("reopen state database");
        let state_provider: String = state
            .query_row(
                "SELECT model_provider FROM threads WHERE id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read state provider");
        assert_eq!(state_provider, LOCAL_PROXY_CONVERSATION_PROVIDER);

        let catalog = Connection::open(&catalog_path).expect("reopen catalog database");
        let catalog_provider: String = catalog
            .query_row(
                "SELECT model_provider FROM local_thread_catalog WHERE thread_id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read catalog provider");
        assert_eq!(catalog_provider, LOCAL_PROXY_CONVERSATION_PROVIDER);

        let metadata: Value = serde_json::from_str(
            fs::read_to_string(&rollout_path)
                .expect("read rollout")
                .lines()
                .next()
                .expect("rollout metadata"),
        )
        .expect("parse rollout metadata");
        assert_eq!(
            metadata
                .pointer("/payload/model_provider")
                .and_then(Value::as_str),
            Some(LOCAL_PROXY_CONVERSATION_PROVIDER)
        );

        drop(catalog);
        drop(state);

        let restored = restore_conversation_metadata_if_present(&codex_home)
            .expect("restore non-proxy conversations");
        assert_eq!(restored.conversations_updated, 1);
        assert_eq!(restored.rollout_files_updated, 1);

        let state = Connection::open(&state_path).expect("reopen restored state database");
        let state_provider: String = state
            .query_row(
                "SELECT model_provider FROM threads WHERE id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read restored state provider");
        assert_eq!(state_provider, OFFICIAL_CONVERSATION_PROVIDER);

        let catalog = Connection::open(&catalog_path).expect("reopen restored catalog database");
        let catalog_provider: String = catalog
            .query_row(
                "SELECT model_provider FROM local_thread_catalog WHERE thread_id = 'thread-1'",
                [],
                |row| row.get(0),
            )
            .expect("read restored catalog provider");
        assert_eq!(catalog_provider, OFFICIAL_CONVERSATION_PROVIDER);

        let metadata: Value = serde_json::from_str(
            fs::read_to_string(&rollout_path)
                .expect("read restored rollout")
                .lines()
                .next()
                .expect("restored rollout metadata"),
        )
        .expect("parse restored rollout metadata");
        assert_eq!(
            metadata
                .pointer("/payload/model_provider")
                .and_then(Value::as_str),
            Some(OFFICIAL_CONVERSATION_PROVIDER)
        );

        drop(catalog);
        drop(state);
        fs::remove_dir_all(&codex_home).expect("remove test directory");
    }

    #[test]
    fn rolls_back_conversation_transition_when_a_rollout_cannot_be_updated() {
        let codex_home = temporary_sync_test_dir();
        let rollout_path = codex_home.join("rollout.jsonl");
        fs::write(
            &rollout_path,
            format!(
                "{}\n{}\n",
                json!({
                    "type": "session_meta",
                    "payload": { "model_provider": LOCAL_PROXY_CONVERSATION_PROVIDER }
                }),
                json!({ "type": "event_msg", "payload": { "type": "task_started" } })
            ),
        )
        .expect("write rollout");
        let missing_rollout_path = codex_home.join("missing-rollout.jsonl");

        let state_path = codex_home.join("state_5.sqlite");
        let state = Connection::open(&state_path).expect("open state database");
        state
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    model_provider TEXT NOT NULL
                );",
            )
            .expect("create threads table");
        for (id, path) in [
            ("thread-1", &rollout_path),
            ("thread-2", &missing_rollout_path),
        ] {
            state
                .execute(
                    "INSERT INTO threads (id, rollout_path, model_provider) VALUES (?1, ?2, ?3)",
                    (
                        id,
                        path.to_string_lossy().as_ref(),
                        LOCAL_PROXY_CONVERSATION_PROVIDER,
                    ),
                )
                .expect("insert thread");
        }
        drop(state);

        let catalog_dir = codex_home.join("sqlite");
        fs::create_dir_all(&catalog_dir).expect("create catalog directory");
        let catalog_path = catalog_dir.join("codex-dev.db");
        let catalog = Connection::open(&catalog_path).expect("open catalog database");
        catalog
            .execute_batch(&format!(
                "CREATE TABLE local_thread_catalog (
                    thread_id TEXT PRIMARY KEY,
                    model_provider TEXT NOT NULL
                );
                INSERT INTO local_thread_catalog VALUES ('thread-1', '{LOCAL_PROXY_CONVERSATION_PROVIDER}');
                INSERT INTO local_thread_catalog VALUES ('thread-2', '{LOCAL_PROXY_CONVERSATION_PROVIDER}');"
            ))
            .expect("create catalog");
        drop(catalog);

        let error = restore_conversation_metadata_if_present(&codex_home)
            .expect_err("missing rollout should fail the transition");
        assert!(error.contains("已恢复原状态"));

        let state = Connection::open(&state_path).expect("reopen state database");
        let non_proxy_rows: i64 = state
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider = 'openai'",
                [],
                |row| row.get(0),
            )
            .expect("count restored state rows");
        assert_eq!(non_proxy_rows, 0);

        let catalog = Connection::open(&catalog_path).expect("reopen catalog database");
        let non_proxy_catalog_rows: i64 = catalog
            .query_row(
                "SELECT COUNT(*) FROM local_thread_catalog WHERE model_provider = 'openai'",
                [],
                |row| row.get(0),
            )
            .expect("count restored catalog rows");
        assert_eq!(non_proxy_catalog_rows, 0);

        let metadata: Value = serde_json::from_str(
            fs::read_to_string(&rollout_path)
                .expect("read rolled back rollout")
                .lines()
                .next()
                .expect("rollout metadata"),
        )
        .expect("parse rollout metadata");
        assert_eq!(
            metadata
                .pointer("/payload/model_provider")
                .and_then(Value::as_str),
            Some(LOCAL_PROXY_CONVERSATION_PROVIDER)
        );

        drop(catalog);
        drop(state);
        fs::remove_dir_all(&codex_home).expect("remove test directory");
    }

    fn temporary_sync_test_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "codex-switch-conversation-sync-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }
