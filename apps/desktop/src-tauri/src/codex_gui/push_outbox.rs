//! Content-free events stay on disk until the server acknowledges its durable queue.
use super::push_notifications::Notice;
use crate::cloud::PushIdentity;
use rusqlite::{params, Connection};
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub(super) enum OutboxError {
    #[error("Notification storage is unavailable")]
    Storage,
    #[error("Notification delivery is unavailable")]
    Delivery,
}
pub(super) type Result<T> = std::result::Result<T, OutboxError>;

pub(super) struct Entry {
    pub id: i64,
    pub notice: Notice,
    pub attempts: u32,
}

pub(super) fn open(root: &Path) -> Result<Connection> {
    std::fs::create_dir_all(root).map_err(|_| OutboxError::Storage)?;
    let connection =
        Connection::open(root.join("chat-push-outbox.db")).map_err(|_| OutboxError::Storage)?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| OutboxError::Storage)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS notices (
          id INTEGER PRIMARY KEY, scope TEXT NOT NULL, thread_id TEXT NOT NULL,
          event_id TEXT NOT NULL, kind TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
          next_at INTEGER NOT NULL DEFAULT 0, UNIQUE(scope, thread_id, event_id, kind));
        CREATE INDEX IF NOT EXISTS notices_due ON notices(scope, next_at);",
        )
        .map_err(|_| OutboxError::Storage)?;
    Ok(connection)
}

fn scope(identity: &PushIdentity) -> Result<String> {
    serde_json::to_string(identity).map_err(|_| OutboxError::Storage)
}

pub(super) fn insert(
    connection: &Connection,
    identity: &PushIdentity,
    notice: &Notice,
) -> Result<()> {
    connection
        .execute(
            "INSERT INTO notices(scope,thread_id,event_id,kind) VALUES (?1,?2,?3,?4)
        ON CONFLICT(scope,thread_id,event_id,kind) DO NOTHING",
            params![
                scope(identity)?,
                notice.thread_id,
                notice.event_id,
                notice.kind
            ],
        )
        .map_err(|_| OutboxError::Storage)?;
    Ok(())
}

pub(super) fn due(
    connection: &Connection,
    identity: &PushIdentity,
    now: i64,
) -> Result<Vec<Entry>> {
    let mut query = connection
        .prepare(
            "SELECT id,thread_id,event_id,kind,attempts FROM notices
        WHERE scope=?1 AND next_at<=?2 ORDER BY next_at,id LIMIT 32",
        )
        .map_err(|_| OutboxError::Storage)?;
    let rows = query
        .query_map(params![scope(identity)?, now], |row| {
            Ok(Entry {
                id: row.get(0)?,
                notice: Notice {
                    thread_id: row.get(1)?,
                    event_id: row.get(2)?,
                    kind: row.get(3)?,
                },
                attempts: row.get(4)?,
            })
        })
        .map_err(|_| OutboxError::Storage)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| OutboxError::Storage)
}

pub(super) fn acknowledge(connection: &Connection, id: i64) -> Result<()> {
    connection
        .execute("DELETE FROM notices WHERE id=?1", [id])
        .map_err(|_| OutboxError::Storage)?;
    Ok(())
}

pub(super) fn retry(connection: &Connection, entry: &Entry, now: i64) -> Result<()> {
    // No maximum attempt count or expiry: an extended outage cannot silently discard a critical event.
    let delay = (5_i64 * 2_i64.pow(entry.attempts.min(6))).min(300);
    connection
        .execute(
            "UPDATE notices SET attempts=?1,next_at=?2 WHERE id=?3",
            params![entry.attempts.saturating_add(1), now + delay, entry.id],
        )
        .map_err(|_| OutboxError::Storage)?;
    Ok(())
}

#[cfg(test)]
#[path = "push_outbox_tests.rs"]
mod tests;
