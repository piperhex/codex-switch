use super::*;

fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("gui-model-settings-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    root
}

fn selection(model: &str, effort: Effort) -> ModelSelection {
    ModelSelection {
        model: model.into(),
        effort,
    }
}

#[test]
fn conversations_and_draft_persist_independently() {
    let root = root();
    let draft = selection("draft-model", Effort::Medium);
    let first = selection("first-model", Effort::Ultra);
    let second = selection("second-model", Effort::Low);
    save(&root, None, draft.clone()).unwrap();
    save(&root, Some("one".into()), first.clone()).unwrap();
    save(&root, Some("two".into()), second.clone()).unwrap();
    assert_eq!(read(&root, None).unwrap().selection, Some(draft));
    assert_eq!(
        read(&root, Some("one".into())).unwrap().selection,
        Some(first)
    );
    assert_eq!(
        read(&root, Some("two".into())).unwrap().selection,
        Some(second)
    );
    assert_eq!(read(&root, Some("new".into())).unwrap().revision, 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn revisions_order_changes_and_identical_saves_are_idempotent() {
    let root = root();
    let first = selection("one", Effort::Minimal);
    assert_eq!(save(&root, None, first.clone()).unwrap().revision, 1);
    assert_eq!(save(&root, None, first).unwrap().revision, 1);
    assert_eq!(
        save(&root, None, selection("one", Effort::High))
            .unwrap()
            .revision,
        2
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_input_cannot_escape_the_settings_directory() {
    let root = root();
    for id in ["", "../other", "..", "a/b", "a\\b", "C:foo", "\n"] {
        assert!(settings_path(&root, Some(id)).is_err(), "{id:?}");
    }
    for model in ["", " ", " model", "a\nb"] {
        assert!(save(&root, None, selection(model, Effort::None)).is_err());
    }
    assert!(save(
        &root,
        None,
        selection(&"x".repeat(MAX_NAME_BYTES + 1), Effort::None)
    )
    .is_err());
    assert!(
        serde_json::from_str::<ModelSelection>(r#"{"model":"one","effort":"invalid"}"#).is_err()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn corrupted_settings_are_not_overwritten_with_defaults() {
    let root = root();
    save(&root, None, selection("one", Effort::High)).unwrap();
    let path = settings_path(&root, None).unwrap();
    fs::write(&path, "broken").unwrap();
    assert!(read(&root, None).is_err());
    assert!(save(&root, None, selection("two", Effort::Low)).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "broken");
    fs::remove_dir_all(root).unwrap();
}
