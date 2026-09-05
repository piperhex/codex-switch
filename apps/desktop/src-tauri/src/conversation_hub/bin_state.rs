// Keep the deletion and backup lists together: every removed row must be recoverable.
const BIN_STATE_TABLES: &[&str] = &[
    "thread_dynamic_tools",
    "thread_artifacts",
    "thread_spawn_edges",
    "thread_goal_continuation_deferrals",
    "thread_goals",
    "stage1_outputs",
    "logs",
];
const BIN_DATABASE_TABLES: &[(&str, &[&str])] = &[
    (
        "thread_history",
        &[
            "thread_items",
            "thread_turns",
            "thread_history_projection_state",
        ],
    ),
    ("queue", &["queued_items"]),
    (
        "goals",
        &["thread_goal_continuation_deferrals", "thread_goals"],
    ),
    ("memories", &["stage1_outputs"]),
    ("logs", &["logs"]),
];
const BIN_CATALOG_TABLES: &[&str] = &[
    "local_thread_catalog",
    "local_thread_catalog_scan_entries",
    "thread_timeline_ledger",
];
const CATALOG_PREFIX: &str = "catalog:";
static BIN_OPERATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinStateBackup {
    thread: Option<SqliteRowSnapshot>,
    tables: Vec<SqliteTableSnapshot>,
}

fn bin_operation_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    BIN_OPERATION_LOCK
        .lock()
        .map_err(|_| "会话回收站暂时不可用，请重启后重试".to_string())
}

fn bin_catalog_paths(codex_home: &Path) -> Result<Vec<PathBuf>, String> {
    let directory = codex_home.join("sqlite");
    if !directory.exists() {
        return Ok(Vec::new());
    }
    fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| match entry {
            Ok(entry) if entry.path().extension().is_some_and(|ext| ext == "db") => {
                Some(Ok(entry.path()))
            }
            Ok(_) => None,
            Err(error) => Some(Err(error.to_string())),
        })
        .collect()
}

fn bin_row_predicate(connection: &Connection, table: &str) -> Result<String, String> {
    if table == "thread_spawn_edges" {
        return Ok("parent_thread_id = ?1 OR child_thread_id = ?1".to_string());
    }
    let mut predicate = "thread_id = ?1".to_string();
    if BIN_CATALOG_TABLES.contains(&table)
        && table_has_column(connection, table, "host_id")?
        && table_exists(connection, "local_thread_catalog_hosts")?
    {
        predicate.push_str(concat!(
            " AND host_id IN (SELECT host_id FROM local_thread_catalog_hosts",
            " WHERE host_kind = 'local')"
        ));
    }
    Ok(predicate)
}

fn snapshot_bin_tables(
    path: &Path,
    database: &str,
    tables: &[&str],
    session_id: &str,
) -> Result<Vec<SqliteTableSnapshot>, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    let mut result = Vec::new();
    for table in tables {
        let predicate = bin_row_predicate(&connection, table)?;
        if let Some(snapshot) =
            snapshot_table_rows(Some(path), database, table, &predicate, session_id)?
        {
            result.push(snapshot);
        }
    }
    Ok(result)
}

fn snapshot_bin_state(codex_home: &Path, session_id: &str) -> Result<BinStateBackup, String> {
    let state = latest_state_db(codex_home);
    let mut backup = BinStateBackup {
        thread: snapshot_thread_row(state.as_deref(), session_id)?,
        tables: Vec::new(),
    };
    if let Some(path) = state {
        backup.tables.extend(snapshot_bin_tables(
            &path,
            "state",
            BIN_STATE_TABLES,
            session_id,
        )?);
    }
    for (database, tables) in BIN_DATABASE_TABLES {
        if let Some(path) = latest_versioned_db(codex_home, &format!("{database}_")) {
            backup
                .tables
                .extend(snapshot_bin_tables(&path, database, tables, session_id)?);
        }
    }
    for path in bin_catalog_paths(codex_home)? {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "无法识别会话目录".to_string())?;
        backup.tables.extend(snapshot_bin_tables(
            &path,
            &format!("{CATALOG_PREFIX}{name}"),
            BIN_CATALOG_TABLES,
            session_id,
        )?);
    }
    Ok(backup)
}

