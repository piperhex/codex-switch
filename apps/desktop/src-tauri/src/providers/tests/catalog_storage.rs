fn customized_catalog(provider: &ProviderProfile) -> Value {
    let mut catalog = model_catalog_for_provider(provider);
    catalog["custom_metadata"] = json!({ "note": "keep me" });
    let model = &mut catalog["models"][0];
    model["apply_patch_tool_type"] = json!("freeform");
    model["shell_type"] = json!("local");
    model["base_instructions"] = json!("My custom instructions");
    model["experimental_supported_tools"] = json!(["custom_tool"]);
    model["custom_capability"] = json!({ "enabled": true, "limit": null });
    model["supports_parallel_tool_calls"] = json!(true);
    catalog
}

fn assert_custom_catalog_fields(model: &Value) {
    assert_eq!(model["apply_patch_tool_type"], "freeform");
    assert_eq!(model["shell_type"], "local");
    assert_eq!(model["base_instructions"], "My custom instructions");
    assert_eq!(
        model["experimental_supported_tools"],
        json!(["custom_tool"])
    );
    assert_eq!(
        model["custom_capability"],
        json!({ "enabled": true, "limit": null })
    );
    assert_eq!(model["supports_parallel_tool_calls"], true);
}

#[test]
fn catalog_write_preserves_custom_fields_and_updates_managed_capabilities() {
    let paths = test_paths();
    let mut provider = provider();
    provider.model_selection_controlled_by_codex = true;
    let path = paths.codex_home.join(MODEL_CATALOG_FILENAME);
    write_json_atomic(&path, &customized_catalog(&provider)).unwrap();
    provider.models.insert(0, "new-model".to_string());
    provider
        .model_context_windows
        .insert("gpt-4.1".to_string(), 400_000);
    provider
        .model_reasoning_efforts
        .insert("gpt-4.1".to_string(), vec![ReasoningEffort::Low]);
    provider.image_input_models.push("gpt-4.1".to_string());
    provider.fast_mode_enabled = true;

    write_provider_model_catalog(&paths, &provider).unwrap();

    let catalog = read_json(&path).unwrap();
    let model = &catalog["models"][1];
    assert_custom_catalog_fields(model);
    assert_eq!(catalog["custom_metadata"], json!({ "note": "keep me" }));
    assert_eq!(catalog["models"][0]["slug"], "new-model");
    assert_eq!(catalog["models"][0]["apply_patch_tool_type"], Value::Null);
    assert_eq!(model["slug"], "gpt-4.1");
    assert_eq!(model["priority"], 1001);
    assert_eq!(model["context_window"], 400_000);
    assert_eq!(model["max_context_window"], 400_000);
    assert_eq!(model["default_reasoning_level"], "low");
    assert_eq!(
        model["supported_reasoning_levels"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(model["input_modalities"], json!(["text", "image"]));
    assert_eq!(model["additional_speed_tiers"], json!(["fast"]));
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}

#[test]
fn catalog_group_switch_restores_custom_fields_without_listing_inactive_models() {
    let paths = test_paths();
    let first = provider();
    let mut second = first.clone();
    second.name = "Other gateway".to_string();
    let path = paths.codex_home.join(MODEL_CATALOG_FILENAME);
    write_provider_group_local_proxy_config(&paths, "first", std::slice::from_ref(&first)).unwrap();
    let mut edited = customized_catalog(&first);
    edited["models"][0]["slug"] = json!(provider_group_model_name(&first, &first.model));
    write_json_atomic(&path, &edited).unwrap();

    write_provider_group_local_proxy_config(&paths, "second", std::slice::from_ref(&second))
        .unwrap();
    let other = read_json(&path).unwrap();
    assert_eq!(other["models"].as_array().unwrap().len(), 1);
    assert_eq!(
        other["models"][0]["slug"],
        provider_group_model_name(&second, &second.model)
    );
    assert_eq!(other["models"][0]["apply_patch_tool_type"], Value::Null);

    write_provider_group_local_proxy_config(&paths, "first", std::slice::from_ref(&first)).unwrap();
    let restored = read_json(&path).unwrap();
    assert_eq!(restored["models"].as_array().unwrap().len(), 1);
    assert_custom_catalog_fields(&restored["models"][0]);
    let bytes = fs::read(&path).unwrap();
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    write_provider_group_local_proxy_config(&paths, "first", &[first]).unwrap();
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), modified);
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}

