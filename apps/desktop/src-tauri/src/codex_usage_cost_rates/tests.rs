use super::*;
use serde_json::json;

#[test]
fn only_fast_usage_gets_the_default_cost_multiplier() {
    let rates: CostRates = serde_json::from_value(json!({})).unwrap();
    assert_eq!(rates.fast_mode_multiplier, 2.5);
    for (tier, expected) in [
        (None, 5.28),
        (Some("default"), 5.28),
        (Some("flex"), 5.28),
        (Some("priority"), 13.2),
        (Some("fast"), 13.2),
    ] {
        let mut entry = usage_entry("gpt-5.6-sol");
        entry.service_tier = tier.map(str::to_string);
        assert!((rates.estimate_cost(&entry, None) - expected).abs() < 1e-10);
    }
}

#[test]
fn custom_multiplier_applies_after_every_price_source() {
    let rates: CostRates = serde_json::from_value(json!({
        "fastModeMultiplier": 3.0,
        "referenceModel": "gpt-5.6-terra",
        "customRules": [{"providerId": "relay", "model": "custom-rule",
            "input": 2.0, "cachedInput": 0.5, "output": 3.0}],
        "modelTokenCosts": {"relay": {"flat-price": 2.0, "free": 0.0}}
    }))
    .unwrap();
    let provider = provider(ProviderKind::Custom);
    for (model, base) in [
        ("custom-rule", 2.0),
        ("flat-price", 2.2),
        ("gpt-5.6-sol", 5.28),
        ("private-model", 2.84),
        ("free", 0.0),
    ] {
        let mut entry = usage_entry(model);
        entry.service_tier = Some("priority".to_string());
        assert!((rates.estimate_cost(&entry, Some(&provider)) - base * 3.0).abs() < 1e-10);
    }
}

#[test]
fn invalid_fast_mode_multipliers_are_rejected() {
    let mut rates = CostRates::default();
    for invalid in [
        0.0,
        -1.0,
        f64::NAN,
        f64::INFINITY,
        PRESET_CATALOG.max_fast_mode_cost_multiplier + 1.0,
    ] {
        rates.fast_mode_multiplier = invalid;
        assert!(rates.validate().is_err());
    }
    for valid in [0.1, 1.0, 2.5, PRESET_CATALOG.max_fast_mode_cost_multiplier] {
        rates.fast_mode_multiplier = valid;
        assert!(rates.validate().is_ok());
    }
}

fn usage_entry(model: &str) -> TokenUsageEntry {
    serde_json::from_value(json!({
        "id": "entry", "ts": 0, "provider": "Relay", "providerId": "relay",
        "model": model, "inputTokens": 1_000_000, "cachedTokens": 200_000,
        "outputTokens": 100_000,
    }))
    .unwrap()
}

fn provider(kind: ProviderKind) -> ProviderProfile {
    serde_json::from_value(json!({
        "id": "relay", "name": "Relay", "kind": kind, "baseUrl": "https://example.com",
        "apiKey": "", "model": "gpt-5.6-sol", "apiFormat": "openaiResponses",
    }))
    .unwrap()
}

#[test]
fn custom_providers_use_exact_model_prices_before_official_presets() {
    let rates: CostRates = serde_json::from_value(json!({
        "modelTokenCosts": { "relay": { "gpt-5.6-sol": 2.0 } },
    }))
    .unwrap();
    let provider = provider(ProviderKind::Custom);
    assert_eq!(
        rates.estimate_cost(&usage_entry("gpt-5.6-sol"), Some(&provider)),
        2.2
    );
    assert_eq!(
        rates.estimate_cost(&usage_entry("gpt-5.6-sol-dated"), Some(&provider)),
        5.28
    );
}

#[test]
fn custom_rules_override_model_prices_and_match_versioned_names() {
    let rates: CostRates = serde_json::from_value(json!({
        "customRules": [{ "providerId": "relay", "model": "GPT-5.6-SOL",
            "input": 3.0, "cachedInput": 0.5, "output": 20.0 }],
        "modelTokenCosts": { "relay": { "gpt-5.6-sol": 2.0 } },
    }))
    .unwrap();
    let provider = provider(ProviderKind::Custom);
    assert_eq!(
        rates.estimate_cost(&usage_entry("gpt-5.6-sol"), Some(&provider)),
        4.5
    );
    assert_eq!(
        rates.estimate_cost(&usage_entry("gpt-5.6-sol-dated"), None),
        4.5
    );
}

#[test]
fn specific_model_rule_wins_over_an_earlier_prefix_rule() {
    let rates: CostRates = serde_json::from_value(json!({
        "customRules": [
            { "providerId": "relay", "model": "gpt-5.6-sol",
              "input": 2.0, "cachedInput": 0.5, "output": 3.0 },
            { "providerId": "relay", "model": "gpt-5.6-sol-dated",
              "input": 9.0, "cachedInput": 1.0, "output": 13.0 }
        ]
    }))
    .unwrap();
    let cost = rates.estimate_cost(&usage_entry("gpt-5.6-sol-dated"), None);
    assert!((cost - 8.7).abs() < 1e-10);
}

