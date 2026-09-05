use super::super::*;

pub(super) const THREAD: &str = "thread-a";
pub(super) const OTHER: &str = "thread-b";
pub(super) const STATE: &str = "state_5.sqlite";
pub(super) const HISTORY: &str = "thread_history_3.sqlite";
pub(super) const CATALOGS: [&str; 2] = ["sqlite/catalog-a.db", "sqlite/catalog-b.db"];
pub(super) const CATALOG_TABLES: [&str; 3] = [
    "local_thread_catalog",
    "local_thread_catalog_scan_entries",
    "thread_timeline_ledger",
];
pub(super) const DATA_TABLES: [(&str, &str); 5] = [
    (STATE, "thread_dynamic_tools"),
    (STATE, "thread_artifacts"),
    (HISTORY, "thread_turns"),
    (HISTORY, "thread_items"),
    (HISTORY, "thread_history_projection_state"),
];
pub(super) type Rows = Vec<Vec<SqlValue>>;

pub(super) struct Fixture {
    pub(super) root: PathBuf,
    pub(super) home: PathBuf,
    pub(super) bin: PathBuf,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let root = std::env::temp_dir().join(format!("codex-switch-bin-test-{}", Uuid::new_v4()));
        let fixture = Self {
            home: root.join("codex"),
            bin: root.join("dev.codex.switch/codex-thread-bin"),
            root,
        };
        fs::create_dir_all(fixture.home.join("sqlite")).unwrap();
        fixture.sql(
            STATE,
            "CREATE TABLE threads (
            id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, archived INTEGER NOT NULL,
            archived_at INTEGER, preview TEXT NOT NULL, title TEXT NOT NULL, model_provider TEXT NOT NULL);
            CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT PRIMARY KEY, status TEXT);
            INSERT INTO thread_spawn_edges VALUES ('thread-a', 'child-a', 'completed');",
        );
        for id in [THREAD, OTHER] {
            let path = fixture.rollout(&format!("sessions/rollout-{id}.jsonl"), id);
            Connection::open(fixture.home.join(STATE))
                .unwrap()
                .execute(
                    "INSERT INTO threads VALUES (?1, ?2, 0, NULL, '原始预览', '原始标题', 'custom-provider')",
                    params![id, path.to_string_lossy()],
                )
                .unwrap();
        }
        fixture.seed_related_rows();
        for catalog in CATALOGS {
            fixture.seed_catalog(catalog);
        }
        fs::write(
            fixture.home.join(INDEX_NAME),
            concat!(
                "{\"id\":\"thread-a\",\"thread_name\":\"原始标题\",\"updated_at\":\"2026-09-05T01:00:00Z\"}\n",
                "{\"id\":\"thread-b\",\"thread_name\":\"Unrelated\"}\n"
            ),
        )
        .unwrap();
        fixture
    }

    pub(super) fn sql(&self, database: &str, sql: &str) {
        Connection::open(self.home.join(database))
            .unwrap()
            .execute_batch(sql)
            .unwrap();
    }

    pub(super) fn visibility(&self) -> StateVisibilitySnapshot {
        let (rollout_path, archived, archived_at, preview) = Connection::open(
            self.home.join(STATE),
        )
        .unwrap()
        .query_row(
            "SELECT rollout_path, archived, archived_at, preview FROM threads WHERE id = ?1",
            [THREAD],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
        StateVisibilitySnapshot {
            rollout_path,
            archived,
            archived_at,
            preview,
        }
    }

    fn seed_related_rows(&self) {
        // Extra SQLite value types detect lossy backups independently of the production table lists.
        for (database, table) in DATA_TABLES {
            self.sql(
                database,
                &format!(
                    "CREATE TABLE {table} (
                thread_id TEXT, ordinal INTEGER, payload BLOB, score REAL, note TEXT,
                PRIMARY KEY (thread_id, ordinal));
                INSERT INTO {table} VALUES ('thread-a', 1, X'00FF42', 1.25, '历史内容'),
                    ('thread-a', 2, X'', 2.5, NULL), ('thread-b', 1, X'11', 3.75, 'untouched');"
                ),
            );
        }
    }

    fn seed_catalog(&self, database: &str) {
        self.sql(
            database,
            "CREATE TABLE local_thread_catalog_hosts (host_id TEXT PRIMARY KEY, host_kind TEXT);
            INSERT INTO local_thread_catalog_hosts VALUES ('local-host', 'local'), ('remote-host', 'remote');
            CREATE TABLE local_thread_catalog_metadata (singleton INTEGER PRIMARY KEY, catalog_revision INTEGER);
            INSERT INTO local_thread_catalog_metadata VALUES (1, 10);",
        );
        for table in CATALOG_TABLES {
            self.sql(
                database,
                &format!(
                    "CREATE TABLE {table} (
                host_id TEXT, thread_id TEXT, model_provider TEXT, title TEXT, PRIMARY KEY (host_id, thread_id));
                INSERT INTO {table} VALUES ('local-host', 'thread-a', 'custom-provider', '本地会话'),
                    ('remote-host', 'thread-a', 'remote-provider', 'Remote copy'),
                    ('local-host', 'thread-b', 'openai', 'Unrelated');"
                ),
            );
        }
    }

    pub(super) fn rollout(&self, relative: &str, id: &str) -> PathBuf {
        let path = self.home.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let text = format!(
            "{}\n{}\n",
            json!({"type":"session_meta","payload":{"id":id,"cwd":"D:/work"}}),
            json!({"type":"event_msg","payload":{"type":"user_message","message":"保留完整历史"}})
        );
        let bytes = if path.extension().is_some_and(|ext| ext == "zst") {
            zstd::stream::encode_all(text.as_bytes(), 1).unwrap()
        } else {
            text.into_bytes()
        };
        fs::write(&path, bytes).unwrap();
        path
    }

    pub(super) fn rows(&self, database: &str, table: &str, predicate: &str) -> Rows {
        let connection = Connection::open(self.home.join(database)).unwrap();
        let mut statement = connection
            .prepare(&format!(
                "SELECT * FROM {table} WHERE {predicate} ORDER BY 1, 2"
            ))
            .unwrap();
        let count = statement.column_count();
        let rows = statement
            .query_map([], |row| {
                (0..count)
                    .map(|column| row.get(column))
                    .collect::<rusqlite::Result<Vec<SqlValue>>>()
            })
            .unwrap();
        rows.collect::<rusqlite::Result<_>>().unwrap()
    }

    pub(super) fn dump(&self, id: &str) -> Vec<Rows> {
        let mut rows = vec![
            self.rows(STATE, "threads", &format!("id = '{id}'")),
            self.rows(
                STATE,
                "thread_spawn_edges",
                &format!("parent_thread_id = '{id}' OR child_thread_id = '{id}'"),
            ),
        ];
        for (database, table) in DATA_TABLES {
            rows.push(self.rows(database, table, &format!("thread_id = '{id}'")));
        }
        for database in CATALOGS {
            for table in CATALOG_TABLES {
                rows.push(self.rows(database, table, &format!("thread_id = '{id}'")));
            }
        }
        rows
    }

    pub(super) fn assert_removed(&self) {
        let rows = self.dump(THREAD);
        for rows in &rows[..2 + DATA_TABLES.len()] {
            assert!(rows.is_empty(), "local state survived: {rows:?}");
        }
        for rows in &rows[2 + DATA_TABLES.len()..] {
            assert_eq!(rows.len(), 1, "only the remote catalog row should remain");
            assert_eq!(rows[0][0], SqlValue::Text("remote-host".into()));
        }
    }

    pub(super) fn snapshot(&self) -> RolloutSnapshot {
        let snapshots = gather_snapshots(&self.home)
            .unwrap()
            .into_iter()
            .filter(|item| item.session_id == THREAD)
            .collect();
        let mut merged = merge_bin_snapshots(snapshots);
        assert_eq!(merged.len(), 1);
        merged.pop().unwrap()
    }

    pub(super) fn entries(&self) -> Vec<BinSnapshot> {
        collect_bin_entries_at(&self.bin).unwrap()
    }

    pub(super) fn discard(&self) -> BinSnapshot {
        discard_thread_snapshot(&self.home, &self.bin.join("batch"), self.snapshot()).unwrap();
        let mut entries = self.entries();
        assert_eq!(entries.len(), 1);
        entries.pop().unwrap()
    }

    pub(super) fn block_index(&self) -> Vec<u8> {
        let path = self.home.join(INDEX_NAME);
        let bytes = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        bytes
    }

    pub(super) fn unblock_index(&self, bytes: &[u8]) {
        let path = self.home.join(INDEX_NAME);
        fs::remove_dir(&path).unwrap();
        fs::write(path, bytes).unwrap();
    }

    pub(super) fn legacy(&self, visibility: bool) -> BinSnapshot {
        let snapshot = self.snapshot();
        let original = self.visibility();
        let folder = self.bin.join("legacy-batch/entry");
        let target = folder.join("files").join(&snapshot.relative_path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::rename(&snapshot.path, &target).unwrap();
        Connection::open(self.home.join(STATE))
            .unwrap()
            .execute(
                "UPDATE threads SET archived = 1, archived_at = 123, preview = '', rollout_path = ?1 WHERE id = ?2",
                params![target.to_string_lossy(), THREAD],
            )
            .unwrap();
        let mut manifest = json!({"sessionId":THREAD, "title":snapshot.title, "cwd":snapshot.cwd,
            "originalRolloutPath":snapshot.path, "relativeRolloutPath":snapshot.relative_path,
            "sessionIndexEntry":snapshot.index_value, "deletedAt":"2026-09-05T01:00:00Z", "detached":false});
        if visibility {
            manifest["stateVisibility"] = serde_json::to_value(original).unwrap();
        }
        fs::write(
            folder.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        rewrite_index(&self.home, &HashSet::from([THREAD.to_string()])).unwrap();
        self.entries().pop().unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.root) {
            eprintln!(
                "Could not clean isolated bin test fixture {}: {error}",
                self.root.display()
            );
        }
    }
}
