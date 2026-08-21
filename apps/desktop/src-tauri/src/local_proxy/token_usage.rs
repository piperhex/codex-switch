fn append_token_usage_entry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entry: &TokenUsageEntry,
) -> Result<(), String> {
    let connection = open_token_usage_db(app)?;
    insert_token_usage_entry(&connection, entry)
}

fn official_model_context_windows(paths: &Paths) -> HashMap<String, u64> {
    read_json(&paths.codex_home.join("models_cache.json"))
        .ok()
        .map(|catalog| model_context_windows_from_catalog(&catalog))
        .unwrap_or_default()
}

fn update_cached_model_context_window(paths: &Paths, context_window: u64) -> Result<(), String> {
    let path = paths.codex_home.join("models_cache.json");
    if !path.exists() {
        return Ok(());
    }
    let mut catalog = read_json(&path)?;
    if apply_model_context_window(&mut catalog, GPT_5_6_SOL_MODEL, context_window) {
        write_json_if_changed(&path, &catalog)?;
    }
    Ok(())
}

fn upstream_official_provider_names(paths: &Paths) -> HashSet<String> {
    providers::list_provider_profiles(paths)
        .unwrap_or_default()
        .into_iter()
        .filter(providers::uses_upstream_official_models)
        .map(|provider| provider.name)
        .collect()
}

struct ProviderContextWindowLookup {
    default: u64,
    models: HashMap<String, u64>,
}

impl ProviderContextWindowLookup {
    fn for_model(&self, model: &str) -> u64 {
        self.models.get(model).copied().unwrap_or(self.default)
    }
}

fn provider_context_windows(paths: &Paths) -> HashMap<String, ProviderContextWindowLookup> {
    providers::list_provider_profiles(paths)
        .unwrap_or_default()
        .into_iter()
        .map(|provider| {
            let mut models = provider
                .models
                .iter()
                .map(|model| {
                    (
                        model.clone(),
                        providers::effective_provider_context_window_for_model(&provider, model),
                    )
                })
                .collect::<HashMap<_, _>>();
            models.insert(
                providers::CODEX_SWITCH_CONTROL_MODEL.to_string(),
                providers::effective_provider_context_window_for_model(&provider, &provider.model),
            );
            let windows = ProviderContextWindowLookup {
                default: providers::effective_provider_context_window(&provider),
                models,
            };
            (provider.name.clone(), windows)
        })
        .collect()
}

fn uses_official_model_context(
    provider: &str,
    upstream_official_provider_names: &HashSet<String>,
) -> bool {
    provider == "Official Codex" || upstream_official_provider_names.contains(provider)
}

fn model_context_windows_from_catalog(catalog: &Value) -> HashMap<String, u64> {
    catalog
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let slug = model.get("slug").and_then(Value::as_str)?;
            let context_window = model
                .get("context_window")
                .and_then(Value::as_u64)
                .or_else(|| model.get("max_context_window").and_then(Value::as_u64))?;
            let effective_percent = model
                .get("effective_context_window_percent")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT);
            Some((
                slug.to_string(),
                context_window.saturating_mul(effective_percent) / 100,
            ))
        })
        .collect()
}

fn open_token_usage_db<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<LockedTokenUsageConnection, String> {
    let guard = token_usage_db_lock()
        .lock()
        .map_err(|error| format!("Failed to lock token usage database: {error}"))?;
    let path = token_usage_db_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Token usage database path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    let mut connection = Connection::open(&path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    connection
        .busy_timeout(Duration::from_secs(3))
        .map_err(|error| format!("Failed to configure {}: {error}", path.display()))?;
    init_token_usage_schema(&connection)?;
    let jsonl_path = token_usage_jsonl_path(app)?;
    migrate_token_usage_jsonl_if_needed(&mut connection, &jsonl_path)?;
    seed_provider_token_usage_totals(&connection)?;
    Ok(LockedTokenUsageConnection {
        _guard: guard,
        connection,
    })
}

fn init_token_usage_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS token_usage_entries (
                id TEXT PRIMARY KEY,
                ts INTEGER NOT NULL,
                provider TEXT NOT NULL,
                provider_id TEXT,
                account_id TEXT,
                account_email TEXT,
                model TEXT NOT NULL,
                duration_ms INTEGER,
                input_tokens INTEGER,
                output_tokens INTEGER,
                reasoning_tokens INTEGER,
                cached_tokens INTEGER,
                total_tokens INTEGER,
                created_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS token_usage_entries_ts_id
                ON token_usage_entries (ts DESC, id DESC);
            CREATE TABLE IF NOT EXISTS token_usage_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_token_usage_totals (
                identity TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                provider_id TEXT,
                total_tokens INTEGER NOT NULL
            );
            "#,
        )
        .map_err(|error| format!("Failed to initialize token usage database: {error}"))?;
    ensure_token_usage_account_columns(connection)
}

