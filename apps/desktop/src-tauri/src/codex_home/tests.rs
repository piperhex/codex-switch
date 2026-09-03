use super::{
    ensure_default_entry, expand_home_alias, normalize_entries, resolve_from_sources,
    validate_custom_home, DEFAULT_CODEX_HOME_ID,
};
use crate::models::CodexHomeEntry;
use std::{fs, path::PathBuf};

fn entry(id: &str, path: &str, enabled: bool) -> CodexHomeEntry {
    CodexHomeEntry {
        id: id.to_string(),
        path: path.to_string(),
        enabled,
    }
}

#[test]
fn configured_home_precedes_environment_and_default() {
    let configured = PathBuf::from("configured-home");
    let resolved = resolve_from_sources(
        Some(configured.clone()),
        Some(PathBuf::from("environment-home")),
        Some(PathBuf::from("user-home")),
    )
    .unwrap();

    assert_eq!(resolved, configured);
}

#[test]
fn environment_home_precedes_default() {
    let environment = PathBuf::from("environment-home");
    let resolved = resolve_from_sources(
        None,
        Some(environment.clone()),
        Some(PathBuf::from("user-home")),
    )
    .unwrap();

    assert_eq!(resolved, environment);
}

#[test]
fn default_home_uses_dot_codex() {
    let home = PathBuf::from("user-home");
    let resolved = resolve_from_sources(None, None, Some(home.clone())).unwrap();

    assert_eq!(resolved, home.join(".codex"));
}

#[test]
fn custom_home_requires_an_existing_absolute_directory() {
    let root = temp_home();
    fs::create_dir_all(&root).unwrap();
    let file = root.join("not-a-directory");
    fs::write(&file, b"test").unwrap();

    let filesystem_root = root.ancestors().last().unwrap();
    assert_eq!(validate_custom_home(root.to_str().unwrap()).unwrap(), root);
    assert!(validate_custom_home("relative-home").is_err());
    assert!(validate_custom_home(filesystem_root.to_str().unwrap()).is_err());
    assert!(validate_custom_home(file.to_str().unwrap()).is_err());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn home_aliases_expand_to_absolute_paths() {
    let home = dirs::home_dir().unwrap();
    assert_eq!(expand_home_alias("~/.codex"), home.join(".codex"));
    assert_eq!(
        expand_home_alias("%USERPROFILE%\\.codex"),
        home.join(".codex")
    );
}

#[test]
fn multiple_enabled_homes_are_preserved() {
    let root = temp_home();
    let second = root.join("second");
    fs::create_dir_all(&second).unwrap();
    let entries = vec![
        entry("one", root.to_str().unwrap(), true),
        entry("two", second.to_str().unwrap(), true),
    ];
    let normalized = normalize_entries(entries).unwrap();
    assert_eq!(normalized.len(), 2);
    assert!(normalized.iter().all(|home| home.enabled));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_default_home_is_inserted() {
    let default_path = PathBuf::from("default-home");
    let mut entries = vec![entry("custom", "custom-home", true)];

    assert!(ensure_default_entry(&mut entries, &default_path));
    assert_eq!(
        entries[0],
        entry(DEFAULT_CODEX_HOME_ID, "default-home", true)
    );
}

#[test]
fn default_home_path_is_always_corrected() {
    let default_path = PathBuf::from("real-default-home");
    let mut entries = vec![entry(DEFAULT_CODEX_HOME_ID, "overwritten-home", false)];

    assert!(ensure_default_entry(&mut entries, &default_path));
    assert_eq!(entries[0].path, "real-default-home");
}

#[test]
fn matching_legacy_home_becomes_the_default_record() {
    let default_path = PathBuf::from("default-home");
    let mut entries = vec![entry("legacy", "default-home", false)];

    assert!(ensure_default_entry(&mut entries, &default_path));
    assert_eq!(
        entries,
        vec![entry(DEFAULT_CODEX_HOME_ID, "default-home", true)]
    );
}

#[test]
fn default_home_does_not_need_to_exist_when_settings_are_normalized() {
    let default_path = temp_home();
    let default = entry(DEFAULT_CODEX_HOME_ID, default_path.to_str().unwrap(), true);

    assert_eq!(
        normalize_entries(vec![default.clone()]).unwrap(),
        vec![default]
    );
}

#[test]
fn disabled_default_home_stays_disabled_when_custom_home_is_enabled() {
    let default_path = PathBuf::from("default-home");
    let mut entries = vec![
        entry(DEFAULT_CODEX_HOME_ID, "default-home", false),
        entry("custom", "custom-home", true),
    ];

    assert!(!ensure_default_entry(&mut entries, &default_path));
    assert!(!entries[0].enabled);
}

#[test]
fn default_home_is_reenabled_when_every_home_is_disabled() {
    let default_path = PathBuf::from("default-home");
    let mut entries = vec![
        entry(DEFAULT_CODEX_HOME_ID, "default-home", false),
        entry("custom", "custom-home", false),
    ];

    assert!(ensure_default_entry(&mut entries, &default_path));
    assert!(entries[0].enabled);
    assert!(!entries[1].enabled);
}

fn temp_home() -> PathBuf {
    std::env::temp_dir().join(format!("codex-switch-home-test-{}", uuid::Uuid::new_v4()))
}