fn bin_snapshot_path(
    codex_home: &Path,
    snapshot: &SqliteTableSnapshot,
) -> Result<Option<PathBuf>, String> {
    if let Some(name) = snapshot.database.strip_prefix(CATALOG_PREFIX) {
        let relative = safe_relative_path(name).filter(|path| {
            path.components().count() == 1 && path.extension().is_some_and(|ext| ext == "db")
        });
        if !BIN_CATALOG_TABLES.contains(&snapshot.table.as_str()) || relative.is_none() {
            return Err("回收站中的会话目录备份无效".to_string());
        }
        return Ok(relative
            .map(|path| codex_home.join("sqlite").join(path))
            .filter(|path| path.is_file()));
    }
    let allowed = if snapshot.database == "state" {
        BIN_STATE_TABLES
    } else {
        BIN_DATABASE_TABLES
            .iter()
            .find(|(name, _)| *name == snapshot.database)
            .map(|(_, tables)| *tables)
            .unwrap_or_default()
    };
    if !allowed.contains(&snapshot.table.as_str()) {
        return Err("回收站中的会话状态备份无效".to_string());
    }
    Ok(latest_versioned_db(
        codex_home,
        &format!("{}_", snapshot.database),
    ))
}

fn bump_catalog_revision(connection: &Connection) -> Result<(), String> {
    if table_has_column(
        connection,
        "local_thread_catalog_metadata",
        "catalog_revision",
    )? {
        connection
            .execute(
                "UPDATE local_thread_catalog_metadata SET catalog_revision = catalog_revision + 1",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn restore_bin_state(codex_home: &Path, manifest: &BinManifest) -> Result<(), String> {
    let Some(backup) = &manifest.state_backup else {
        return restore_thread_visibility(
            latest_state_db(codex_home).as_deref(),
            &manifest.session_id,
            manifest.state_visibility.as_ref(),
        );
    };
    let state_db = latest_state_db(codex_home);
    if backup.thread.is_some() && state_db.is_none() {
        return Err("找不到原来的 Codex 会话数据，请启动 Codex 后再恢复".to_string());
    }
    let relative = safe_relative_path(&manifest.relative_rollout_path)
        .ok_or_else(|| "回收站中的会话路径无效".to_string())?;
    restore_thread_row(
        state_db.as_deref(),
        backup.thread.as_ref(),
        &codex_home.join(relative),
        &manifest.session_id,
    )?;
    for snapshot in &backup.tables {
        let path = bin_snapshot_path(codex_home, snapshot)?
            .ok_or_else(|| "找不到原来的 Codex 会话数据，备份仍保留在回收站中".to_string())?;
        let connection = Connection::open(&path).map_err(|error| error.to_string())?;
        if !table_exists(&connection, &snapshot.table)? {
            return Err("Codex 会话数据格式已变化，备份仍保留在回收站中".to_string());
        }
        restore_table_at_path(&path, snapshot, &manifest.session_id)?;
        if snapshot.database.starts_with(CATALOG_PREFIX) {
            bump_catalog_revision(&connection)?;
        }
    }
    Ok(())
}

fn delete_bin_table_rows(path: &Path, tables: &[&str], session_id: &str) -> Result<(), String> {
    let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for table in tables {
        if !table_exists(&transaction, table)? {
            continue;
        }
        let predicate = if *table == "threads" {
            "id = ?1".to_string()
        } else {
            bin_row_predicate(&transaction, table)?
        };
        transaction
            .execute(
                &format!("DELETE FROM {} WHERE {predicate}", quote_identifier(table)),
                params![session_id],
            )
            .map_err(|error| error.to_string())?;
    }
    if tables.contains(&"local_thread_catalog") {
        bump_catalog_revision(&transaction)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn remove_bin_state(codex_home: &Path, session_id: &str) -> Result<(), String> {
    // Remove the authoritative row first so catalog reconciliation cannot rediscover it.
    if let Some(path) = latest_state_db(codex_home) {
        let tables = BIN_STATE_TABLES
            .iter()
            .copied()
            .chain(["threads"])
            .collect::<Vec<_>>();
        delete_bin_table_rows(&path, &tables, session_id)?;
    }
    for (database, tables) in BIN_DATABASE_TABLES {
        if let Some(path) = latest_versioned_db(codex_home, &format!("{database}_")) {
            delete_bin_table_rows(&path, tables, session_id)?;
        }
    }
    for path in bin_catalog_paths(codex_home)? {
        delete_bin_table_rows(&path, BIN_CATALOG_TABLES, session_id)?;
    }
    Ok(())
}
