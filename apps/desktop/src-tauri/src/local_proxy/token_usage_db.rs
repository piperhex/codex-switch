fn list_token_usage_entries_from_db(
    connection: &Connection,
    limit: usize,
) -> Result<Vec<TokenUsageEntry>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, ts, provider, provider_id, account_id, account_email, model, duration_ms,
                   input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens
            FROM token_usage_entries
            ORDER BY ts DESC, id DESC
            LIMIT ?1
            "#,
        )
        .map_err(|error| format!("Failed to query token usage entries: {error}"))?;
    let rows = statement
        .query_map(params![usize_to_i64(limit)], |row| {
            Ok(TokenUsageEntry {
                id: row.get(0)?,
                ts: i64_to_u64(row.get::<_, i64>(1)?),
                provider: row.get(2)?,
                provider_id: row.get(3)?,
                account_id: row.get(4)?,
                account_email: row.get(5)?,
                model: row.get(6)?,
                duration_ms: opt_i64_to_u64(row.get(7)?),
                input_tokens: opt_i64_to_u64(row.get(8)?),
                output_tokens: opt_i64_to_u64(row.get(9)?),
                reasoning_tokens: opt_i64_to_u64(row.get(10)?),
                cached_tokens: opt_i64_to_u64(row.get(11)?),
                total_tokens: opt_i64_to_u64(row.get(12)?),
                model_context_window: None,
            })
        })
        .map_err(|error| format!("Failed to read token usage entries: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to parse token usage entries: {error}"))
}

fn list_daily_token_usage_from_db(
    connection: &Connection,
    start_ts: u64,
) -> Result<Vec<DailyTokenUsage>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT ts, total_tokens, input_tokens, output_tokens, reasoning_tokens, cached_tokens
            FROM token_usage_entries
            WHERE ts >= ?1
            ORDER BY ts ASC
            "#,
        )
        .map_err(|error| format!("Failed to query daily token usage: {error}"))?;
    let rows = statement
        .query_map(params![u64_to_i64(start_ts)], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })
        .map_err(|error| format!("Failed to read daily token usage: {error}"))?;

    let mut daily_totals = BTreeMap::<String, (u64, u64, u64, u64, u64)>::new();
    for row in rows {
        let (timestamp, total, input, output, reasoning, cached) =
            row.map_err(|error| format!("Failed to parse daily token usage: {error}"))?;
        let Some(local_time) = Local.timestamp_opt(timestamp, 0).single() else {
            continue;
        };
        let input = opt_i64_to_u64(input).unwrap_or(0);
        let output = opt_i64_to_u64(output).unwrap_or(0);
        let reasoning = opt_i64_to_u64(reasoning).unwrap_or(0);
        let cached = opt_i64_to_u64(cached).unwrap_or(0);
        let total = opt_i64_to_u64(total).unwrap_or_else(|| input.saturating_add(output));
        let date = local_time.format("%Y-%m-%d").to_string();
        daily_totals
            .entry(date)
            .and_modify(|current| {
                current.0 = current.0.saturating_add(total);
                current.1 = current.1.saturating_add(input);
                current.2 = current.2.saturating_add(output);
                current.3 = current.3.saturating_add(reasoning);
                current.4 = current.4.saturating_add(cached);
            })
            .or_insert((total, input, output, reasoning, cached));
    }

    Ok(daily_totals
        .into_iter()
        .map(
            |(
                date,
                (total_tokens, input_tokens, output_tokens, reasoning_tokens, cached_tokens),
            )| DailyTokenUsage {
                date,
                total_tokens,
                input_tokens,
                output_tokens,
                reasoning_tokens,
                cached_tokens,
            },
        )
        .collect())
}

fn list_account_token_usage_from_db(
    connection: &Connection,
    start_ts: u64,
) -> Result<Vec<AccountTokenUsageTotals>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT account_id, account_email,
                   SUM(COALESCE(total_tokens, COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))),
                   SUM(COALESCE(input_tokens, 0)),
                   SUM(COALESCE(output_tokens, 0)),
                   SUM(COALESCE(reasoning_tokens, 0)),
                   SUM(COALESCE(cached_tokens, 0))
            FROM token_usage_entries
            WHERE ts >= ?1
              AND (account_id IS NOT NULL OR account_email IS NOT NULL)
            GROUP BY account_id, account_email
            ORDER BY 3 DESC
            "#,
        )
        .map_err(|error| format!("Failed to query account token usage: {error}"))?;
    let rows = statement
        .query_map(params![u64_to_i64(start_ts)], |row| {
            Ok(AccountTokenUsageTotals {
                account_id: row.get(0)?,
                account_email: row.get(1)?,
                total_tokens: i64_to_u64(row.get::<_, i64>(2)?),
                input_tokens: i64_to_u64(row.get::<_, i64>(3)?),
                output_tokens: i64_to_u64(row.get::<_, i64>(4)?),
                reasoning_tokens: i64_to_u64(row.get::<_, i64>(5)?),
                cached_tokens: i64_to_u64(row.get::<_, i64>(6)?),
            })
        })
        .map_err(|error| format!("Failed to read account token usage: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to parse account token usage: {error}"))
}

