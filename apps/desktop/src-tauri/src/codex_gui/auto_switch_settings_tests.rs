use super::*;
use std::path::PathBuf;

fn store_root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("gui-auto-switch-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    root
}

fn account(id: &str) -> GuiAutoSwitchAccount {
    GuiAutoSwitchAccount {
        account_id: id.into(),
        ..Default::default()
    }
}

#[test]
fn empty_settings_disable_switching_with_independent_defaults() {
    let settings: GuiAutoSwitchSettings = serde_json::from_str("{}").unwrap();
    assert!(!settings.enabled);
    assert!(settings.switch_on_quota_exhaustion);
    assert_eq!(settings.mode, GuiAutoSwitchMode::Sequential);
    assert!(settings.fallback_provider_id.is_none());
    assert!(settings.account_rule("new-account").is_none());
    assert_eq!(settings.effective_threshold("new-account"), 0.0);
    let rule: GuiAutoSwitchAccount =
        serde_json::from_str(r#"{"accountId":"new-account"}"#).unwrap();
    assert!(rule.enabled);
    assert_eq!(rule.priority, 0);
    assert_eq!(rule.threshold_percent, 0.0);
}

#[test]
fn effective_threshold_respects_both_gui_limits() {
    let mut settings = GuiAutoSwitchSettings {
        minimum_remaining_percent: 20.0,
        accounts: vec![GuiAutoSwitchAccount {
            threshold_percent: 35.0,
            ..account("selected")
        }],
        ..Default::default()
    };
    assert_eq!(settings.effective_threshold("selected"), 35.0);
    assert_eq!(settings.effective_threshold("new-account"), 20.0);
    settings.accounts[0].threshold_percent = 5.0;
    assert_eq!(settings.effective_threshold("selected"), 20.0);
}

#[test]
fn thresholds_reject_out_of_range_and_non_finite_values() {
    for threshold in [-0.1, 100.1, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut settings = GuiAutoSwitchSettings {
            minimum_remaining_percent: threshold,
            ..Default::default()
        };
        assert!(matches!(
            validate_shape(&settings),
            Err(SettingsError::InvalidThreshold)
        ));
        settings.minimum_remaining_percent = 0.0;
        settings.accounts = vec![GuiAutoSwitchAccount {
            threshold_percent: threshold,
            ..account("selected")
        }];
        assert!(matches!(
            validate_shape(&settings),
            Err(SettingsError::InvalidThreshold)
        ));
    }
    assert!(validate_threshold(0.0).is_ok());
    assert!(validate_threshold(100.0).is_ok());
}

#[test]
fn account_rules_reject_duplicates_and_unsafe_ids() {
    let duplicate = GuiAutoSwitchSettings {
        accounts: vec![account("same"), account("same")],
        ..Default::default()
    };
    assert!(matches!(
        validate_shape(&duplicate),
        Err(SettingsError::InvalidAccounts)
    ));
    for id in [
        "",
        "..",
        ".",
        "../outside",
        "..\\outside",
        "C:\\secret",
        " trimmed ",
    ] {
        let settings = GuiAutoSwitchSettings {
            accounts: vec![account(id)],
            ..Default::default()
        };
        assert!(matches!(
            validate_shape(&settings),
            Err(SettingsError::InvalidAccounts)
        ));
    }
}

#[test]
fn account_rule_limits_reject_unbounded_input() {
    let mut settings = GuiAutoSwitchSettings {
        accounts: vec![account("a"); MAX_ACCOUNT_RULES + 1],
        ..Default::default()
    };
    assert!(matches!(
        validate_shape(&settings),
        Err(SettingsError::InvalidAccounts)
    ));
    settings.accounts = vec![account("a")];
    for priority in [i32::MIN, -MAX_PRIORITY - 1, MAX_PRIORITY + 1, i32::MAX] {
        settings.accounts[0].priority = priority;
        assert!(matches!(
            validate_shape(&settings),
            Err(SettingsError::InvalidPriority)
        ));
    }
    for priority in [-MAX_PRIORITY, 0, MAX_PRIORITY] {
        settings.accounts[0].priority = priority;
        assert!(validate_shape(&settings).is_ok());
    }
    settings.accounts[0].account_id = "a".repeat(MAX_ID_LENGTH + 1);
    assert!(matches!(
        validate_shape(&settings),
        Err(SettingsError::InvalidAccounts)
    ));
}

#[test]
fn unknown_accounts_are_rejected_even_when_disabled() {
    let settings = GuiAutoSwitchSettings {
        accounts: vec![GuiAutoSwitchAccount {
            enabled: false,
            ..account("deleted")
        }],
        ..Default::default()
    };
    assert!(matches!(
        validate_catalog_ids(&settings, &HashSet::from(["existing"])),
        Err(SettingsError::UnavailableAccount)
    ));
    assert!(validate_catalog_ids(&settings, &HashSet::from(["deleted"])).is_ok());
}

#[test]
fn fallback_provider_id_must_not_be_a_path_or_empty() {
    for id in ["", "../provider", "provider/child", "C:provider", " "] {
        let settings = GuiAutoSwitchSettings {
            fallback_provider_id: Some(id.into()),
            ..Default::default()
        };
        assert!(matches!(
            validate_shape(&settings),
            Err(SettingsError::UnavailableProvider)
        ));
    }
}

#[test]
fn persistence_survives_restart_without_changing_shared_state() {
    let root = store_root();
    let path = root.join(FILE_NAME);
    let shared_path = root.join("state.json");
    let shared_bytes = br#"{"disabledAccountIds":["a"],"autoSwitchEnabled":true}"#;
    fs::write(&shared_path, shared_bytes).unwrap();
    let initial = load(&path).unwrap();
    assert!(!initial.settings.enabled);
    assert_eq!(initial.revision, 0);
    assert!(!path.exists());
    let settings = GuiAutoSwitchSettings {
        enabled: true,
        mode: GuiAutoSwitchMode::Concurrent,
        fallback_provider_id: Some("backup".into()),
        accounts: vec![account("a")],
        ..Default::default()
    };
    let saved = persist(&path, settings.clone()).unwrap();
    assert_eq!(saved.revision, 1);
    assert_eq!(load(&path).unwrap().settings, settings);
    assert_eq!(fs::read(&shared_path).unwrap(), shared_bytes);
    fs::remove_file(path).unwrap();
    fs::remove_file(shared_path).unwrap();
    fs::remove_dir(root).unwrap();
}

#[test]
fn settings_revision_rejects_stale_work_after_identical_saves() {
    let root = store_root();
    let path = root.join(FILE_NAME);
    let settings = GuiAutoSwitchSettings::default();
    let first = persist(&path, settings.clone()).unwrap();
    assert_eq!(
        with_current_path(&path, first.revision, || 7).unwrap(),
        Some(7)
    );
    let second = persist(&path, settings).unwrap();
    assert_eq!(second.revision, first.revision + 1);
    assert!(
        with_current_path(&path, first.revision, || panic!("stale mutation"))
            .unwrap()
            .is_none()
    );
    assert_eq!(
        with_current_path(&path, second.revision, || 8).unwrap(),
        Some(8)
    );
    fs::remove_file(path).unwrap();
    fs::remove_dir(root).unwrap();
}

#[test]
fn legacy_settings_get_a_revision_and_public_dto_does_not_expose_it() {
    let root = store_root();
    let path = root.join(FILE_NAME);
    fs::write(&path, r#"{"enabled":true,"minimumRemainingPercent":12}"#).unwrap();
    let legacy = load(&path).unwrap();
    assert_eq!(legacy.revision, 0);
    assert!(legacy.settings.enabled);
    let saved = persist(&path, legacy.settings).unwrap();
    let public_json = serde_json::to_value(&saved.settings).unwrap();
    assert!(public_json.get("revision").is_none());
    let stored_json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(stored_json["revision"], 1);
    assert_eq!(stored_json["minimumRemainingPercent"], 12.0);
    fs::remove_file(path).unwrap();
    fs::remove_dir(root).unwrap();
}

#[test]
fn corrupted_settings_are_not_silently_reset() {
    let root = store_root();
    let path = root.join(FILE_NAME);
    fs::write(&path, "broken").unwrap();
    assert!(matches!(load(&path), Err(SettingsError::Storage)));
    fs::write(&path, r#"{"minimumRemainingPercent":101}"#).unwrap();
    assert!(matches!(load(&path), Err(SettingsError::InvalidThreshold)));
    fs::remove_file(path).unwrap();
    fs::remove_dir(root).unwrap();
}
