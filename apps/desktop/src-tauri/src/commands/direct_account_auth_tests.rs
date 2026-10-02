#[test]
fn ordinary_account_switch_only_replaces_auth_in_codex_home() {
    let paths = test_paths();
    fs::create_dir_all(&paths.codex_home).unwrap();
    fs::create_dir_all(paths.config_backup.parent().unwrap()).unwrap();
    let config = b"# preserve user settings\nmodel = 'custom'\n";
    let backup = b"model = 'previous'\n";
    let conversations = paths.codex_home.join("state_5.sqlite");
    fs::write(&paths.current_config, config).unwrap();
    fs::write(&paths.config_backup, backup).unwrap();
    fs::write(&conversations, b"untouched conversations").unwrap();
    let auth = json!({"tokens": {"access_token": "test-only"}});

    super::write_direct_account_auth(&paths, &auth, false).unwrap();

    assert_eq!(read_json(&paths.current_auth).unwrap(), auth);
    assert_eq!(fs::read(&paths.current_config).unwrap(), config);
    assert_eq!(fs::read(&paths.config_backup).unwrap(), backup);
    assert_eq!(fs::read(&conversations).unwrap(), b"untouched conversations");
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}

#[test]
fn ordinary_account_switch_does_not_create_config() {
    let paths = test_paths();
    let auth = json!({"tokens": {"access_token": "test-only"}});
    super::write_direct_account_auth(&paths, &auth, false).unwrap();
    assert_eq!(read_json(&paths.current_auth).unwrap(), auth);
    assert!(!paths.current_config.exists());
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}