fn list_provider_token_usage_from_db(
    connection: &Connection,
    start_ts: u64,
) -> Result<Vec<ProviderTokenUsageTotals>, String> {
    seed_provider_token_usage_totals(connection)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT totals.provider, totals.provider_id,
                   COALESCE((
                       SELECT SUM(COALESCE(entry.total_tokens,
                           COALESCE(entry.input_tokens, 0) + COALESCE(entry.output_tokens, 0)))
                       FROM token_usage_entries entry
                       WHERE entry.ts >= ?1
                         AND (
                           (totals.provider_id IS NOT NULL AND entry.provider_id = totals.provider_id)
                           OR (totals.provider_id IS NULL AND entry.provider_id IS NULL
                               AND entry.provider = totals.provider)
                         )
                   ), 0),
                   totals.total_tokens
            FROM provider_token_usage_totals totals
            ORDER BY totals.total_tokens DESC
            "#,
        )
        .map_err(|error| format!("Failed to query provider token usage: {error}"))?;
    let rows = statement
        .query_map(params![u64_to_i64(start_ts)], |row| {
            Ok(ProviderTokenUsageTotals {
                provider: row.get(0)?,
                provider_id: row.get(1)?,
                today_tokens: i64_to_u64(row.get::<_, i64>(2)?),
                total_tokens: i64_to_u64(row.get::<_, i64>(3)?),
            })
        })
        .map_err(|error| format!("Failed to read provider token usage: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to parse provider token usage: {error}"))
}

fn seed_provider_token_usage_totals(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT OR IGNORE INTO provider_token_usage_totals (
                identity, provider, provider_id, total_tokens
            )
            SELECT CASE
                   WHEN provider_id IS NOT NULL THEN 'id:' || provider_id
                       ELSE 'name:' || provider
                   END,
                   MAX(provider),
                   provider_id,
                   SUM(COALESCE(total_tokens,
                       COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)))
            FROM token_usage_entries
            GROUP BY CASE
                         WHEN provider_id IS NOT NULL THEN 'id:' || provider_id
                         ELSE 'name:' || provider
                     END,
                     provider_id
            "#,
            [],
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to initialize provider token usage totals: {error}"))
}

fn add_provider_token_usage_total(
    connection: &Connection,
    entry: &TokenUsageEntry,
) -> Result<(), String> {
    let identity = entry
        .provider_id
        .as_deref()
        .map(|id| format!("id:{id}"))
        .unwrap_or_else(|| format!("name:{}", entry.provider));
    let total_tokens = entry.total_tokens.unwrap_or_else(|| {
        entry
            .input_tokens
            .unwrap_or(0)
            .saturating_add(entry.output_tokens.unwrap_or(0))
    });
    connection
        .execute(
            r#"
            INSERT INTO provider_token_usage_totals (
                identity, provider, provider_id, total_tokens
            ) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(identity) DO UPDATE SET
                provider = excluded.provider,
                provider_id = excluded.provider_id,
                total_tokens = provider_token_usage_totals.total_tokens + excluded.total_tokens
            "#,
            params![
                identity,
                entry.provider,
                entry.provider_id,
                u64_to_i64(total_tokens),
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to update provider token usage total: {error}"))
}

fn token_usage_params(entry: &TokenUsageEntry) -> [rusqlite::types::Value; 14] {
    [
        rusqlite::types::Value::Text(entry.id.clone()),
        rusqlite::types::Value::Integer(u64_to_i64(entry.ts)),
        rusqlite::types::Value::Text(entry.provider.clone()),
        optional_string_value(entry.provider_id.as_deref()),
        optional_string_value(entry.account_id.as_deref()),
        optional_string_value(entry.account_email.as_deref()),
        rusqlite::types::Value::Text(entry.model.clone()),
        optional_u64_value(entry.duration_ms),
        optional_u64_value(entry.input_tokens),
        optional_u64_value(entry.output_tokens),
        optional_u64_value(entry.reasoning_tokens),
        optional_u64_value(entry.cached_tokens),
        optional_u64_value(entry.total_tokens),
        rusqlite::types::Value::Integer(u128_to_i64(unix_millis())),
    ]
}

fn optional_string_value(value: Option<&str>) -> rusqlite::types::Value {
    value
        .map(|value| rusqlite::types::Value::Text(value.to_string()))
        .unwrap_or(rusqlite::types::Value::Null)
}

fn optional_u64_value(value: Option<u64>) -> rusqlite::types::Value {
    value
        .map(|value| rusqlite::types::Value::Integer(u64_to_i64(value)))
        .unwrap_or(rusqlite::types::Value::Null)
}

fn opt_i64_to_u64(value: Option<i64>) -> Option<u64> {
    value.and_then(|value| u64::try_from(value).ok())
}

fn i64_to_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn u64_to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn u128_to_i64(value: u128) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn usize_to_i64(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn token_usage_db_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?;
    Ok(app_data.join(TOKEN_USAGE_DB_FILE_NAME))
}

fn token_usage_jsonl_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?;
    Ok(app_data.join("logs").join(TOKEN_USAGE_JSONL_FILE_NAME))
}