#[test]
fn catalog_removes_deleted_custom_fields_and_preserves_explicit_nulls() {
    let paths = test_paths();
    let provider = provider();
    let path = paths.codex_home.join(MODEL_CATALOG_FILENAME);
    write_json_atomic(&path, &customized_catalog(&provider)).unwrap();
    write_provider_model_catalog(&paths, &provider).unwrap();
    let mut edited = read_json(&path).unwrap();
    edited["models"][0]
        .as_object_mut()
        .unwrap()
        .remove("custom_capability");
    edited["models"][0]["apply_patch_tool_type"] = Value::Null;
    write_json_atomic(&path, &edited).unwrap();

    write_model_catalog(&paths, json!({ "models": [] })).unwrap();
    write_provider_model_catalog(&paths, &provider).unwrap();

    let restored = read_json(&path).unwrap();
    assert!(restored["models"][0].get("custom_capability").is_none());
    assert_eq!(restored["models"][0]["apply_patch_tool_type"], Value::Null);
    assert_eq!(
        restored["models"][0]["base_instructions"],
        "My custom instructions"
    );
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}

#[test]
fn catalog_invalid_existing_data_is_not_overwritten() {
    let paths = test_paths();
    let path = paths.codex_home.join(MODEL_CATALOG_FILENAME);
    let malformed = [
        "{ broken",
        r#"{"models":{}}"#,
        r#"{"models":[{"slug":""}]}"#,
        r#"{"models":[{"slug":"duplicate"},{"slug":"duplicate"}]}"#,
    ];
    for content in malformed {
        write_text_atomic(&path, content).unwrap();
        assert!(write_provider_model_catalog(&paths, &provider()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}

#[test]
fn catalog_customizations_are_isolated_between_codex_homes() {
    let first = test_paths();
    let second = test_paths();
    let provider = provider();
    let first_path = first.codex_home.join(MODEL_CATALOG_FILENAME);
    write_json_atomic(&first_path, &customized_catalog(&provider)).unwrap();
    write_provider_model_catalog(&first, &provider).unwrap();
    write_provider_model_catalog(&second, &provider).unwrap();
    let second_catalog = read_json(&second.codex_home.join(MODEL_CATALOG_FILENAME)).unwrap();
    assert_eq!(
        second_catalog["models"][0]["apply_patch_tool_type"],
        Value::Null
    );
    assert!(second_catalog.get("custom_metadata").is_none());
    fs::remove_dir_all(first.codex_home.parent().unwrap()).unwrap();
    fs::remove_dir_all(second.codex_home.parent().unwrap()).unwrap();
}

#[test]
fn catalog_invalid_customization_archive_leaves_both_files_untouched() {
    let paths = test_paths();
    let provider = provider();
    let path = paths.codex_home.join(MODEL_CATALOG_FILENAME);
    let archive_path = paths
        .codex_home
        .join("codex-switch-model-customizations.json");
    write_json_atomic(&path, &customized_catalog(&provider)).unwrap();
    let original = fs::read(&path).unwrap();
    for invalid in ["{ broken", r#"{"some-model":null}"#] {
        write_text_atomic(&archive_path, invalid).unwrap();
        assert!(write_provider_model_catalog(&paths, &provider).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::read_to_string(&archive_path).unwrap(), invalid);
    }
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}

#[test]
fn catalog_archived_attributes_cannot_override_managed_fields() {
    let paths = test_paths();
    let mut provider = provider();
    provider.model_selection_controlled_by_codex = true;
    let archive = json!({
        "gpt-4.1": {
            "slug": "wrong-model", "priority": 42, "context_window": 1,
            "visibility": "hide", "base_instructions": "Archived instructions"
        }
    });
    write_json_atomic(
        &paths
            .codex_home
            .join("codex-switch-model-customizations.json"),
        &archive,
    )
    .unwrap();
    write_provider_model_catalog(&paths, &provider).unwrap();
    let catalog = read_json(&paths.codex_home.join(MODEL_CATALOG_FILENAME)).unwrap();
    let model = &catalog["models"][0];
    assert_eq!(model["slug"], "gpt-4.1");
    assert_eq!(model["priority"], 1000);
    assert_eq!(model["context_window"], DEFAULT_MODEL_CONTEXT_WINDOW);
    assert_eq!(model["visibility"], "list");
    assert_eq!(model["base_instructions"], "Archived instructions");
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}
