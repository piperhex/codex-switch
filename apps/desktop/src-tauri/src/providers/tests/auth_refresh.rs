#[test]
fn refreshed_auth_is_preserved_before_managed_auth_is_reapplied() {
    let paths = test_paths();
    let mut auth = test_auth();
    auth["last_refresh"] = Value::String("2026-08-30T01:00:00Z".to_string());
    let (_, _, _, id) = crate::auth::account_fields(&auth).unwrap();
    write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();

    let mut refreshed = auth.clone();
    refreshed["tokens"]["access_token"] = Value::String("refreshed-access-token".to_string());
    refreshed["last_refresh"] = Value::String("2026-08-30T02:00:00Z".to_string());
    write_json_atomic(&paths.current_auth, &refreshed).unwrap();
    crate::auth::canonicalize_chatgpt_auth(&mut refreshed).unwrap();
    write_state(
        &paths,
        &crate::models::ManagerStateFile {
            local_proxy_openai_auth_account_id: Some(id.clone()),
            ..crate::models::ManagerStateFile::default()
        },
    )
    .unwrap();

    sync_local_proxy_openai_auth(&paths).unwrap();

    let managed = read_json(&managed_auth_path(&paths, &id)).unwrap();
    let current = read_json(&paths.current_auth).unwrap();
    assert_eq!(managed["tokens"]["access_token"], "refreshed-access-token");
    assert_eq!(current["tokens"]["access_token"], "refreshed-access-token");
    assert_eq!(managed["tokens"]["refresh_token"], refreshed["tokens"]["refresh_token"]);
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}

#[test]
fn stale_current_auth_does_not_replace_a_new_same_account_login() {
    let paths = test_paths();
    let mut stale = test_auth();
    stale["tokens"]["access_token"] = Value::String("revoked-access-token".to_string());
    let (_, _, _, id) = crate::auth::account_fields(&stale).unwrap();
    write_json_atomic(&paths.current_auth, &stale).unwrap();

    let mut fresh = stale.clone();
    fresh["tokens"]["access_token"] = Value::String("new-login-access-token".to_string());
    fresh["tokens"]["refresh_token"] = Value::String("new-login-refresh-token".to_string());
    fresh["last_refresh"] = Value::String("2026-08-30T02:00:00Z".to_string());
    write_json_atomic(&managed_auth_path(&paths, &id), &fresh).unwrap();
    write_state(
        &paths,
        &crate::models::ManagerStateFile {
            local_proxy_openai_auth_account_id: Some(id.clone()),
            ..crate::models::ManagerStateFile::default()
        },
    )
    .unwrap();

    sync_local_proxy_openai_auth(&paths).unwrap();

    assert_eq!(read_json(&managed_auth_path(&paths, &id)).unwrap(), fresh);
    assert_eq!(read_json(&paths.current_auth).unwrap(), fresh);
    fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
}
