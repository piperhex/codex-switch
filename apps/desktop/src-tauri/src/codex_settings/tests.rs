use std::{fs, path::PathBuf};

use serde_json::json;

use super::{
    document,
    error::ConfigError,
    models::{PatchConfigRequest, SaveConfigRequest},
    patch, persistence,
};

struct Fixture(PathBuf);

impl Fixture {
    fn new(content: &str) -> Self {
        let root = std::env::temp_dir().join(format!("csw-config-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let fixture = Self(root.join("config.toml"));
        fs::write(&fixture.0, content).unwrap();
        fixture
    }

    fn content(&self) -> String {
        fs::read_to_string(&self.0).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(self.0.parent().unwrap()).unwrap();
    }
}

fn path(segments: &[&str]) -> Vec<String> {
    segments
        .iter()
        .map(|segment| (*segment).to_owned())
        .collect()
}

#[test]
fn selected_home_writes_are_isolated_and_revisions_cannot_cross_homes() {
    let first = Fixture::new("model = 'same'\n");
    let second = Fixture::new("model = 'same'\n");
    let first_home = first.0.parent().unwrap();
    let second_home = second.0.parent().unwrap();
    let original = persistence::with_current_config(first_home, persistence::read).unwrap();
    let cross_home = persistence::with_current_config(second_home, |path| {
        persistence::save(
            path,
            SaveConfigRequest {
                content: "model = 'wrong'\n".into(),
                expected_revision: original.revision.clone(),
            },
        )
    });
    assert!(matches!(cross_home, Err(ConfigError::Conflict)));
    persistence::with_current_config(first_home, |path| {
        persistence::save(
            path,
            SaveConfigRequest {
                content: "model = 'edited'\n".into(),
                expected_revision: original.revision,
            },
        )
    })
    .unwrap();
    assert_eq!(first.content(), "model = 'edited'\n");
    assert_eq!(second.content(), "model = 'same'\n");
}

#[test]
fn invalid_toml_reports_position_without_exposing_source() {
    let error = document::parse("model = \"secret-token\"\nfeatures = [\n").unwrap_err();
    let diagnostic = error.diagnostic();
    assert!(diagnostic.line.is_some());
    assert!(diagnostic.column.is_some());
    assert!(!diagnostic.message.contains("secret-token"));
}

#[test]
fn nested_patch_preserves_comments_and_quoted_keys() {
    let source = "# my setup\nmodel = \"custom\" # preferred\n\n[features]\n# enable shell\n'js_repl' = false # retained\n\n[extra]\nunknown = 42\n";
    let updated = patch::apply(source, &path(&["features", "js_repl"]), &json!(true)).unwrap();
    assert_eq!(
        updated,
        source.replace("'js_repl' = false", "'js_repl' = true")
    );
}

#[test]
fn quoted_path_segments_are_not_split_on_dots() {
    let source = "[projects.\"C:\\\\work\\\\my.project\"]\ntrust_level = \"untrusted\"\n";
    let updated = patch::apply(
        source,
        &path(&["projects", r"C:\work\my.project", "trust_level"]),
        &json!("trusted"),
    )
    .unwrap();
    let values = document::values(&document::parse(&updated).unwrap()).unwrap();
    assert_eq!(
        values["projects"][r"C:\work\my.project"]["trust_level"],
        "trusted"
    );
    assert!(updated.contains("[projects.\"C:\\\\work\\\\my.project\"]"));
}

#[test]
fn missing_nested_tables_and_inline_tables_can_be_patched() {
    let updated = patch::apply(
        "features = { enabled = false }\n",
        &path(&["features", "enabled"]),
        &json!(true),
    )
    .unwrap();
    let updated = patch::apply(
        &updated,
        &path(&["mcp_servers", "example", "command"]),
        &json!("test-command"),
    )
    .unwrap();
    let values = document::values(&document::parse(&updated).unwrap()).unwrap();
    assert_eq!(values["features"]["enabled"], true);
    assert_eq!(values["mcp_servers"]["example"]["command"], "test-command");
}

#[test]
fn dotted_key_patch_keeps_unrelated_source() {
    let source = "# features\nfeatures.js_repl = false # inline\nfeatures.other = true\n";
    let updated = patch::apply(source, &path(&["features", "js_repl"]), &json!(true)).unwrap();
    assert_eq!(updated, source.replace("js_repl = false", "js_repl = true"));
}

#[test]
fn replacement_supports_arrays_and_nested_objects() {
    let source = "notify = [\"old\"] # keep\n[tools]\nold = false\n";
    let updated = patch::apply(source, &path(&["notify"]), &json!(["cmd", "--notify"])).unwrap();
    let updated = patch::apply(
        &updated,
        &path(&["tools"]),
        &json!({"enabled": true, "servers": [{"name": "one", "args": []}]}),
    )
    .unwrap();
    let values = document::values(&document::parse(&updated).unwrap()).unwrap();
    assert_eq!(values["notify"], json!(["cmd", "--notify"]));
    assert_eq!(values["tools"]["servers"][0]["name"], "one");
    assert!(values["tools"].get("old").is_none());
    assert!(updated.contains("# keep"));
}

#[test]
fn removal_leaves_other_settings_and_missing_removal_is_noop() {
    let source = "model = \"one\"\n[features]\njs_repl = true\nother = false\n";
    let updated = patch::apply(source, &path(&["features", "js_repl"]), &json!(null)).unwrap();
    assert!(!updated.contains("js_repl"));
    assert!(updated.contains("other = false"));
    assert_eq!(
        patch::apply(&updated, &path(&["missing", "key"]), &json!(null)).unwrap(),
        updated
    );
}

#[test]
fn invalid_paths_and_nested_null_do_not_replace_existing_values() {
    let source = "model = \"one\"\n";
    assert!(patch::apply(source, &[], &json!(true)).is_err());
    assert!(patch::apply(source, &path(&["model", "child"]), &json!(true)).is_err());
    assert!(patch::apply(source, &path(&["features"]), &json!({"invalid": null})).is_err());
}

#[test]
fn invalid_source_is_readable_but_cannot_be_patched() {
    let fixture = Fixture::new("model = [");
    let current = persistence::read(&fixture.0).unwrap();
    assert_eq!(current.content, fixture.content());
    assert!(current.error.is_some());
    assert!(current.values.is_none());
    let result = persistence::patch(
        &fixture.0,
        PatchConfigRequest {
            path: path(&["model"]),
            value: json!("one"),
            expected_revision: current.revision,
        },
    );
    assert!(matches!(result, Err(ConfigError::InvalidToml(_))));
    assert_eq!(fixture.content(), "model = [");
}

#[test]
fn invalid_save_preserves_original_and_creates_no_temporary_files() {
    let fixture = Fixture::new("model = \"one\"\n");
    let current = persistence::read(&fixture.0).unwrap();
    let result = persistence::save(
        &fixture.0,
        SaveConfigRequest {
            content: "model = [".to_owned(),
            expected_revision: current.revision,
        },
    );
    assert!(matches!(result, Err(ConfigError::InvalidToml(_))));
    assert_eq!(fixture.content(), "model = \"one\"\n");
    assert_eq!(
        fs::read_dir(fixture.0.parent().unwrap()).unwrap().count(),
        1
    );
}

#[test]
fn stale_save_and_patch_preserve_external_edits() {
    let fixture = Fixture::new("model = \"one\"\n");
    let current = persistence::read(&fixture.0).unwrap();
    fs::write(&fixture.0, "model = \"external\"\n").unwrap();
    let result = persistence::save(
        &fixture.0,
        SaveConfigRequest {
            content: "model = \"two\"\n".to_owned(),
            expected_revision: current.revision.clone(),
        },
    );
    assert!(matches!(result, Err(ConfigError::Conflict)));
    let result = persistence::patch(
        &fixture.0,
        PatchConfigRequest {
            path: path(&["model"]),
            value: json!("two"),
            expected_revision: current.revision,
        },
    );
    assert!(matches!(result, Err(ConfigError::Conflict)));
    assert_eq!(fixture.content(), "model = \"external\"\n");
}

#[test]
fn revision_is_bound_to_the_config_directory() {
    let first = Fixture::new("model = \"one\"\n");
    let second = Fixture::new(&first.content());
    let current = persistence::read(&first.0).unwrap();
    assert_ne!(
        current.revision,
        persistence::read(&second.0).unwrap().revision
    );
    let result = persistence::save(
        &second.0,
        SaveConfigRequest {
            content: "model = \"two\"\n".to_owned(),
            expected_revision: current.revision,
        },
    );
    assert!(matches!(result, Err(ConfigError::Conflict)));
}

#[test]
fn raw_editor_can_repair_invalid_toml_and_preserve_exact_source() {
    let fixture = Fixture::new("model = [");
    let current = persistence::read(&fixture.0).unwrap();
    let source = "# a note\r\nmodel = 'one'\r\n";
    let saved = persistence::save(
        &fixture.0,
        SaveConfigRequest {
            content: source.to_owned(),
            expected_revision: current.revision.clone(),
        },
    )
    .unwrap();
    assert_eq!(fixture.content(), source);
    assert_eq!(saved.values.unwrap()["model"], "one");
    assert!(saved.error.is_none());
    assert_ne!(saved.revision, current.revision);
}

#[test]
fn valid_toml_without_safe_json_representation_still_saves_exactly() {
    for source in [
        "value = 9007199254740993\n",
        "value = nan\n",
        "value = 2026-09-06\n",
    ] {
        let fixture = Fixture::new("");
        let current = persistence::read(&fixture.0).unwrap();
        assert!(document::parse(source).is_ok());
        let saved = persistence::save(
            &fixture.0,
            SaveConfigRequest {
                content: source.to_owned(),
                expected_revision: current.revision,
            },
        )
        .unwrap();
        assert_eq!(saved.content, source);
        assert!(saved.values.is_none());
        assert!(saved.error.is_some());
        assert_eq!(fixture.content(), source);
    }
}

#[test]
fn unreadable_source_cannot_be_overwritten_and_missing_file_can_be_created() {
    let fixture = Fixture::new("");
    fs::write(&fixture.0, [0xff, 0xfe]).unwrap();
    assert!(matches!(
        persistence::read(&fixture.0),
        Err(ConfigError::Read)
    ));
    let result = persistence::save(
        &fixture.0,
        SaveConfigRequest {
            content: "model = 'one'".to_owned(),
            expected_revision: String::new(),
        },
    );
    assert!(matches!(result, Err(ConfigError::Read)));
    assert_eq!(fs::read(&fixture.0).unwrap(), [0xff, 0xfe]);
    fs::remove_file(&fixture.0).unwrap();
    let missing = persistence::read(&fixture.0).unwrap();
    persistence::save(
        &fixture.0,
        SaveConfigRequest {
            content: "model = 'one'".to_owned(),
            expected_revision: missing.revision,
        },
    )
    .unwrap();
    assert_eq!(fixture.content(), "model = 'one'");
}
