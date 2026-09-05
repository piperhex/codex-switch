fn snapshot_related_state(
    codex_home: &Path,
    session_id: &str,
    included_ids: &HashSet<String>,
) -> Result<Vec<SqliteTableSnapshot>, String> {
    let state = latest_state_db(codex_home);
    let history = latest_versioned_db(codex_home, "thread_history_");
    let queue = latest_versioned_db(codex_home, "queue_");
    let goals = latest_versioned_db(codex_home, "goals_");
    let memories = latest_versioned_db(codex_home, "memories_");
    let specs = [
        (
            state.as_deref(),
            "state",
            "thread_dynamic_tools",
            "thread_id = ?1",
        ),
        (
            state.as_deref(),
            "state",
            "thread_spawn_edges",
            "parent_thread_id = ?1 OR child_thread_id = ?1",
        ),
        (
            history.as_deref(),
            "thread_history",
            "thread_turns",
            "thread_id = ?1",
        ),
        (
            history.as_deref(),
            "thread_history",
            "thread_items",
            "thread_id = ?1",
        ),
        (
            history.as_deref(),
            "thread_history",
            "thread_history_projection_state",
            "thread_id = ?1",
        ),
        (queue.as_deref(), "queue", "queued_items", "thread_id = ?1"),
        (goals.as_deref(), "goals", "thread_goals", "thread_id = ?1"),
        (
            goals.as_deref(),
            "goals",
            "thread_goal_continuation_deferrals",
            "thread_id = ?1",
        ),
        (
            memories.as_deref(),
            "memories",
            "stage1_outputs",
            "thread_id = ?1",
        ),
    ];
    let mut snapshots = Vec::new();
    for (path, database, table, predicate) in specs {
        if let Some(mut snapshot) =
            snapshot_table_rows(path, database, table, predicate, session_id)?
        {
            if snapshot.table == "thread_spawn_edges" {
                snapshot.rows.retain(|row| {
                    sqlite_row_text(row, "parent_thread_id")
                        .is_some_and(|id| included_ids.contains(id))
                        && sqlite_row_text(row, "child_thread_id")
                            .is_some_and(|id| included_ids.contains(id))
                });
            }
            if snapshot.rows.is_empty() {
                continue;
            }
            snapshots.push(snapshot);
        }
    }
    Ok(snapshots)
}

fn restore_thread_row(
    state_db: Option<&Path>,
    snapshot: Option<&SqliteRowSnapshot>,
    rollout_path: &Path,
    session_id: &str,
) -> Result<(), String> {
    let (Some(state_db), Some(snapshot)) = (state_db, snapshot) else {
        return Ok(());
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let mut info = connection
        .prepare("PRAGMA table_info(threads)")
        .map_err(|error| error.to_string())?;
    let available = info
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(|error| error.to_string())?;
    drop(info);

    let mut columns = Vec::new();
    let mut values = Vec::new();
    let logical_rollout =
        logical_rollout_path(rollout_path).unwrap_or_else(|| rollout_path.to_path_buf());
    for (column, value) in snapshot.columns.iter().zip(&snapshot.values) {
        if !available.contains(column) {
            continue;
        }
        columns.push(column.clone());
        values.push(match column.as_str() {
            "id" => SqlValue::Text(session_id.to_string()),
            "rollout_path" => SqlValue::Text(logical_rollout.to_string_lossy().to_string()),
            _ => sql_value(value),
        });
    }
    if columns.is_empty() {
        return Ok(());
    }
    let placeholders = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT OR REPLACE INTO threads ({}) VALUES ({placeholders})",
        columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ")
    );
    connection
        .execute(&sql, params_from_iter(values))
        .map_err(|error| format!("无法恢复 Codex 会话索引：{error}"))?;
    Ok(())
}

fn related_database_path(codex_home: &Path, database: &str) -> Option<PathBuf> {
    match database {
        "state" => latest_state_db(codex_home),
        "thread_history" => latest_versioned_db(codex_home, "thread_history_"),
        "queue" => latest_versioned_db(codex_home, "queue_"),
        "goals" => latest_versioned_db(codex_home, "goals_"),
        "memories" => latest_versioned_db(codex_home, "memories_"),
        _ => None,
    }
}

fn valid_related_table(database: &str, table: &str) -> bool {
    matches!(
        (database, table),
        ("state", "thread_dynamic_tools")
            | ("state", "thread_spawn_edges")
            | ("thread_history", "thread_turns")
            | ("thread_history", "thread_items")
            | ("thread_history", "thread_history_projection_state")
            | ("queue", "queued_items")
            | ("goals", "thread_goals")
            | ("goals", "thread_goal_continuation_deferrals")
            | ("memories", "stage1_outputs")
    )
}

