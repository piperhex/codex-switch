use super::*;

#[test]
fn accepts_provider_import_route() {
    let url = Url::parse("ccswitch://v1/import?resource=provider&app=codex").unwrap();
    assert!(validate_route(&url).is_ok());
}

#[test]
fn accepts_first_party_provider_import_route() {
    let url = Url::parse("cswitch://v1/import?resource=provider&app=codex").unwrap();
    assert!(validate_route(&url).is_ok());
}

#[test]
fn rejects_other_resources() {
    let url = Url::parse("ccswitch://v1/import?resource=account&app=codex").unwrap();
    let query = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<BTreeMap<_, _>>();
    assert_ne!(query.get("resource").map(String::as_str), Some("provider"));
}

#[test]
fn parses_confirmation_details_before_saving() {
    let url = Url::parse(concat!(
        "cswitch://v1/import?resource=provider&app=codex&name=Relay",
        "&endpoint=https%3A%2F%2Frelay.example.com%2Fv1",
        "&apiKey=secret&model=gpt-custom",
    ))
    .unwrap();

    let pending = parse_import(&url).unwrap();
    let details = pending.details();

    assert_eq!(details.name, "Relay");
    assert_eq!(details.endpoint, "https://relay.example.com/v1");
    assert_eq!(details.model, "gpt-custom");
    assert!(details.api_key_provided);
}

#[test]
fn maps_sub2api_and_newapi_platforms() {
    assert_eq!(
        parse_balance_platform("sub2api"),
        Some(ProviderBalancePlatform::Sub2Api)
    );
    assert_eq!(
        parse_balance_platform("new-api"),
        Some(ProviderBalancePlatform::NewApi)
    );
}

#[test]
fn imports_codex_links_as_relay_providers() {
    let (kind, api_format, controlled_by_codex) = provider_kind("codex").unwrap();

    assert_eq!(kind, ProviderKind::Custom);
    assert_eq!(api_format, ProviderApiFormat::OpenaiResponses);
    assert!(controlled_by_codex);
    assert_eq!(
        import_model("codex", String::new()).unwrap(),
        providers::DEFAULT_OFFICIAL_MODEL
    );
}

#[test]
fn imported_compatible_providers_default_to_codex_model_control() {
    for app in ["claude", "gemini", "grokbuild"] {
        let (_, api_format, controlled_by_codex) = provider_kind(app).unwrap();

        assert_eq!(api_format, ProviderApiFormat::OpenaiChat);
        assert!(controlled_by_codex);
    }
}

#[test]
fn imported_relay_prefers_its_requested_model() {
    let models = resolve_import_models(
        "gpt-requested".to_string(),
        Ok(vec!["gpt-first".to_string(), "gpt-requested".to_string()]),
    );

    assert_eq!(models.selected, "gpt-requested");
    assert_eq!(models.available, vec!["gpt-first", "gpt-requested"]);
}

#[test]
fn imported_relay_selects_the_first_fetched_model_when_needed() {
    let models = resolve_import_models(
        providers::DEFAULT_OFFICIAL_MODEL.to_string(),
        Ok(vec![
            "relay-model-a".to_string(),
            "relay-model-b".to_string(),
        ]),
    );

    assert_eq!(models.selected, "relay-model-a");
    assert_eq!(models.available, vec!["relay-model-a", "relay-model-b"]);
}

#[test]
fn imported_relay_keeps_a_default_when_model_discovery_fails() {
    let models = resolve_import_models(
        providers::DEFAULT_OFFICIAL_MODEL.to_string(),
        Err("unavailable".to_string()),
    );

    assert_eq!(models.selected, providers::DEFAULT_OFFICIAL_MODEL);
    assert_eq!(models.available, vec![providers::DEFAULT_OFFICIAL_MODEL]);
}

#[test]
fn supplies_sub2api_balance_defaults_for_compatible_links() {
    let query = Url::parse(
        "cswitch://v1/import?balancePlatform=sub2api&endpoint=https%3A%2F%2Frelay.example.com%2Fv1",
    )
    .unwrap()
    .query_pairs()
    .map(|(key, value)| (key.into_owned(), value.into_owned()))
    .collect::<BTreeMap<_, _>>();

    let settings = import_balance_settings(&query, &query["endpoint"]).unwrap();

    assert_eq!(settings.platform, Some(ProviderBalancePlatform::Sub2Api));
    assert_eq!(
        settings.query_url.as_deref(),
        Some("https://relay.example.com/v1/usage")
    );
    assert!(settings.uses_api_key);
}

#[test]
fn supplies_new_api_balance_defaults_for_nested_endpoints() {
    let query = BTreeMap::from([("platform".to_string(), "new-api".to_string())]);
    let settings = import_balance_settings(&query, "https://relay.example.com/codex/v1/").unwrap();

    assert_eq!(settings.platform, Some(ProviderBalancePlatform::NewApi));
    assert_eq!(
        settings.query_url.as_deref(),
        Some("https://relay.example.com/codex/api/usage/token/")
    );
    assert!(settings.uses_api_key);
}

#[test]
fn adds_a_number_when_an_imported_provider_name_already_exists() {
    let existing = vec![
        "Relay".to_string(),
        "Relay (2)".to_string(),
        "Other".to_string(),
    ];

    assert_eq!(unique_provider_name("Relay", &existing), "Relay (3)");
    assert_eq!(unique_provider_name("New Relay", &existing), "New Relay");
}

#[test]
fn provider_name_collision_is_case_insensitive() {
    let existing = vec!["relay".to_string()];

    assert_eq!(unique_provider_name("Relay", &existing), "Relay (2)");
}

#[test]
fn duplicate_suffix_keeps_provider_name_within_the_limit() {
    let requested = "中".repeat(MAX_PROVIDER_NAME_LENGTH);
    let existing = vec![requested.clone()];
    let unique = unique_provider_name(&requested, &existing);

    assert_eq!(unique.chars().count(), MAX_PROVIDER_NAME_LENGTH);
    assert!(unique.ends_with(" (2)"));
}
