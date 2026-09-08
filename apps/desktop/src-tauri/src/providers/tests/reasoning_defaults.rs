#[test]
fn saved_custom_reasoning_survives_normalization_and_catalog_refresh() {
    let models = vec!["glm-5.3".to_string(), "deepseek-v4-pro-0813".to_string()];
    let custom = vec![ReasoningEffort::None, ReasoningEffort::Ultra];
    let configured = [(models[0].clone(), custom.clone())].into();
    let normalized = normalize_model_reasoning_efforts(&models, configured);
    let saved = serde_json::to_string(&normalized).unwrap();
    let restored =
        normalize_model_reasoning_efforts(&models, serde_json::from_str(&saved).unwrap());
    assert_eq!(restored[&models[0]], custom);
    assert_eq!(
        restored[&models[1]],
        vec![
            ReasoningEffort::None,
            ReasoningEffort::Low,
            ReasoningEffort::High,
            ReasoningEffort::Max
        ]
    );
    let levels = supported_reasoning_levels_for_model(
        &models[0],
        ReasoningEffortProfile::Standard,
        &restored,
    );
    assert_eq!(levels[0]["effort"], "none");
    assert_eq!(levels[1]["effort"], "ultra");
    assert_eq!(levels.as_array().unwrap().len(), 2);
}

#[test]
fn catalog_and_switch_controlled_refresh_use_known_model_defaults() {
    let mut custom = provider();
    custom.model = "qwen3.8-max".to_string();
    custom.models = vec![custom.model.clone()];
    custom.model_selection_controlled_by_codex = false;
    let custom = normalize_provider_profile(custom).unwrap();
    let configured = codex_model_reasoning_efforts(&custom);
    let levels = supported_reasoning_levels_for_model(
        CODEX_SWITCH_CONTROL_MODEL,
        ReasoningEffortProfile::Standard,
        &configured,
    );
    assert_eq!(levels[3]["effort"], "xhigh");
    assert_eq!(default_reasoning_level(&levels), "xhigh");
    let unconfigured = supported_reasoning_levels_for_model(
        "glm-5.3",
        ReasoningEffortProfile::Standard,
        &ModelReasoningEfforts::new(),
    );
    assert_eq!(unconfigured[0]["effort"], "low");
    assert_eq!(unconfigured[2]["effort"], "max");
    assert_eq!(unconfigured.as_array().unwrap().len(), 3);
    assert_eq!(default_reasoning_level(&unconfigured), "high");
}

#[test]
fn catalog_default_stays_within_the_users_custom_reasoning_selection() {
    let levels = json!([{ "effort": "low" }]);
    let catalog = provider_model_catalog_entry("custom", 0, 256_000, levels, false, false);
    assert_eq!(catalog["default_reasoning_level"], "low");
}

#[test]
fn public_gpt_defaults_do_not_remove_provider_specific_customizations() {
    let models = vec!["gpt-5.6-sol".to_string(), "gpt-oss:20b".to_string()];
    let custom = vec![ReasoningEffort::High, ReasoningEffort::Ultra];
    let configured = [(models[0].clone(), custom.clone())].into();
    let normalized = normalize_model_reasoning_efforts(&models, configured);
    assert_eq!(normalized[&models[0]], custom);
    assert_eq!(
        normalized[&models[1]],
        vec![
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High
        ]
    );
    assert_eq!(
        known_model_reasoning_efforts("gpt-5.6-sol-openai-compact"),
        None
    );
    assert_eq!(known_model_reasoning_efforts("codex-auto-review"), None);
}
