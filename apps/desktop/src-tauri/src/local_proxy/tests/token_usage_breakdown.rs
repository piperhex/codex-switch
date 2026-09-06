const BREAKDOWN_TEST_TIMESTAMP: u64 = 1_700_000_000;
const BREAKDOWN_TEST_THRESHOLD: u64 = 200_000;
const BREAKDOWN_TEST_DAY_SECONDS: u64 = 24 * 60 * 60;

fn breakdown_test_entry(id: &str) -> TokenUsageEntry {
    TokenUsageEntry {
        id: id.to_string(),
        ts: BREAKDOWN_TEST_TIMESTAMP,
        provider: "Breakdown provider".to_string(),
        provider_id: None,
        account_id: None,
        account_email: None,
        model: "gpt-test".to_string(),
        duration_ms: Some(50),
        input_tokens: Some(80),
        output_tokens: Some(20),
        reasoning_tokens: Some(5),
        cached_tokens: Some(30),
        total_tokens: Some(100),
        service_tier: Some("default".to_string()),
        model_context_window: None,
    }
}

fn breakdown_test_database(entries: &[TokenUsageEntry]) -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    init_token_usage_schema(&connection).unwrap();
    for entry in entries {
        insert_token_usage_entry(&connection, entry).unwrap();
    }
    connection
}

#[test]
fn token_usage_breakdown_classifies_the_threshold_without_adding_cached_input() {
    let mut at_threshold = breakdown_test_entry("at-threshold");
    at_threshold.input_tokens = Some(BREAKDOWN_TEST_THRESHOLD);
    at_threshold.cached_tokens = Some(BREAKDOWN_TEST_THRESHOLD - 100);
    at_threshold.total_tokens = Some(BREAKDOWN_TEST_THRESHOLD + 20);
    let mut above_threshold = at_threshold.clone();
    above_threshold.id = "above-threshold".to_string();
    above_threshold.input_tokens = Some(BREAKDOWN_TEST_THRESHOLD + 1);
    above_threshold.total_tokens = None;
    above_threshold.service_tier = Some("priority".to_string());
    let connection = breakdown_test_database(&[at_threshold, above_threshold]);

    let daily = list_token_usage_breakdown_from_db(
        &connection,
        BREAKDOWN_TEST_TIMESTAMP,
        BREAKDOWN_TEST_THRESHOLD,
    )
    .unwrap();

    assert_eq!(daily.len(), 1);
    assert_eq!(daily[0].short_context_tokens, BREAKDOWN_TEST_THRESHOLD + 20);
    assert_eq!(daily[0].long_context_tokens, BREAKDOWN_TEST_THRESHOLD + 21);
    assert_eq!(daily[0].unknown_context_tokens, 0);
    assert_eq!(daily[0].standard_mode_tokens, BREAKDOWN_TEST_THRESHOLD + 20);
    assert_eq!(daily[0].fast_mode_tokens, BREAKDOWN_TEST_THRESHOLD + 21);
}

#[test]
fn token_usage_breakdown_preserves_unknown_fields_and_uses_reported_totals() {
    let mut reported = breakdown_test_entry("reported-total");
    reported.total_tokens = Some(125);
    reported.service_tier = None;
    let mut unknown = breakdown_test_entry("unknown-input");
    unknown.input_tokens = None;
    unknown.total_tokens = None;
    unknown.service_tier = Some("flex".to_string());
    let mut zero = breakdown_test_entry("zero-input");
    zero.input_tokens = Some(0);
    zero.total_tokens = Some(0);
    zero.service_tier = Some("fast".to_string());
    let connection = breakdown_test_database(&[reported, unknown, zero]);

    let daily = list_token_usage_breakdown_from_db(
        &connection,
        BREAKDOWN_TEST_TIMESTAMP,
        BREAKDOWN_TEST_THRESHOLD,
    )
    .unwrap();

    assert_eq!(daily[0].short_context_tokens, 125);
    assert_eq!(daily[0].unknown_context_tokens, 20);
    assert_eq!(daily[0].unknown_mode_tokens, 145);
    assert_eq!(daily[0].fast_mode_tokens, 0);
    assert_eq!(daily[0].standard_mode_tokens, 0);
}

