use super::*;

#[test]
fn account_switch_expires_only_the_cli_model_cache() {
    let root = std::env::temp_dir().join(format!("gui-model-cache-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let config = root.join("config.toml");
    fs::write(&config, "model = 'saved-model'").unwrap();
    fs::write(root.join(MODEL_CACHE_FILE), "{}").unwrap();
    clear_model_cache(&root).unwrap();
    assert!(!root.join(MODEL_CACHE_FILE).exists());
    assert_eq!(
        fs::read_to_string(&config).unwrap(),
        "model = 'saved-model'"
    );
    clear_model_cache(&root).unwrap();
    fs::remove_file(config).unwrap();
    fs::remove_dir(root).unwrap();
}

#[test]
fn enables_discovery_on_the_gui_route_and_updates_its_port() {
    let config =
        "model = 'saved-model'\n[features]\napi_key_model_discovery = false\nweb_search = true\n";
    let root = std::env::temp_dir();
    let configured = isolated_config(config, &root, "http://127.0.0.1:54321/codex-gui/v1").unwrap();
    let configured =
        isolated_config(&configured, &root, "http://127.0.0.1:54322/codex-gui/v1/").unwrap();
    let document = configured.parse::<DocumentMut>().unwrap();
    assert_eq!(
        document["features"]["api_key_model_discovery"].as_bool(),
        Some(true)
    );
    assert_eq!(document["features"]["web_search"].as_bool(), Some(true));
    assert_eq!(document["model"].as_str(), Some("saved-model"));
    let provider = &document["model_providers"][GUI_PROVIDER_ID];
    assert_eq!(
        provider["model_catalog_url"].as_str(),
        Some("http://127.0.0.1:54322/codex-gui/v1/models")
    );
    assert_eq!(provider["requires_openai_auth"].as_bool(), Some(false));
}

#[test]
fn discovery_accepts_inline_features_and_rejects_invalid_features() {
    let root = std::env::temp_dir();
    let url = "http://127.0.0.1:54321/codex-gui/v1";
    let config = isolated_config("features = { web_search = true }", &root, url).unwrap();
    let document = config.parse::<DocumentMut>().unwrap();
    assert_eq!(
        document["features"]["api_key_model_discovery"].as_bool(),
        Some(true)
    );
    assert_eq!(document["features"]["web_search"].as_bool(), Some(true));
    assert!(isolated_config("features = false", &root, url).is_err());
}

#[test]
fn explicit_gui_catalog_survives_reconnect_and_provider_reconfiguration() {
    let config = "model_catalog_json = '/user/custom-models.json'\nmodel = 'saved-model'\n";
    let root = std::env::temp_dir();
    let configured = isolated_config(config, &root, "http://127.0.0.1:54321/codex-gui/v1").unwrap();
    let reconfigured =
        isolated_config(&configured, &root, "http://127.0.0.1:54322/codex-gui/v1").unwrap();
    let document = reconfigured.parse::<DocumentMut>().unwrap();
    assert_eq!(
        document["model_catalog_json"].as_str(),
        Some("/user/custom-models.json")
    );
    assert_eq!(document["model"].as_str(), Some("saved-model"));
}

#[test]
fn initial_import_excludes_shared_catalog_but_preserves_later_gui_override() {
    let root = std::env::temp_dir().join(format!("codex-gui-catalog-{}", uuid::Uuid::new_v4()));
    let source = root.join("shared");
    let target = root.join("gui");
    fs::create_dir_all(&source).unwrap();
    fs::write(
        source.join("config.toml"),
        "model_catalog_json = 'shared-models.json'\n",
    )
    .unwrap();
    let url = "http://127.0.0.1:54321/codex-gui/v1";
    prepare_from(&source, &target, url).unwrap();
    let config = fs::read_to_string(target.join("config.toml")).unwrap();
    assert!(!config
        .parse::<DocumentMut>()
        .unwrap()
        .contains_key("model_catalog_json"));
    fs::write(
        target.join("config.toml"),
        format!("model_catalog_json = 'gui-models.json'\n{config}"),
    )
    .unwrap();
    prepare_from(&source, &target, url).unwrap();
    let config = fs::read_to_string(target.join("config.toml")).unwrap();
    assert_eq!(
        config.parse::<DocumentMut>().unwrap()["model_catalog_json"].as_str(),
        Some("gui-models.json")
    );
    assert!(root.starts_with(std::env::temp_dir()));
    fs::remove_dir_all(root).unwrap();
}
