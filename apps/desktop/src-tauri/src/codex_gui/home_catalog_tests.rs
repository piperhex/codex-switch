use super::*;

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
