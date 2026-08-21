fn bin_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("codex-thread-bin"))
}

fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn rewrite_index(codex_home: &Path, removed: &HashSet<String>) -> Result<(), String> {
    let path = codex_home.join(INDEX_NAME);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取会话索引 {}：{error}", path.display()))?;
    let retained = content
        .lines()
        .filter(|line| {
            serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_string))
                .is_none_or(|id| !removed.contains(&id))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let next_content = if retained.is_empty() {
        String::new()
    } else {
        format!("{retained}\n")
    };
    write_text_atomic(&path, &next_content)
}

fn state_visibility_snapshot(
    state_db: Option<&Path>,
    session_id: &str,
) -> Result<Option<StateVisibilitySnapshot>, String> {
    let Some(state_db) = state_db else {
        return Ok(None);
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .query_row(
            "SELECT rollout_path, archived, archived_at, preview FROM threads WHERE id = ?1",
            params![session_id],
            |row| {
                Ok(StateVisibilitySnapshot {
                    rollout_path: row.get(0)?,
                    archived: row.get(1)?,
                    archived_at: row.get(2)?,
                    preview: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn sqlite_cell(value: rusqlite::types::ValueRef<'_>) -> SqliteCell {
    match value {
        rusqlite::types::ValueRef::Null => SqliteCell::Null,
        rusqlite::types::ValueRef::Integer(value) => SqliteCell::Integer(value),
        rusqlite::types::ValueRef::Real(value) => SqliteCell::Real(value),
        rusqlite::types::ValueRef::Text(value) => {
            SqliteCell::Text(String::from_utf8_lossy(value).to_string())
        }
        rusqlite::types::ValueRef::Blob(value) => SqliteCell::Blob(value.to_vec()),
    }
}

fn sql_value(value: &SqliteCell) -> SqlValue {
    match value {
        SqliteCell::Null => SqlValue::Null,
        SqliteCell::Integer(value) => SqlValue::Integer(*value),
        SqliteCell::Real(value) => SqlValue::Real(*value),
        SqliteCell::Text(value) => SqlValue::Text(value.clone()),
        SqliteCell::Blob(value) => SqlValue::Blob(value.clone()),
    }
}

fn sqlite_row_text<'a>(row: &'a SqliteRowSnapshot, column: &str) -> Option<&'a str> {
    row.columns
        .iter()
        .zip(&row.values)
        .find_map(|(name, value)| {
            (name == column)
                .then_some(value)
                .and_then(|value| match value {
                    SqliteCell::Text(value) => Some(value.as_str()),
                    _ => None,
                })
        })
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn snapshot_thread_row(
    state_db: Option<&Path>,
    session_id: &str,
) -> Result<Option<SqliteRowSnapshot>, String> {
    let Some(state_db) = state_db else {
        return Ok(None);
    };
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    let mut statement = connection
        .prepare("SELECT * FROM threads WHERE id = ?1")
        .map_err(|error| error.to_string())?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    statement
        .query_row(params![session_id], |row| {
            let values = (0..columns.len())
                .map(|index| row.get_ref(index).map(sqlite_cell))
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(SqliteRowSnapshot {
                columns: columns.clone(),
                values,
            })
        })
        .optional()
        .map_err(|error| error.to_string())
}

fn snapshot_table_rows(
    database_path: Option<&Path>,
    database: &str,
    table: &str,
    predicate: &str,
    session_id: &str,
) -> Result<Option<SqliteTableSnapshot>, String> {
    let Some(database_path) = database_path else {
        return Ok(None);
    };
    let connection = Connection::open(database_path)
        .map_err(|error| format!("无法打开 Codex 数据库 {}：{error}", database_path.display()))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    if !table_exists(&connection, table)? {
        return Ok(None);
    }
    let sql = format!(
        "SELECT * FROM {} WHERE {predicate}",
        quote_identifier(table)
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let rows = statement
        .query_map(params![session_id], |row| {
            let values = (0..columns.len())
                .map(|index| row.get_ref(index).map(sqlite_cell))
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(SqliteRowSnapshot {
                columns: columns.clone(),
                values,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok((!rows.is_empty()).then(|| SqliteTableSnapshot {
        database: database.to_string(),
        table: table.to_string(),
        rows,
    }))
}
