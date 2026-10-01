use super::{models_url, parse_models, preset_spec, PresetProviderId};
use serde_json::json;

#[test]
fn gemini_models_use_the_official_openai_compatible_endpoint() {
    let spec = preset_spec(PresetProviderId::Gemini);
    for base_url in [
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "https://generativelanguage.googleapis.com/v1beta/openai/",
    ] {
        assert_eq!(
            models_url(spec, base_url).unwrap().as_str(),
            "https://generativelanguage.googleapis.com/v1beta/openai/models"
        );
    }
}

#[test]
fn gemini_model_list_accepts_google_resource_ids() {
    let payload = json!({"data": [
        {"id": "models/gemini-2.5-pro"},
        {"id": "models/gemini-2.5-flash"},
        {"id": "models/gemini-embedding-001"},
        {"id": "models/imagen-4.0-generate-001"}
    ]});

    assert_eq!(
        parse_models(preset_spec(PresetProviderId::Gemini), &payload).unwrap(),
        vec!["gemini-2.5-pro", "gemini-2.5-flash"]
    );
}

#[test]
fn gemini_model_list_deduplicates_resource_and_bare_ids() {
    let payload = json!({"data": [
        {"id": " models/gemini-2.5-pro "},
        {"id": "gemini-2.5-pro"},
        {"id": "gemini-2.5-flash"},
        {"id": "models/gemini-2.5-flash"},
        {"id": "gemini-embedding-001"},
        {"id": "models/"},
        {"id": ""},
        {"id": null},
        {}
    ]});

    assert_eq!(
        parse_models(preset_spec(PresetProviderId::Gemini), &payload).unwrap(),
        vec!["gemini-2.5-pro", "gemini-2.5-flash"]
    );
}

#[test]
fn other_presets_preserve_model_namespaces() {
    let payload = json!({"data": [
        {"id": "models/custom-chat"},
        {"id": "google/gemini-2.5-pro"}
    ]});

    assert_eq!(
        parse_models(preset_spec(PresetProviderId::OpenRouter), &payload).unwrap(),
        vec!["models/custom-chat", "google/gemini-2.5-pro"]
    );
}

#[test]
fn gemini_model_list_rejects_empty_or_unsupported_results() {
    let spec = preset_spec(PresetProviderId::Gemini);
    for payload in [
        json!({"data": []}),
        json!({"data": [{"id": "models/gemini-embedding-001"}]}),
        json!({"data": [{"id": "models/imagen-4.0-generate-001"}]}),
        json!({"error": {"code": 403}}),
    ] {
        assert!(parse_models(spec, &payload).is_err());
    }
}
