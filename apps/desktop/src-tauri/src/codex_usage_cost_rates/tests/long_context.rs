use super::*;

#[test]
fn older_settings_default_to_official_long_context_pricing() {
    let rates: CostRates = serde_json::from_value(json!({"fastModeMultiplier": 3.0})).unwrap();
    let settings = rates.long_context;
    assert!(settings.enabled);
    assert_eq!(settings.threshold_tokens, 272_000);
    assert_eq!(settings.input_multiplier, 2.0);
    assert_eq!(settings.cached_input_multiplier, 2.0);
    assert_eq!(settings.output_multiplier, 1.5);
    assert!(rates.validate().is_ok());
}

#[test]
fn strict_input_boundary_changes_the_entire_request_rate() {
    let rates = CostRates::default();
    let mut entry = usage_entry("gpt-5.6-sol");
    for (input, expected) in [(271_999, 2.367996), (272_000, 2.368), (272_001, 3.736008)] {
        entry.input_tokens = Some(input);
        assert!((rates.estimate_cost(&entry, None) - expected).abs() < 1e-10);
    }
}

#[test]
fn cached_input_counts_toward_the_boundary_once() {
    let rates = CostRates::default();
    let mut entry = usage_entry("gpt-5.6-sol");
    entry.input_tokens = Some(272_001);
    entry.cached_tokens = Some(272_001);
    assert!((rates.estimate_cost(&entry, None) - 3.2176008).abs() < 1e-10);
    entry.input_tokens = Some(200_000);
    entry.cached_tokens = Some(200_000);
    assert_eq!(rates.estimate_cost(&entry, None), 2.08);
}

#[test]
fn output_totals_and_context_capacity_do_not_trigger_long_context() {
    let mut entry = usage_entry("gpt-5.6-sol");
    entry.input_tokens = Some(1);
    entry.cached_tokens = Some(0);
    entry.output_tokens = Some(1_000_000);
    entry.total_tokens = Some(1_000_001);
    entry.model_context_window = Some(1_000_000);
    assert!((CostRates::default().estimate_cost(&entry, None) - 20.000004).abs() < 1e-10);
    entry.input_tokens = None;
    entry.cached_tokens = Some(1_000_000);
    assert_eq!(CostRates::default().estimate_cost(&entry, None), 20.0);
}

#[test]
fn separate_custom_multipliers_stack_with_fast_mode() {
    let mut rates = CostRates {
        long_context: LongContextCostSettings {
            enabled: true,
            threshold_tokens: 500_000,
            input_multiplier: 2.0,
            cached_input_multiplier: 3.0,
            output_multiplier: 4.0,
        },
        ..CostRates::default()
    };
    let mut entry = usage_entry("gpt-5.6-sol");
    assert!((rates.estimate_cost(&entry, None) - 14.64).abs() < 1e-10);
    entry.service_tier = Some("priority".to_string());
    assert!((rates.estimate_cost(&entry, None) - 36.6).abs() < 1e-10);
    rates.long_context.enabled = false;
    assert!((rates.estimate_cost(&entry, None) - 13.2).abs() < 1e-10);
    rates.long_context.enabled = true;
    rates.long_context.threshold_tokens = 1_000_000;
    assert!((rates.estimate_cost(&entry, None) - 13.2).abs() < 1e-10);
}

#[test]
fn preset_eligibility_preserves_mini_prices_and_versioned_names() {
    let rates = CostRates {
        reference_model: "gpt-5.4-mini".to_string(),
        ..CostRates::default()
    };
    for preset in &PRESET_CATALOG.models {
        let entry = usage_entry(&format!("{}-dated", preset.model));
        let base = preset.rate.estimate(&entry);
        let cost = rates.estimate_cost(&entry, None);
        if preset.model == "gpt-5.4-mini" {
            assert!(!preset.long_context_pricing);
            assert_eq!(cost, base);
        } else {
            assert!(preset.long_context_pricing);
            assert!(cost > base);
        }
    }
    assert_eq!(rates.estimate_cost(&usage_entry("gpt-5.6"), None), 9.56);
}