fn ensure_token_usage_account_columns(connection: &Connection) -> Result<(), String> {
    let columns = token_usage_table_columns(connection)?;
    for (name, sql) in [
        (
            "provider_id",
            "ALTER TABLE token_usage_entries ADD COLUMN provider_id TEXT",
        ),
        (
            "account_id",
            "ALTER TABLE token_usage_entries ADD COLUMN account_id TEXT",
        ),
        (
            "account_email",
            "ALTER TABLE token_usage_entries ADD COLUMN account_email TEXT",
        ),
    ] {
        if !columns.contains(name) {
            connection
                .execute(sql, [])
                .map_err(|error| format!("Failed to add token usage column {name}: {error}"))?;
        }
    }
    Ok(())
}

fn token_usage_table_columns(connection: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(token_usage_entries)")
        .map_err(|error| format!("Failed to inspect token usage database: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to inspect token usage columns: {error}"))?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|error| format!("Failed to read token usage columns: {error}"))
}

fn migrate_token_usage_jsonl_if_needed(
    connection: &mut Connection,
    path: &Path,
) -> Result<(), String> {
    let migrated = connection
        .query_row(
            "SELECT value FROM token_usage_meta WHERE key = 'jsonl_migrated'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read token usage migration state: {error}"))?
        .is_some();
    if migrated {
        return Ok(());
    }

    if path.exists() {
        import_token_usage_jsonl(connection, path)?;
    }
    connection
        .execute(
            "INSERT OR REPLACE INTO token_usage_meta (key, value) VALUES ('jsonl_migrated', '1')",
            [],
        )
        .map_err(|error| format!("Failed to write token usage migration state: {error}"))?;
    Ok(())
}

fn import_token_usage_jsonl(connection: &mut Connection, path: &Path) -> Result<usize, String> {
    let file = fs::File::open(path).map_err(|error| {
        format!(
            "Failed to open legacy token usage log {}: {error}",
            path.display()
        )
    })?;
    let reader = BufReader::new(file);
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Failed to start token usage migration: {error}"))?;
    let mut imported = 0;
    {
        let mut statement = transaction
            .prepare(
                r#"
                INSERT OR IGNORE INTO token_usage_entries (
                    id, ts, provider, provider_id, account_id, account_email, model, duration_ms,
                    input_tokens, output_tokens, reasoning_tokens, cached_tokens,
                    total_tokens, created_at_ms
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                "#,
            )
            .map_err(|error| format!("Failed to prepare token usage migration: {error}"))?;
        for line in reader.lines() {
            let line = line.map_err(|error| {
                format!(
                    "Failed to read legacy token usage log {}: {error}",
                    path.display()
                )
            })?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<TokenUsageEntry>(trimmed) else {
                continue;
            };
            imported += insert_token_usage_entry_with_statement(&mut statement, &entry)?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Failed to commit token usage migration: {error}"))?;
    Ok(imported)
}

fn insert_token_usage_entry(
    connection: &Connection,
    entry: &TokenUsageEntry,
) -> Result<(), String> {
    let inserted = connection
        .execute(
            r#"
            INSERT OR IGNORE INTO token_usage_entries (
                id, ts, provider, provider_id, account_id, account_email, model, duration_ms,
                input_tokens, output_tokens, reasoning_tokens, cached_tokens,
                total_tokens, created_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
            token_usage_params(entry),
        )
        .map_err(|error| format!("Failed to insert token usage entry: {error}"))?;
    if inserted > 0 {
        add_provider_token_usage_total(connection, entry)?;
    }
    Ok(())
}

fn insert_token_usage_entry_with_statement(
    statement: &mut rusqlite::Statement<'_>,
    entry: &TokenUsageEntry,
) -> Result<usize, String> {
    statement
        .execute(token_usage_params(entry))
        .map_err(|error| format!("Failed to import token usage entry: {error}"))
}
