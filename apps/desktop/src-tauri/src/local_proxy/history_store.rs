#[derive(Debug)]
enum ProxyHistoryError {
    Io(io::Error),
    Database(rusqlite::Error),
    Json(serde_json::Error),
    Lock,
    Version,
    Attachment,
}

impl std::fmt::Display for ProxyHistoryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Conversation history is unavailable")
    }
}

impl std::error::Error for ProxyHistoryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Database(error) => Some(error),
            Self::Json(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for ProxyHistoryError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}
impl From<rusqlite::Error> for ProxyHistoryError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}
impl From<serde_json::Error> for ProxyHistoryError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

type ProxyHistoryResult<T> = Result<T, ProxyHistoryError>;

struct ProxyHistoryStore {
    connection: Mutex<Connection>,
    attachments: PathBuf,
}

struct ProxyHistorySnapshot {
    session: ProxySessionState,
    request: Option<ProxySessionRequestState>,
}

impl ProxyHistoryStore {
    fn open(root: &Path) -> ProxyHistoryResult<Self> {
        let attachments = root.join("attachments");
        fs::create_dir_all(&attachments)?;
        let connection = Connection::open(root.join("history.sqlite3"))?;
        connection.busy_timeout(Duration::from_secs(2))?;
        initialize_proxy_history_schema(&connection)?;
        // A request left open by the previous process must not appear to still be running.
        connection.execute("UPDATE requests SET interrupted = 1 WHERE finished = 0", [])?;
        let store = Self {
            connection: Mutex::new(connection),
            attachments,
        };
        store.remove_unreferenced_attachments()?;
        Ok(store)
    }

    fn sessions(&self) -> ProxyHistoryResult<Vec<ProxySessionState>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| ProxyHistoryError::Lock)?;
        let mut statement =
            connection.prepare("SELECT metadata FROM sessions ORDER BY last_seen DESC")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    fn requests(&self, session_id: &str) -> ProxyHistoryResult<Vec<ProxySessionRequestState>> {
        let rows = {
            let connection = self
                .connection
                .lock()
                .map_err(|_| ProxyHistoryError::Lock)?;
            let mut statement = connection.prepare(
                "SELECT content, interrupted FROM requests WHERE session_id = ?1
                 ORDER BY request_id DESC LIMIT ?2",
            )?;
            let rows = statement.query_map(
                params![session_id, PROXY_SESSION_REQUEST_KEEP_ROWS as u64],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
            )?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        rows.into_iter()
            .map(|(content, interrupted)| {
                let mut request: ProxySessionRequestState = serde_json::from_str(&content)?;
                request.interrupted |= interrupted;
                Ok(request)
            })
            .collect()
    }

    fn save_with(
        &self,
        snapshot: impl FnOnce() -> ProxyHistoryResult<Option<ProxyHistorySnapshot>>,
    ) -> ProxyHistoryResult<()> {
        // Serialize writers before taking a memory snapshot, so an older callback cannot
        // overwrite newer session totals. Callers must release the session lock first.
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| ProxyHistoryError::Lock)?;
        if let Some(snapshot) = snapshot()? {
            write_proxy_history_snapshot(&mut connection, &snapshot)?;
        }
        Ok(())
    }
}

fn initialize_proxy_history_schema(connection: &Connection) -> ProxyHistoryResult<()> {
    let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > 1 {
        return Err(ProxyHistoryError::Version);
    }
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=FULL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS sessions (
             id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL, metadata TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS requests (
             session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
             request_id INTEGER NOT NULL, content TEXT NOT NULL,
             finished INTEGER NOT NULL, interrupted INTEGER NOT NULL DEFAULT 0,
             PRIMARY KEY(session_id, request_id)
         );
         CREATE TABLE IF NOT EXISTS attachments (
             id TEXT PRIMARY KEY, media_type TEXT, remote_url TEXT
         );
         CREATE TABLE IF NOT EXISTS request_attachments (
             session_id TEXT NOT NULL, request_id INTEGER NOT NULL, attachment_id TEXT NOT NULL,
             PRIMARY KEY(session_id, request_id, attachment_id),
             FOREIGN KEY(session_id, request_id) REFERENCES requests(session_id, request_id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS attachment_references ON request_attachments(attachment_id);
         PRAGMA user_version=1;"
    )?;
    Ok(())
}

fn write_proxy_history_snapshot(
    connection: &mut Connection,
    snapshot: &ProxyHistorySnapshot,
) -> ProxyHistoryResult<()> {
    let transaction = connection.transaction()?;
    let session = &snapshot.session;
    transaction.execute(
        "INSERT INTO sessions(id, last_seen, metadata) VALUES(?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen, metadata=excluded.metadata",
        params![
            session.id,
            session.last_seen_at,
            serde_json::to_string(session)?
        ],
    )?;
    if let Some(request) = &snapshot.request {
        write_proxy_history_request(&transaction, &session.id, request)?;
    }
    transaction.execute(
        "DELETE FROM requests WHERE session_id=?1 AND request_id NOT IN
         (SELECT request_id FROM requests WHERE session_id=?1 ORDER BY request_id DESC LIMIT ?2)",
        params![session.id, PROXY_SESSION_REQUEST_KEEP_ROWS as u64],
    )?;
    transaction.commit()?;
    Ok(())
}

fn write_proxy_history_request(
    connection: &Connection,
    session_id: &str,
    request: &ProxySessionRequestState,
) -> ProxyHistoryResult<()> {
    connection.execute(
        "INSERT INTO requests(session_id, request_id, content, finished, interrupted) VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(session_id, request_id) DO UPDATE SET content=excluded.content,
         finished=excluded.finished, interrupted=excluded.interrupted",
        params![session_id, request.id, serde_json::to_string(request)?,
            request.response_time_ms.is_some() || request.interrupted, request.interrupted],
    )?;
    connection.execute(
        "DELETE FROM request_attachments WHERE session_id=?1 AND request_id=?2",
        params![session_id, request.id],
    )?;
    for attachment in request
        .input_attachments
        .iter()
        .chain(&request.output_attachments)
    {
        connection.execute(
            "INSERT OR IGNORE INTO request_attachments VALUES(?1, ?2, ?3)",
            params![session_id, request.id, attachment.id],
        )?;
    }
    Ok(())
}
