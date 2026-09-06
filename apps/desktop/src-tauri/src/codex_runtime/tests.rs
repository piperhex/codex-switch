use super::*;

#[test]
fn upstream_failure_resets_picker_without_injecting_a_single_model() {
    let request = upstream_model_refresh_reset("gpt-5.6-sol".to_string());

    assert!(request.models.is_empty());
    assert!(request.fast_mode_models.is_empty());
    assert!(request.image_input_models.is_empty());
    assert!(request.model_reasoning_efforts.is_empty());
    assert_eq!(request.selected_model, "gpt-5.6-sol");
}

#[test]
fn official_catalog_preserves_models_capabilities_and_reasoning() {
    let catalog = serde_json::from_value::<OfficialModelsResponse>(serde_json::json!({
        "models": [
            {
                "slug": "gpt-5.6-sol",
                "input_modalities": ["text", "image"],
                "supported_reasoning_levels": [
                    { "effort": "low" },
                    { "effort": "ultra" },
                    { "effort": "ultra" }
                ],
                "additional_speed_tiers": ["fast"],
                "service_tiers": [{ "id": "priority" }]
            },
            {
                "slug": "gpt-reserve",
                "visibility": "hide",
                "input_modalities": ["text", "image"],
                "supported_reasoning_levels": [{ "effort": "max" }],
                "additional_speed_tiers": ["fast"]
            },
            { "slug": "gpt-5.4", "input_modalities": ["text"] },
            { "slug": "gpt-5.6-sol" }
        ]
    }))
    .unwrap();

    let payload = official_model_refresh_payload(catalog, "gpt-5.6-sol".to_string()).unwrap();

    assert_eq!(payload.models, vec!["gpt-5.6-sol", "gpt-5.4"]);
    assert_eq!(payload.image_input_models, vec!["gpt-5.6-sol"]);
    assert_eq!(payload.fast_mode_models, vec!["gpt-5.6-sol"]);
    assert!(!payload.model_reasoning_efforts.contains_key("gpt-reserve"));
    assert_eq!(
        payload.model_reasoning_efforts["gpt-5.6-sol"],
        vec![
            crate::models::ReasoningEffort::Low,
            crate::models::ReasoningEffort::Ultra
        ]
    );
}

#[test]
fn official_catalog_rejects_empty_model_lists() {
    let catalog = OfficialModelsResponse { models: Vec::new() };

    let error = official_model_refresh_payload(catalog, "gpt-5.6-sol".to_string())
        .err()
        .unwrap();

    assert_eq!(error, "Official model catalog is empty");
}

#[test]
fn official_cache_preserves_fast_capabilities_without_login() {
    let cached = serde_json::json!({
        "models": [
            {"slug": "gpt-5.6-sol", "additional_speed_tiers": ["fast"]},
            {"slug": "gpt-6-astra", "service_tiers": [{"id": "priority"}]}
        ]
    });
    let payload = model_refresh_from_value(&cached, "gpt-5.6-sol".to_string()).unwrap();

    assert_eq!(payload.models, vec!["gpt-5.6-sol", "gpt-6-astra"]);
    assert_eq!(payload.fast_mode_models, payload.models);
}
