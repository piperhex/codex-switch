use super::*;

fn test_app() -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier =
        format!("dev.codex.switch.context-test.{}", uuid::Uuid::new_v4());
    tauri::test::mock_builder().build(context).unwrap()
}

fn set_model_window(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    model: &str,
    value: Option<u64>,
) {
    update_model_context_window(
        app,
        ModelContextWindowUpdate::Model {
            model: model.into(),
            context_window: value,
        },
    )
    .unwrap();
}

#[test]
fn stale_settings_write_preserves_saved_proxy_context_windows() {
    let app = test_app();
    let path = app_settings_path(app.handle()).unwrap();
    let mut stale_settings = AppSettings::default();
    write_app_settings(app.handle(), &stale_settings).unwrap();

    update_model_context_window(app.handle(), ModelContextWindowUpdate::Global(384_000)).unwrap();
    set_model_window(app.handle(), "gpt-6-astra", Some(128_000));

    // A background sync started before the edit finishes after it and saves its old snapshot.
    stale_settings.cloud_last_sync_at = Some("2026-10-01T00:00:00Z".into());
    write_app_settings(app.handle(), &stale_settings).unwrap();
    let reloaded = read_app_settings(app.handle()).unwrap();
    fs::remove_dir_all(path.parent().unwrap()).unwrap();

    assert_eq!(reloaded.gpt_5_6_sol_context_window, 384_000);
    assert_eq!(
        reloaded.official_model_context_windows["gpt-6-astra"],
        128_000
    );
    assert_eq!(
        reloaded.cloud_last_sync_at,
        stale_settings.cloud_last_sync_at
    );
}

#[test]
fn proxy_mode_round_trip_preserves_context_and_explicit_model_removal() {
    let app = test_app();
    let path = app_settings_path(app.handle()).unwrap();
    let root = path.parent().unwrap();
    let paths = Paths {
        codex_home: root.join("codex"),
        current_auth: root.join("codex/auth.json"),
        current_config: root.join("codex/config.toml"),
        accounts: root.join("accounts"),
        providers: root.join("providers"),
        config_backup: root.join("backup.toml"),
        state_file: root.join("state.json"),
    };
    update_model_context_window(app.handle(), ModelContextWindowUpdate::Global(400_000)).unwrap();
    set_model_window(app.handle(), "gpt-6-astra", Some(128_000));
    set_model_window(app.handle(), "gpt-6-sol", Some(272_000));
    let stale = read_app_settings(app.handle()).unwrap();
    set_model_window(app.handle(), "gpt-6-sol", None);

    for enabled in [true, false, true, false, true] {
        update_state(&paths, |state| {
            state.local_proxy_enabled = enabled;
            Ok(())
        })
        .unwrap();
        write_app_settings(app.handle(), &stale).unwrap();
        let reloaded = read_app_settings(app.handle()).unwrap();
        assert_eq!(reloaded.gpt_5_6_sol_context_window, 400_000);
        assert_eq!(reloaded.official_model_context_windows.len(), 1);
        assert_eq!(
            reloaded.official_model_context_windows["gpt-6-astra"],
            128_000
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_context_updates_keep_all_models_and_global_window() {
    let app = test_app();
    let handle = app.handle();
    std::thread::scope(|scope| {
        for index in 0..8 {
            let app = app.handle();
            scope.spawn(move || set_model_window(app, &format!("model-{index}"), Some(128_000)));
        }
        scope.spawn(|| {
            update_model_context_window(handle, ModelContextWindowUpdate::Global(384_000)).unwrap();
        });
    });
    let reloaded = read_app_settings(app.handle()).unwrap();
    fs::remove_dir_all(app_settings_path(app.handle()).unwrap().parent().unwrap()).unwrap();
    assert_eq!(reloaded.gpt_5_6_sol_context_window, 384_000);
    assert_eq!(reloaded.official_model_context_windows.len(), 8);
}

#[test]
fn invalid_context_settings_are_not_replaced_by_defaults_during_a_write() {
    let app = test_app();
    let path = app_settings_path(app.handle())
        .unwrap()
        .with_file_name("model-context-settings.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "invalid settings").unwrap();
    write_app_settings(app.handle(), &AppSettings::default()).unwrap();
    assert!(read_app_settings(app.handle()).is_err());
    assert!(
        update_model_context_window(app.handle(), ModelContextWindowUpdate::Global(384_000))
            .is_err()
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "invalid settings");
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn first_context_edit_preserves_legacy_global_and_other_model_preferences() {
    let app = test_app();
    let settings = AppSettings {
        gpt_5_6_sol_context_window: 400_000,
        official_model_context_windows: [("gpt-6-astra".into(), 128_000)].into(),
        ..AppSettings::default()
    };
    write_app_settings(app.handle(), &settings).unwrap();
    assert_eq!(
        read_app_settings(app.handle())
            .unwrap()
            .gpt_5_6_sol_context_window,
        400_000
    );
    set_model_window(app.handle(), "gpt-6-sol", Some(272_000));
    let reloaded = read_app_settings(app.handle()).unwrap();
    fs::remove_dir_all(app_settings_path(app.handle()).unwrap().parent().unwrap()).unwrap();
    assert_eq!(reloaded.gpt_5_6_sol_context_window, 400_000);
    assert_eq!(
        reloaded.official_model_context_windows["gpt-6-astra"],
        128_000
    );
    assert_eq!(
        reloaded.official_model_context_windows["gpt-6-sol"],
        272_000
    );
}

#[test]
fn startup_migration_keeps_legacy_preferences_across_stale_writes_and_restarts() {
    let app = test_app();
    let settings = AppSettings {
        gpt_5_6_sol_context_window: 384_000,
        official_model_context_windows: [("gpt-6-astra".into(), 128_000)].into(),
        ..AppSettings::default()
    };
    write_app_settings(app.handle(), &settings).unwrap();
    model_context_settings::migrate_legacy_context_settings(app.handle()).unwrap();
    write_app_settings(app.handle(), &AppSettings::default()).unwrap();
    model_context_settings::migrate_legacy_context_settings(app.handle()).unwrap();
    let reloaded = read_app_settings(app.handle()).unwrap();
    fs::remove_dir_all(app_settings_path(app.handle()).unwrap().parent().unwrap()).unwrap();
    assert_eq!(reloaded.gpt_5_6_sol_context_window, 384_000);
    assert_eq!(
        reloaded.official_model_context_windows,
        settings.official_model_context_windows
    );
}