#[test]
fn official_providers_ignore_flat_api_prices_and_keep_the_model_preset() {
    let provider = provider(ProviderKind::OpenAi);
    let entry = usage_entry("gpt-5.6-sol");
    let rates: CostRates = serde_json::from_value(json!({
        "modelTokenCosts": { "relay": { "gpt-5.6-sol": 2.0 } },
    }))
    .unwrap();
    assert_eq!(rates.estimate_cost(&entry, Some(&provider)), 5.28,);
}

#[test]
fn cached_tokens_are_clamped_and_reasoning_is_not_charged_twice() {
    let mut entry = usage_entry("private-model");
    entry.cached_tokens = Some(2_000_000);
    entry.reasoning_tokens = Some(100_000);
    assert_eq!(CostRates::default().estimate_cost(&entry, None), 2.4);
}

#[test]
fn rejects_invalid_rates_but_allows_zero_cost() {
    let mut rates = CostRates::default();
    rates
        .model_token_costs
        .insert("relay".into(), BTreeMap::from([("model".into(), 0.0)]));
    assert!(rates.validate().is_ok());
    for invalid in [f64::NAN, f64::INFINITY, -1.0, MAX_TOKEN_RATE + 1.0] {
        rates
            .model_token_costs
            .get_mut("relay")
            .unwrap()
            .insert("model".into(), invalid);
        assert!(rates.validate().is_err());
    }
}

#[test]
fn bundled_catalog_declares_a_priced_default_and_valid_presets() {
    assert_eq!(PRESET_CATALOG.default_reference_model, "gpt-5.6-sol");
    assert!(CostRates::default().validate().is_ok());
    for preset in &PRESET_CATALOG.models {
        assert!(valid_identifier(&preset.model));
        assert!([
            preset.rate.input,
            preset.rate.cached_input,
            preset.rate.output
        ]
        .into_iter()
        .all(valid_rate));
    }
    let rate = PRESET_CATALOG.default_rate();
    assert_eq!(
        (rate.input, rate.cached_input, rate.output),
        (4.0, 0.4, 20.0)
    );
}

#[test]
fn reference_changes_unknown_models_but_preserves_configured_model_presets() {
    let rates: CostRates = serde_json::from_value(json!({
        "referenceModel": "gpt-5.6-luna",
    }))
    .unwrap();
    let provider = provider(ProviderKind::Custom);
    for model in ["private-model", "", "gpt-4o", "gpt-5.6-private-model"] {
        assert!((rates.estimate_cost(&usage_entry(model), Some(&provider)) - 0.284).abs() < 1e-10);
    }
    assert_eq!(
        rates.estimate_cost(&usage_entry("gpt-5.6-sol"), Some(&provider)),
        5.28
    );
    assert_eq!(
        rates.estimate_cost(&usage_entry("gpt-5.6"), Some(&provider)),
        5.28
    );
    assert_eq!(
        CostRates::default().estimate_cost(&usage_entry("private-model"), None),
        5.28
    );
}

#[test]
fn spark_has_no_preset_and_uses_the_selected_reference() {
    let rates: CostRates = serde_json::from_value(json!({
        "referenceModel": "gpt-6-astra",
    }))
    .unwrap();
    for model in ["gpt-5.3-codex-spark", "gpt-5.6-spark", "gpt-5-spark"] {
        assert!(PRESET_CATALOG.rate_for_model(model).is_none());
        assert_eq!(rates.estimate_cost(&usage_entry(model), None), 13.2);
    }
}

#[test]
fn model_presets_match_versioned_names_and_choose_the_longest_name() {
    let catalog: CostPresetCatalog = serde_json::from_value(json!({
        "defaultReferenceModel": "model",
        "defaultFastModeCostMultiplier": 2.5,
        "maxFastModeCostMultiplier": 100,
        "models": [
            {"model": "model", "input": 1.0, "cachedInput": 1.0, "output": 1.0},
            {"model": "model-mini", "input": 2.0, "cachedInput": 2.0, "output": 2.0},
        ],
    }))
    .unwrap();
    assert_eq!(
        catalog
            .rate_for_model("MODEL-mini-2026-09-01")
            .unwrap()
            .input,
        2.0
    );
    let rate = PRESET_CATALOG
        .rate_for_model("gpt-5.6-terra-2026-09-01")
        .unwrap();
    assert_eq!(
        (rate.input, rate.cached_input, rate.output),
        (2.0, 0.2, 12.0)
    );
}

#[test]
fn reference_settings_accept_only_priced_catalog_models() {
    let old_settings: CostRates = serde_json::from_value(json!({})).unwrap();
    assert_eq!(old_settings.reference_model, "gpt-5.6-sol");
    for model in ["", "gpt-5.3-codex-spark", "gpt-5.6-sol-dated"] {
        let rates = CostRates {
            reference_model: model.to_string(),
            ..CostRates::default()
        };
        assert!(rates.validate().is_err());
    }
    let rates = CostRates {
        reference_model: "gpt-5.6-terra".to_string(),
        ..CostRates::default()
    };
    assert!(rates.validate().is_ok());
}
