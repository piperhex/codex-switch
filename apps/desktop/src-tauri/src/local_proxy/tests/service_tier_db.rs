const SERVICE_TIER_TEST_TIMESTAMP: u64 = 100;

fn service_tier_test_entry(id: &str, service_tier: Option<&str>) -> TokenUsageEntry {
    TokenUsageEntry {
        id: id.to_string(),
        ts: SERVICE_TIER_TEST_TIMESTAMP,
        provider: "Service tier provider".to_string(),
        provider_id: Some("service-tier-provider".to_string()),
        account_id: None,
        account_email: None,
        model: "gpt-test".to_string(),
        duration_ms: Some(50),
        input_tokens: Some(80),
        output_tokens: Some(20),
        reasoning_tokens: Some(5),
        cached_tokens: Some(30),
        total_tokens: Some(100),
        service_tier: service_tier.map(str::to_string),
        model_context_window: None,
    }
}

fn assert_service_tier_entries_match(actual: &[TokenUsageEntry], expected: &[TokenUsageEntry]) {
    let mut actual = actual.to_vec();
    let mut expected = expected.to_vec();
    actual.sort_by(|left, right| left.id.cmp(&right.id));
    expected.sort_by(|left, right| left.id.cmp(&right.id));
    assert_eq!(
        serde_json::to_value(actual).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
}

#[test]
fn token_usage_database_migrates_legacy_rows_without_assigning_service_tiers() {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            r#"
            CREATE TABLE token_usage_entries (
                id TEXT PRIMARY KEY, ts INTEGER NOT NULL, provider TEXT NOT NULL,
                model TEXT NOT NULL, duration_ms INTEGER, input_tokens INTEGER,
                output_tokens INTEGER, reasoning_tokens INTEGER, cached_tokens INTEGER,
                total_tokens INTEGER, created_at_ms INTEGER NOT NULL
            );
            INSERT INTO token_usage_entries (
                id, ts, provider, model, input_tokens, output_tokens, total_tokens, created_at_ms
            ) VALUES ('legacy-entry', 100, 'Legacy provider', 'gpt-test', 80, 20, 100, 100000);
            "#,
        )
        .unwrap();

    init_token_usage_schema(&connection).unwrap();
    init_token_usage_schema(&connection).unwrap();

    let column: (String, i64, Option<String>) = connection
        .query_row(
            r#"SELECT type, "notnull", dflt_value
               FROM pragma_table_info('token_usage_entries') WHERE name = 'service_tier'"#,
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(column, ("TEXT".to_string(), 0, None));
    let entries = list_token_usage_entries_from_db(&connection, 10).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].service_tier, None);
    assert_eq!(entries[0].provider_id, None);
    assert_eq!(entries[0].total_tokens, Some(100));
    let since =
        list_token_usage_entries_since_from_db(&connection, SERVICE_TIER_TEST_TIMESTAMP).unwrap();
    assert_service_tier_entries_match(&since, &entries);
}

#[test]
fn token_usage_database_preserves_optional_service_tiers_in_both_readers() {
    let connection = Connection::open_in_memory().unwrap();
    init_token_usage_schema(&connection).unwrap();
    let entries = [
        service_tier_test_entry("unknown", None),
        service_tier_test_entry("priority", Some("priority")),
        service_tier_test_entry("default", Some("default")),
        service_tier_test_entry("fast", Some("fast")),
    ];
    for entry in &entries {
        insert_token_usage_entry(&connection, entry).unwrap();
    }

    let recent = list_token_usage_entries_from_db(&connection, entries.len()).unwrap();
    let since =
        list_token_usage_entries_since_from_db(&connection, SERVICE_TIER_TEST_TIMESTAMP).unwrap();
    assert_service_tier_entries_match(&recent, &entries);
    assert_service_tier_entries_match(&since, &entries);
}

#[test]
fn token_usage_jsonl_migration_preserves_service_tiers_and_accepts_legacy_entries() {
    let mut connection = Connection::open_in_memory().unwrap();
    init_token_usage_schema(&connection).unwrap();
    let entries = [
        service_tier_test_entry("legacy", None),
        service_tier_test_entry("priority", Some("priority")),
        service_tier_test_entry("default", Some("default")),
        service_tier_test_entry("fast", Some("fast")),
    ];
    let mut json_entries: Vec<Value> = entries
        .iter()
        .map(|entry| serde_json::to_value(entry).unwrap())
        .collect();
    json_entries[0]
        .as_object_mut()
        .unwrap()
        .remove("serviceTier");
    assert_eq!(json_entries[1]["serviceTier"], "priority");
    let content = json_entries
        .iter()
        .map(|entry| serde_json::to_string(entry).unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    let path = std::env::temp_dir().join(format!(
        "codex-switch-service-tier-{}.jsonl",
        uuid::Uuid::new_v4()
    ));
    fs::write(&path, content).unwrap();
    let migration = migrate_token_usage_jsonl_if_needed(&mut connection, &path);
    fs::remove_file(&path).unwrap();
    migration.unwrap();

    let imported = list_token_usage_entries_from_db(&connection, entries.len()).unwrap();
    assert_service_tier_entries_match(&imported, &entries);
    migrate_token_usage_jsonl_if_needed(&mut connection, &path).unwrap();
    let since =
        list_token_usage_entries_since_from_db(&connection, SERVICE_TIER_TEST_TIMESTAMP).unwrap();
    assert_service_tier_entries_match(&since, &entries);
}
