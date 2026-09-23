use super::*;

#[test]
fn official_prices_and_fast_multipliers_match_new_models() {
    let rates = CostRates::default();
    for (model, standard, multiplier) in [
        ("gpt-5.3-codex", 2.835, 2.0),
        ("gpt-5.6-cyber", 17.75, 1.0),
        ("gpt-6-sol", 4.78, 2.0),
        ("gpt-6-luna", 0.239, 2.0),
        ("gpt-5.5", 12.7, 2.5),
    ] {
        let mut entry = usage_entry(model);
        assert!(
            (rates.estimate_cost(&entry, None) - standard).abs() < 1e-10,
            "{model}"
        );
        entry.service_tier = Some("fast".into());
        assert!(
            (rates.estimate_cost(&entry, None) - standard * multiplier).abs() < 1e-10,
            "{model}"
        );
    }
}

#[test]
fn model_override_and_reset_preserve_legacy_global_settings() {
    let rates: CostRates = serde_json::from_value(json!({
        "fastModeMultiplier": 3,
        "modelFastModeMultipliers": {"gpt-6-sol": 4, "gpt-6-luna": null}
    }))
    .unwrap();
    for (model, multiplier) in [
        ("GPT-6-SOL-2026-09-23", 4.0),
        ("gpt-6-luna", 2.0),
        ("gpt-5.5", 3.0),
    ] {
        assert_eq!(rates.fast_multiplier_for_model(model), multiplier);
    }
}

#[test]
fn downloaded_prices_reach_native_summaries_and_keep_custom_rule_priority() {
    let mut catalog = serde_json::to_value(&*PRESET_CATALOG).unwrap();
    catalog["models"].as_array_mut().unwrap().push(json!({
        "model": "new-model", "input": 3, "cachedInput": 0.3, "output": 15,
        "fastModeMultiplier": 4, "longContextPricing": false, "sourceUrl": ""
    }));
    let mut rates: CostRates = serde_json::from_value(json!({
        "presetCatalog": catalog, "referenceModel": "new-model"
    }))
    .unwrap();
    assert!(rates.validate().is_ok());
    let mut entry = usage_entry("new-model");
    entry.service_tier = Some("fast".into());
    assert!((rates.estimate_cost(&entry, None) - 15.84).abs() < 1e-10);
    rates.custom_rules.push(CustomCostRule {
        provider_id: "relay".into(),
        model: "new-model".into(),
        rate: CostRate::new(0.0, 0.0, 0.0),
    });
    assert_eq!(rates.estimate_cost(&entry, None), 0.0);
}

#[test]
fn invalid_downloaded_prices_and_multipliers_are_rejected() {
    for bad in [-1.0, 101.0] {
        let mut catalog = (*PRESET_CATALOG).clone();
        catalog.models[0].fast_mode_multiplier = Some(bad);
        let rates = CostRates {
            preset_catalog: Some(catalog),
            ..CostRates::default()
        };
        assert!(rates.validate().is_err());
    }
    let rates: CostRates =
        serde_json::from_value(json!({"modelFastModeMultipliers": {"gpt-6-sol": 0}})).unwrap();
    assert!(rates.validate().is_err());
    let mut catalog = (*PRESET_CATALOG).clone();
    let duplicate = catalog.models[1].model.clone();
    catalog.models[0].aliases.push(duplicate);
    assert!(!catalog.is_valid());
}

#[test]
fn spark_dated_names_do_not_inherit_codex_prices() {
    assert!(PRESET_CATALOG
        .rate_for_model("GPT-5.3-CODEX-SPARK-2026-09-23")
        .is_none());
    assert_eq!(
        PRESET_CATALOG
            .rate_for_model("gpt-daybreak-red-latest")
            .unwrap()
            .input,
        12.5
    );
    assert_eq!(
        PRESET_CATALOG
            .rate_for_model("gpt-daybreak-blue-latest")
            .unwrap()
            .input,
        4.0
    );
}