#[test]
fn token_usage_breakdown_classifies_modes_without_changing_raw_token_totals() {
    for (tier, standard, fast, unknown) in [
        (Some("default"), 100, 0, 0),
        (Some(" STANDARD "), 100, 0, 0),
        (Some("priority"), 0, 100, 0),
        (Some(" FAST "), 0, 100, 0),
        (Some("auto"), 0, 0, 100),
        (Some("flex"), 0, 0, 100),
        (Some(""), 0, 0, 100),
        (None, 0, 0, 100),
    ] {
        let row = TokenUsageBreakdownRow {
            timestamp: BREAKDOWN_TEST_TIMESTAMP as i64,
            input_tokens: Some(80),
            total_tokens: 100,
            service_tier: tier.map(str::to_string),
        };
        let mut daily = DailyTokenUsageBreakdown::default();
        add_token_usage_breakdown(&mut daily, &row, BREAKDOWN_TEST_THRESHOLD);
        assert_eq!(daily.standard_mode_tokens, standard, "{tier:?}");
        assert_eq!(daily.fast_mode_tokens, fast, "{tier:?}");
        assert_eq!(daily.unknown_mode_tokens, unknown, "{tier:?}");
        assert_eq!(daily.short_context_tokens, 100);
    }
}

#[test]
fn token_usage_breakdown_includes_all_requests_since_the_exact_range_boundary() {
    let request_count = TOKEN_USAGE_LIST_LIMIT + 17;
    let mut entries: Vec<_> = (0..request_count)
        .map(|index| breakdown_test_entry(&format!("request-{index}")))
        .collect();
    let mut earlier = breakdown_test_entry("before-range");
    earlier.ts -= 1;
    entries.push(earlier);
    let connection = breakdown_test_database(&entries);

    let recent = list_token_usage_entries_from_db(&connection, TOKEN_USAGE_LIST_LIMIT).unwrap();
    let daily = list_token_usage_breakdown_from_db(
        &connection,
        BREAKDOWN_TEST_TIMESTAMP,
        BREAKDOWN_TEST_THRESHOLD,
    )
    .unwrap();

    assert_eq!(recent.len(), TOKEN_USAGE_LIST_LIMIT);
    assert_eq!(daily.len(), 1);
    assert_eq!(daily[0].short_context_tokens, request_count as u64 * 100);
    assert_eq!(daily[0].standard_mode_tokens, request_count as u64 * 100);
}

#[test]
fn token_usage_breakdown_uses_the_existing_daily_chart_calendar_and_order() {
    let mut first = breakdown_test_entry("first");
    first.ts -= BREAKDOWN_TEST_DAY_SECONDS;
    let second = breakdown_test_entry("second");
    let connection = breakdown_test_database(&[second, first]);

    let breakdown =
        list_token_usage_breakdown_from_db(&connection, 0, BREAKDOWN_TEST_THRESHOLD).unwrap();
    let daily = list_daily_token_usage_from_db(&connection, 0).unwrap();

    assert_eq!(breakdown.len(), 2);
    assert!(breakdown[0].date < breakdown[1].date);
    for (breakdown, total) in breakdown.iter().zip(daily) {
        assert_eq!(breakdown.date, total.date);
        assert_eq!(breakdown.short_context_tokens, total.total_tokens);
    }
    let empty = list_token_usage_breakdown_from_db(
        &connection,
        BREAKDOWN_TEST_TIMESTAMP + 1,
        BREAKDOWN_TEST_THRESHOLD,
    )
    .unwrap();
    assert!(empty.is_empty());
}

#[test]
fn token_usage_breakdown_saturates_totals_and_rejects_invalid_ranges() {
    let row = TokenUsageBreakdownRow {
        timestamp: BREAKDOWN_TEST_TIMESTAMP as i64,
        input_tokens: None,
        total_tokens: u64::MAX,
        service_tier: None,
    };
    let mut daily = DailyTokenUsageBreakdown::default();
    add_token_usage_breakdown(&mut daily, &row, BREAKDOWN_TEST_THRESHOLD);
    add_token_usage_breakdown(&mut daily, &row, BREAKDOWN_TEST_THRESHOLD);
    assert_eq!(daily.unknown_context_tokens, u64::MAX);
    assert_eq!(daily.unknown_mode_tokens, u64::MAX);
    assert!(validate_token_usage_breakdown_range(0, BREAKDOWN_TEST_THRESHOLD).is_ok());
    assert_eq!(
        validate_token_usage_breakdown_range(0, 0),
        Err(TokenUsageBreakdownRangeError::InvalidThreshold),
    );
    assert_eq!(
        validate_token_usage_breakdown_range(0, u64::MAX),
        Err(TokenUsageBreakdownRangeError::InvalidThreshold),
    );
    assert_eq!(
        validate_token_usage_breakdown_range(u64::MAX, BREAKDOWN_TEST_THRESHOLD),
        Err(TokenUsageBreakdownRangeError::InvalidStart),
    );
}
