/// Daily raw token totals grouped independently by context size and service mode.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DailyTokenUsageBreakdown {
    date: String,
    short_context_tokens: u64,
    long_context_tokens: u64,
    unknown_context_tokens: u64,
    standard_mode_tokens: u64,
    fast_mode_tokens: u64,
    unknown_mode_tokens: u64,
}

const TOKEN_USAGE_BREAKDOWN_UNAVAILABLE: &str =
    "Unable to load token consumption statistics. Please try again.";

#[tauri::command]
pub(crate) async fn list_token_usage_breakdown<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
    long_context_threshold_tokens: u64,
) -> Result<Vec<DailyTokenUsageBreakdown>, String> {
    validate_token_usage_breakdown_range(start_ts, long_context_threshold_tokens)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        // Database errors can contain local paths; return a safe message at the IPC boundary.
        let connection =
            open_token_usage_db(&app).map_err(|_| TOKEN_USAGE_BREAKDOWN_UNAVAILABLE.to_string())?;
        list_token_usage_breakdown_from_db(&connection, start_ts, long_context_threshold_tokens)
            .map_err(|_| TOKEN_USAGE_BREAKDOWN_UNAVAILABLE.to_string())
    })
    .await
    .map_err(|_| TOKEN_USAGE_BREAKDOWN_UNAVAILABLE.to_string())?
}

#[derive(Debug, PartialEq, Eq)]
enum TokenUsageBreakdownRangeError {
    InvalidStart,
    InvalidThreshold,
}

impl std::fmt::Display for TokenUsageBreakdownRangeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::InvalidStart => "Choose a valid statistics date range.",
            Self::InvalidThreshold => "Choose a positive long-context token threshold.",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for TokenUsageBreakdownRangeError {}

fn validate_token_usage_breakdown_range(
    start_ts: u64,
    threshold: u64,
) -> Result<(), TokenUsageBreakdownRangeError> {
    if i64::try_from(start_ts)
        .ok()
        .and_then(|timestamp| Local.timestamp_opt(timestamp, 0).single())
        .is_none()
    {
        return Err(TokenUsageBreakdownRangeError::InvalidStart);
    }
    if threshold == 0 || i64::try_from(threshold).is_err() {
        return Err(TokenUsageBreakdownRangeError::InvalidThreshold);
    }
    Ok(())
}

struct TokenUsageBreakdownRow {
    timestamp: i64,
    input_tokens: Option<u64>,
    total_tokens: u64,
    service_tier: Option<String>,
}

fn list_token_usage_breakdown_from_db(
    connection: &Connection,
    start_ts: u64,
    long_context_threshold_tokens: u64,
) -> rusqlite::Result<Vec<DailyTokenUsageBreakdown>> {
    // Stream every matching request; the recent-request limit must never truncate chart totals.
    let mut statement = connection.prepare(
        "SELECT ts, input_tokens, output_tokens, total_tokens, service_tier
         FROM token_usage_entries WHERE ts >= ?1 ORDER BY ts ASC",
    )?;
    let rows = statement.query_map(params![u64_to_i64(start_ts)], token_usage_breakdown_row)?;
    let mut daily_totals = BTreeMap::<String, DailyTokenUsageBreakdown>::new();
    for row in rows {
        let row = row?;
        let Some(local_time) = Local.timestamp_opt(row.timestamp, 0).single() else {
            continue;
        };
        let date = local_time.format("%Y-%m-%d").to_string();
        let daily = daily_totals
            .entry(date.clone())
            .or_insert_with(|| DailyTokenUsageBreakdown {
                date,
                ..Default::default()
            });
        add_token_usage_breakdown(daily, &row, long_context_threshold_tokens);
    }
    Ok(daily_totals.into_values().collect())
}

fn token_usage_breakdown_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TokenUsageBreakdownRow> {
    let input_tokens = opt_i64_to_u64(row.get(1)?);
    let output_tokens = opt_i64_to_u64(row.get(2)?).unwrap_or(0);
    // Cached input and reasoning output are subsets, so neither is added to raw consumption again.
    let total_tokens = opt_i64_to_u64(row.get(3)?)
        .unwrap_or_else(|| input_tokens.unwrap_or(0).saturating_add(output_tokens));
    Ok(TokenUsageBreakdownRow {
        timestamp: row.get(0)?,
        input_tokens,
        total_tokens,
        service_tier: row.get(4)?,
    })
}

fn add_token_usage_breakdown(
    daily: &mut DailyTokenUsageBreakdown,
    row: &TokenUsageBreakdownRow,
    long_context_threshold_tokens: u64,
) {
    // Input already includes cached tokens, and the threshold is exclusive for long context.
    let context_total = match row.input_tokens {
        Some(input) if input > long_context_threshold_tokens => &mut daily.long_context_tokens,
        Some(_) => &mut daily.short_context_tokens,
        None => &mut daily.unknown_context_tokens,
    };
    *context_total = context_total.saturating_add(row.total_tokens);
    let tier = row.service_tier.as_deref().map(str::trim);
    let mode_total = match tier {
        Some(tier)
            if tier.eq_ignore_ascii_case("priority") || tier.eq_ignore_ascii_case("fast") =>
        {
            &mut daily.fast_mode_tokens
        }
        Some(tier)
            if tier.eq_ignore_ascii_case("default") || tier.eq_ignore_ascii_case("standard") =>
        {
            &mut daily.standard_mode_tokens
        }
        _ => &mut daily.unknown_mode_tokens,
    };
    *mode_total = mode_total.saturating_add(row.total_tokens);
}
