use std::{fs, path::Path, time::Duration};

use rusqlite::{params, Connection};

use super::models::{
    ErrorLogEntry, ErrorLogPage, ErrorLogSource, ListQuery, LogError, NewEntry, MAX_ENTRIES,
};

const DATABASE_BUSY_TIMEOUT: Duration = Duration::from_secs(2);

/// The worker exclusively owns this connection for the complete lifetime of every operation.
pub(super) fn open(path: &Path) -> Result<Connection, LogError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(path)?;
    connection.busy_timeout(DATABASE_BUSY_TIMEOUT)?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA secure_delete=ON;
         CREATE TABLE IF NOT EXISTS error_logs (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             created_at TEXT NOT NULL,
             source TEXT NOT NULL CHECK(source IN ('proxy', 'toast')),
             message TEXT NOT NULL,
             status_code INTEGER
         );
         CREATE INDEX IF NOT EXISTS error_logs_source_id ON error_logs(source, id);",
    )?;
    Ok(connection)
}

pub(super) fn insert(connection: &mut Connection, entry: NewEntry) -> Result<(), LogError> {
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO error_logs(created_at, source, message, status_code) VALUES (?1, ?2, ?3, ?4)",
        params![
            entry.created_at,
            entry.source.as_str(),
            entry.message,
            entry.status_code
        ],
    )?;
    transaction.execute(
        "DELETE FROM error_logs WHERE id <= (
             SELECT id FROM error_logs ORDER BY id DESC LIMIT 1 OFFSET ?1
         )",
        [MAX_ENTRIES],
    )?;
    transaction.commit()?;
    Ok(())
}

pub(super) fn list(connection: &Connection, query: ListQuery) -> Result<ErrorLogPage, LogError> {
    let mut statement = connection.prepare(
        "SELECT id, created_at, source, message, status_code FROM error_logs
         WHERE (?1 IS NULL OR id < ?1) AND (?2 IS NULL OR source = ?2)
         ORDER BY id DESC LIMIT ?3",
    )?;
    let entries = statement.query_map(
        params![
            query.before_id,
            query.source.map(ErrorLogSource::as_str),
            query.limit + 1
        ],
        |row| {
            Ok(ErrorLogEntry {
                id: row.get(0)?,
                created_at: row.get(1)?,
                source: if row.get::<_, String>(2)? == "proxy" {
                    ErrorLogSource::Proxy
                } else {
                    ErrorLogSource::Toast
                },
                message: row.get(3)?,
                status_code: row.get(4)?,
            })
        },
    )?;
    let mut entries = entries.collect::<Result<Vec<_>, _>>()?;
    let has_more = entries.len() > query.limit as usize;
    entries.truncate(query.limit as usize);
    Ok(ErrorLogPage { entries, has_more })
}

pub(super) fn clear(connection: &Connection) -> Result<(), LogError> {
    connection.execute("DELETE FROM error_logs", [])?;
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}
