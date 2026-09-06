use std::{
    collections::BTreeMap,
    fs,
    ops::Deref,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use rusqlite::{params, Connection};

use super::models::{AccountQuotaHistory, AccountQuotaPoint, HistoryError, HistoryRange};
use crate::storage::Paths;

const DATABASE_FILENAME: &str = "account-quota-history.sqlite3";
const DATABASE_WAIT: Duration = Duration::from_secs(3);
static DATABASE_LOCK: Mutex<()> = Mutex::new(());

/// Keep serialization alive for the entire operation, including queries and writes.
pub(super) struct HistoryConnection {
    connection: Connection,
    _guard: MutexGuard<'static, ()>,
}

impl Deref for HistoryConnection {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}

pub(super) fn open(paths: &Paths) -> Result<HistoryConnection, HistoryError> {
    let guard = acquire_lock()?;
    let directory = paths
        .accounts
        .parent()
        .ok_or(HistoryError::StorageUnavailable)?;
    fs::create_dir_all(directory)?;
    let connection = Connection::open(directory.join(DATABASE_FILENAME))?;
    connection.busy_timeout(DATABASE_WAIT)?;
    initialize(&connection)?;
    Ok(HistoryConnection {
        connection,
        _guard: guard,
    })
}

pub(super) fn acquire_lock() -> Result<MutexGuard<'static, ()>, HistoryError> {
    DATABASE_LOCK
        .lock()
        .map_err(|_| HistoryError::LockUnavailable)
}

pub(super) fn initialize(connection: &Connection) -> Result<(), HistoryError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS account_quota_history (
            account_id TEXT NOT NULL,
            ts INTEGER NOT NULL,
            primary_remaining_percent REAL,
            secondary_remaining_percent REAL,
            primary_reset_at INTEGER,
            secondary_reset_at INTEGER,
            PRIMARY KEY (account_id, ts)
        );
        CREATE INDEX IF NOT EXISTS account_quota_history_ts ON account_quota_history(ts);",
    )?;
    Ok(())
}

pub(super) fn insert(
    connection: &Connection,
    account_id: &str,
    point: &AccountQuotaPoint,
) -> Result<(), HistoryError> {
    connection.execute(
        "INSERT INTO account_quota_history (
            account_id, ts, primary_remaining_percent, secondary_remaining_percent,
            primary_reset_at, secondary_reset_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(account_id, ts) DO UPDATE SET
            primary_remaining_percent = excluded.primary_remaining_percent,
            secondary_remaining_percent = excluded.secondary_remaining_percent,
            primary_reset_at = excluded.primary_reset_at,
            secondary_reset_at = excluded.secondary_reset_at",
        params![
            account_id,
            point.ts,
            point.primary_remaining_percent,
            point.secondary_remaining_percent,
            point.primary_reset_at,
            point.secondary_reset_at,
        ],
    )?;
    Ok(())
}

pub(super) fn append_points(
    connection: &Connection,
    accounts: &mut BTreeMap<String, AccountQuotaHistory>,
    range: HistoryRange,
) -> Result<(), HistoryError> {
    let mut statement = connection.prepare(
        "SELECT ts, primary_remaining_percent, secondary_remaining_percent,
                primary_reset_at, secondary_reset_at
         FROM account_quota_history
         WHERE account_id = ?1 AND ts >= COALESCE(
             (SELECT MAX(ts) FROM account_quota_history WHERE account_id = ?1 AND ts < ?2), ?2
         ) AND ts <= ?3 ORDER BY ts ASC",
    )?;
    for account in accounts.values_mut() {
        let rows =
            statement.query_map(params![account.account_id, range.start, range.end], |row| {
                Ok(AccountQuotaPoint {
                    ts: row.get(0)?,
                    primary_remaining_percent: row.get(1)?,
                    secondary_remaining_percent: row.get(2)?,
                    primary_reset_at: row.get(3)?,
                    secondary_reset_at: row.get(4)?,
                })
            })?;
        account.points = rows.collect::<Result<Vec<_>, _>>()?;
    }
    Ok(())
}
