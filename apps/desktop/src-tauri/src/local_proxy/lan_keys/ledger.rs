use super::{LanKeyError, Paths};
use rusqlite::{params, Connection};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{LazyLock, Mutex, MutexGuard},
};

const LEDGER_FILE_NAME: &str = "local-proxy-lan-usage.sqlite3";
pub(super) static LEDGER_LOCK: Mutex<()> = Mutex::new(());
static PENDING_USAGE: LazyLock<Mutex<HashMap<PathBuf, HashMap<String, KeyUsage>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct KeyUsage {
    pub(super) tokens: u64,
    pub(super) cost_usd: f64,
    pub(super) incomplete: bool,
}

/// This guard spans the complete operation, including queries and writes.
struct Ledger {
    connection: Connection,
    _guard: MutexGuard<'static, ()>,
}

fn open(paths: &Paths) -> Result<Ledger, LanKeyError> {
    let guard = LEDGER_LOCK.lock().map_err(|_| LanKeyError::Unavailable)?;
    let path = paths.state_file.with_file_name(LEDGER_FILE_NAME);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| LanKeyError::Unavailable)?;
    }
    let connection = Connection::open(path).map_err(|_| LanKeyError::Unavailable)?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| LanKeyError::Unavailable)?;
    init_schema(&connection)?;
    Ok(Ledger {
        connection,
        _guard: guard,
    })
}

fn init_schema(connection: &Connection) -> Result<(), LanKeyError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS lan_key_usage (
            key_id TEXT PRIMARY KEY NOT NULL,
            used_tokens INTEGER NOT NULL DEFAULT 0 CHECK(used_tokens >= 0),
            used_cost_usd REAL NOT NULL DEFAULT 0 CHECK(used_cost_usd >= 0),
            usage_incomplete INTEGER NOT NULL DEFAULT 0
        );",
        )
        .map_err(|_| LanKeyError::Unavailable)
}

pub(super) fn load_all(paths: &Paths) -> Result<HashMap<String, KeyUsage>, LanKeyError> {
    let ledger = open(paths)?;
    flush_pending(&ledger.connection, paths)?;
    let mut statement = ledger
        .connection
        .prepare("SELECT key_id, used_tokens, used_cost_usd, usage_incomplete FROM lan_key_usage")
        .map_err(|_| LanKeyError::Unavailable)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                KeyUsage {
                    tokens: row.get(1)?,
                    cost_usd: row.get(2)?,
                    incomplete: row.get(3)?,
                },
            ))
        })
        .map_err(|_| LanKeyError::Unavailable)?;
    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|_| LanKeyError::Unavailable)
}

pub(super) fn record(paths: &Paths, key_id: &str, usage: KeyUsage) -> Result<(), LanKeyError> {
    let result = record_durably(paths, key_id, usage);
    if result.is_err() {
        remember_pending(paths, key_id, usage)?;
    }
    result
}

fn record_durably(paths: &Paths, key_id: &str, usage: KeyUsage) -> Result<(), LanKeyError> {
    let ledger = open(paths)?;
    flush_pending(&ledger.connection, paths)?;
    record_in_connection(&ledger.connection, key_id, usage)
}

pub(super) fn acknowledge_usage(paths: &Paths, key_id: &str) -> Result<(), LanKeyError> {
    let ledger = open(paths)?;
    flush_pending(&ledger.connection, paths)?;
    ledger
        .connection
        .execute(
            "UPDATE lan_key_usage SET usage_incomplete = 0 WHERE key_id = ?1",
            [key_id],
        )
        .map_err(|_| LanKeyError::Unavailable)?;
    Ok(())
}

fn remember_pending(paths: &Paths, key_id: &str, usage: KeyUsage) -> Result<(), LanKeyError> {
    let mut pending = PENDING_USAGE.lock().map_err(|_| LanKeyError::Unavailable)?;
    let outstanding = pending
        .entry(paths.state_file.clone())
        .or_default()
        .entry(key_id.into())
        .or_default();
    outstanding.tokens = outstanding.tokens.saturating_add(usage.tokens);
    outstanding.cost_usd += usage.cost_usd;
    outstanding.incomplete = true;
    Ok(())
}

fn flush_pending(connection: &Connection, paths: &Paths) -> Result<(), LanKeyError> {
    let mut pending = PENDING_USAGE.lock().map_err(|_| LanKeyError::Unavailable)?;
    let Some(outstanding) = pending.get_mut(&paths.state_file) else {
        return Ok(());
    };
    let ids: Vec<_> = outstanding.keys().cloned().collect();
    for id in ids {
        if let Some(usage) = outstanding.get(&id).copied() {
            record_in_connection(connection, &id, usage)?;
            outstanding.remove(&id);
        }
    }
    pending.remove(&paths.state_file);
    Ok(())
}

fn record_in_connection(
    connection: &Connection,
    key_id: &str,
    usage: KeyUsage,
) -> Result<(), LanKeyError> {
    if !usage.cost_usd.is_finite() || usage.cost_usd < 0.0 {
        return Err(LanKeyError::Unavailable);
    }
    let tokens = usage.tokens.min(i64::MAX as u64) as i64;
    connection
        .execute(
            "INSERT INTO lan_key_usage (key_id, used_tokens, used_cost_usd, usage_incomplete)
         VALUES (?1, ?2, ?3, ?5)
         ON CONFLICT(key_id) DO UPDATE SET
             used_tokens = MIN(?4, lan_key_usage.used_tokens + excluded.used_tokens),
             used_cost_usd = lan_key_usage.used_cost_usd + excluded.used_cost_usd,
             usage_incomplete = MAX(lan_key_usage.usage_incomplete, excluded.usage_incomplete)",
            params![key_id, tokens, usage.cost_usd, i64::MAX, usage.incomplete],
        )
        .map_err(|_| LanKeyError::Unavailable)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ledger_accumulates_each_key_and_has_no_dependency_on_request_history() {
        let connection = Connection::open_in_memory().unwrap();
        init_schema(&connection).unwrap();
        record_in_connection(
            &connection,
            "a",
            KeyUsage {
                tokens: 100,
                cost_usd: 0.25,
                incomplete: false,
            },
        )
        .unwrap();
        record_in_connection(
            &connection,
            "b",
            KeyUsage {
                tokens: 20,
                cost_usd: 0.5,
                incomplete: false,
            },
        )
        .unwrap();
        record_in_connection(
            &connection,
            "a",
            KeyUsage {
                tokens: 200,
                cost_usd: 0.75,
                incomplete: false,
            },
        )
        .unwrap();
        let usage: (u64, f64) = connection
            .query_row(
                "SELECT used_tokens, used_cost_usd FROM lan_key_usage WHERE key_id = 'a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(usage, (300, 1.0));
        let keys: usize = connection
            .query_row("SELECT count(*) FROM lan_key_usage", [], |row| row.get(0))
            .unwrap();
        assert_eq!(keys, 2);
    }
}
