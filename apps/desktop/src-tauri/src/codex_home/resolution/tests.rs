use super::*;
use crate::codex_home::{
    ensure_default_entry, ensure_gui_entry, DEFAULT_CODEX_HOME_ID, GUI_CODEX_HOME_ID,
};
use crate::models::CodexHomeEntry;
use std::fs;

#[test]
fn configured_home_precedes_environment_and_default() {
    let configured = PathBuf::from("configured-home");
    assert_eq!(
        resolve_from_sources(
            Some(configured.clone()),
            Some(PathBuf::from("environment-home")),
            Some(PathBuf::from("user-home")),
            Some(Path::new("gui-home")),
        )
        .unwrap(),
        configured,
    );
}

#[test]
fn external_environment_home_precedes_default() {
    let environment = PathBuf::from("environment-home");
    assert_eq!(
        resolve_from_sources(
            None,
            Some(environment.clone()),
            Some(PathBuf::from("user-home")),
            Some(Path::new("gui-home")),
        )
        .unwrap(),
        environment,
    );
}

#[test]
fn default_home_uses_dot_codex() {
    let home = PathBuf::from("user-home");
    assert_eq!(
        resolve_from_sources(None, None, Some(home.clone()), None).unwrap(),
        home.join(".codex"),
    );
}

#[test]
fn inherited_gui_home_does_not_replace_external_default() {
    let home = PathBuf::from("user-home");
    let gui = home.join("app-data").join(".codex");
    assert_eq!(
        resolve_from_sources(None, Some(gui.clone()), Some(home.clone()), Some(&gui)).unwrap(),
        home.join(".codex"),
    );
    assert!(resolve_from_sources(None, Some(gui.clone()), None, Some(&gui)).is_err());
}

#[test]
fn inherited_gui_alias_is_also_ignored() {
    let root = std::env::temp_dir().join(format!("codex-home-alias-{}", uuid::Uuid::new_v4()));
    let gui = root.join("gui");
    fs::create_dir_all(&gui).unwrap();
    let alias = gui.join("..").join("gui");
    assert_eq!(
        resolve_from_sources(None, Some(alias), Some(root.clone()), Some(&gui)).unwrap(),
        root.join(".codex"),
    );
    fs::remove_dir_all(root).unwrap();
}

fn entry(id: &str, path: &Path, enabled: bool) -> CodexHomeEntry {
    CodexHomeEntry {
        id: id.into(),
        path: path.to_string_lossy().into_owned(),
        enabled,
    }
}

#[test]
fn startup_and_save_keep_default_and_gui_separate() {
    let home = std::env::temp_dir().join("codex-home-inherited-startup");
    let external = home.join(".codex");
    let gui = home.join("app-data").join(".codex");
    let default = resolve_from_sources(None, Some(gui.clone()), Some(home), Some(&gui)).unwrap();
    let expected = vec![
        entry(DEFAULT_CODEX_HOME_ID, &external, true),
        entry(GUI_CODEX_HOME_ID, &gui, false),
    ];
    let cases = [
        expected.clone(),
        vec![entry(GUI_CODEX_HOME_ID, &gui, false)],
        vec![
            entry(DEFAULT_CODEX_HOME_ID, &gui, true),
            entry(GUI_CODEX_HOME_ID, &gui, false),
        ],
        Vec::new(),
    ];
    for mut entries in cases {
        ensure_default_entry(&mut entries, &default);
        ensure_gui_entry(&mut entries, &gui);
        assert_eq!(entries, expected);
        assert_eq!(
            super::super::normalize_entries(entries.clone()).unwrap(),
            expected
        );
        assert!(!ensure_default_entry(&mut entries, &default));
        assert!(!ensure_gui_entry(&mut entries, &gui));
        let enabled = super::super::configured_entries(&entries);
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].path, external);
    }
}

#[test]
fn recovery_keeps_custom_home_and_disabled_default() {
    let home = std::env::temp_dir().join("codex-home-custom-startup");
    let external = home.join(".codex");
    let gui = home.join("app-data").join(".codex");
    let default =
        resolve_from_sources(None, Some(gui.clone()), Some(home.clone()), Some(&gui)).unwrap();
    let expected = vec![
        entry(DEFAULT_CODEX_HOME_ID, &external, false),
        entry("custom", &home.join("custom"), true),
        entry(GUI_CODEX_HOME_ID, &gui, false),
    ];
    let mut entries = expected.clone();
    ensure_default_entry(&mut entries, &default);
    ensure_gui_entry(&mut entries, &gui);
    assert_eq!(entries, expected);
}