fn restore_table_snapshot(
    codex_home: &Path,
    snapshot: &SqliteTableSnapshot,
    session_id: &str,
) -> Result<(), String> {
    if !valid_related_table(&snapshot.database, &snapshot.table) {
        return Err("会话包包含不支持的 Codex 状态表".to_string());
    }
    let Some(path) = related_database_path(codex_home, &snapshot.database) else {
        return Ok(());
    };
    restore_table_at_path(&path, snapshot, session_id)
}

fn restore_table_at_path(
    path: &Path,
    snapshot: &SqliteTableSnapshot,
    session_id: &str,
) -> Result<(), String> {
    let mut connection = Connection::open(path)
        .map_err(|error| format!("无法打开 Codex 数据库 {}：{error}", path.display()))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    if !table_exists(&connection, &snapshot.table)? {
        return Ok(());
    }
    let info_sql = format!("PRAGMA table_info({})", quote_identifier(&snapshot.table));
    let mut info = connection
        .prepare(&info_sql)
        .map_err(|error| error.to_string())?;
    let available = info
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(|error| error.to_string())?;
    drop(info);

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for row in &snapshot.rows {
        if snapshot.table == "thread_spawn_edges" {
            let references_session = row.columns.iter().zip(&row.values).any(|(column, value)| {
                matches!(column.as_str(), "parent_thread_id" | "child_thread_id")
                    && matches!(value, SqliteCell::Text(value) if value == session_id)
            });
            if !references_session {
                return Err("会话包包含无关的分叉关系".to_string());
            }
        }
        let mut columns = Vec::new();
        let mut values = Vec::new();
        for (column, value) in row.columns.iter().zip(&row.values) {
            if available.contains(column) {
                columns.push(column.clone());
                values.push(if column == "thread_id" {
                    SqlValue::Text(session_id.to_string())
                } else {
                    sql_value(value)
                });
            }
        }
        if columns.is_empty() {
            continue;
        }
        let placeholders = (1..=columns.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT OR REPLACE INTO {} ({}) VALUES ({placeholders})",
            quote_identifier(&snapshot.table),
            columns
                .iter()
                .map(|column| quote_identifier(column))
                .collect::<Vec<_>>()
                .join(", ")
        );
        transaction
            .execute(&sql, params_from_iter(values))
            .map_err(|error| format!("无法恢复 Codex 状态表 {}：{error}", snapshot.table))?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn restore_related_state(
    codex_home: &Path,
    snapshots: &[SqliteTableSnapshot],
    session_id: &str,
) -> Result<(), String> {
    for snapshot in snapshots {
        restore_table_snapshot(codex_home, snapshot, session_id)?;
    }
    Ok(())
}

fn restore_thread_visibility(
    state_db: Option<&Path>,
    session_id: &str,
    snapshot: Option<&StateVisibilitySnapshot>,
) -> Result<(), String> {
    let (Some(state_db), Some(snapshot)) = (state_db, snapshot) else {
        return Ok(());
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE threads SET archived = ?1, archived_at = ?2, preview = ?3, rollout_path = ?4 WHERE id = ?5",
            params![
                snapshot.archived,
                snapshot.archived_at,
                snapshot.preview,
                snapshot.rollout_path,
                session_id
            ],
        )
        .map_err(|error| format!("无法恢复 Codex 会话状态：{error}"))?;
    Ok(())
}

fn ensure_threads_are_not_referenced(
    snapshots: &[RolloutSnapshot],
    requested: &HashSet<String>,
    state_db: Option<&Path>,
) -> Result<(), String> {
    for item in snapshots {
        if requested.contains(&item.session_id) {
            continue;
        }
        let referenced = [
            item.history_base_thread_id.as_deref(),
            item.parent_thread_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        .find(|id| requested.contains(*id));
        if let Some(parent) = referenced {
            return Err(format!(
                "会话 {parent} 仍被会话 {} 引用，请同时选择相关会话后再移入回收站",
                item.session_id
            ));
        }
    }

    let Some(state_db) = state_db else {
        return Ok(());
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    let mut statement = match connection
        .prepare("SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges")
    {
        Ok(statement) => statement,
        Err(_) => return Ok(()),
    };
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (parent, child) = row.map_err(|error| error.to_string())?;
        if requested.contains(&parent) && !requested.contains(&child) {
            return Err(format!(
                "会话 {parent} 仍有未选择的子会话 {child}，请同时选择后再移入回收站"
            ));
        }
    }
    Ok(())
}