#[test]
fn custom_prices_keep_model_or_reference_long_context_eligibility() {
    let mut rates: CostRates = serde_json::from_value(json!({
        "customRules": [
            {"providerId": "relay", "model": "gpt-5.4-mini", "input": 2, "cachedInput": 2, "output": 2},
            {"providerId": "relay", "model": "gpt-5.6-sol", "input": 2, "cachedInput": 2, "output": 2},
            {"providerId": "relay", "model": "private-model", "input": 2, "cachedInput": 2, "output": 2}
        ],
        "modelTokenCosts": {"relay": {"private-flat": 2.0}}
    })).unwrap();
    let provider = provider(ProviderKind::Custom);
    for reference in ["gpt-5.4-mini", "gpt-5.6-sol"] {
        rates.reference_model = reference.to_string();
        for (model, expected) in [("gpt-5.4-mini", 2.2), ("gpt-5.6-sol", 4.3)] {
            assert_eq!(
                rates.estimate_cost(&usage_entry(model), Some(&provider)),
                expected
            );
        }
        let expected = if reference == "gpt-5.4-mini" {
            2.2
        } else {
            4.3
        };
        for model in ["private-model", "private-flat"] {
            assert_eq!(
                rates.estimate_cost(&usage_entry(model), Some(&provider)),
                expected
            );
        }
    }
}

#[test]
fn invalid_long_context_thresholds_and_field_types_are_rejected() {
    let mut rates = CostRates::default();
    for threshold in [0, PRESET_CATALOG.max_long_context_threshold_tokens + 1] {
        rates.long_context.threshold_tokens = threshold;
        assert!(rates.validate().is_err());
    }
    for threshold in [1, PRESET_CATALOG.max_long_context_threshold_tokens] {
        rates.long_context.threshold_tokens = threshold;
        assert!(rates.validate().is_ok());
    }
    let mut settings = serde_json::to_value(CostRates::default()).unwrap();
    for invalid in [json!(-1), json!(272_000.5), json!("272000"), json!(null)] {
        settings["longContext"]["thresholdTokens"] = invalid;
        assert!(serde_json::from_value::<CostRates>(settings.clone()).is_err());
    }
    settings["longContext"]["thresholdTokens"] = json!(272_000);
    settings["longContext"]["enabled"] = json!(1);
    assert!(serde_json::from_value::<CostRates>(settings).is_err());
}

#[test]
fn each_long_context_multiplier_is_validated_even_when_disabled() {
    for field in 0..3 {
        for invalid in [0.0, -1.0, f64::NAN, f64::INFINITY, 101.0] {
            let mut rates = CostRates::default();
            rates.long_context.enabled = false;
            let multipliers = [
                &mut rates.long_context.input_multiplier,
                &mut rates.long_context.cached_input_multiplier,
                &mut rates.long_context.output_multiplier,
            ];
            *multipliers[field] = invalid;
            assert!(rates.validate().is_err());
        }
    }
    let mut rates = CostRates::default();
    rates.long_context.input_multiplier = 0.1;
    rates.long_context.cached_input_multiplier = PRESET_CATALOG.max_long_context_cost_multiplier;
    assert!(rates.validate().is_ok());
}

#[test]
fn long_context_settings_persist_and_old_files_load_defaults() {
    let root = std::env::temp_dir().join(format!(
        "codex-switch-long-context-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir(&root).unwrap();
    let paths = Paths {
        current_auth: root.join("auth.json"),
        current_config: root.join("config.toml"),
        codex_home: root.clone(),
        accounts: root.join("accounts"),
        providers: root.join("providers"),
        config_backup: root.join("config-backup.toml"),
        state_file: root.join("state.json"),
    };
    fs::write(rates_path(&paths), "{}").unwrap();
    let mut rates = read_rates(&paths).unwrap();
    assert_eq!(rates.long_context.threshold_tokens, 272_000);
    rates.long_context.threshold_tokens = 300_000;
    rates.long_context.cached_input_multiplier = 3.0;
    assert!(persist(&paths, &rates).unwrap());
    assert!(!persist(&paths, &rates).unwrap());
    let saved = read_rates(&paths).unwrap();
    assert_eq!(
        serde_json::to_value(saved).unwrap(),
        serde_json::to_value(rates).unwrap()
    );
    fs::remove_file(rates_path(&paths)).unwrap();
    fs::remove_dir(root).unwrap();
}
