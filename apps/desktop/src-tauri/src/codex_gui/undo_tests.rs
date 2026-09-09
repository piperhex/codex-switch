use super::*;

struct Workspace(PathBuf);
impl Workspace {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("csw-undo-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self(root.canonicalize().unwrap())
    }
    fn undo(&self, edits: Vec<Change>) -> Result<UndoResponse> {
        execute(&self.0, edits, &self.0.join("receipt"))
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn change(path: &str, kind: &str, diff: &str) -> Change {
    Change {
        path: path.into(),
        diff: diff.into(),
        kind: ChangeKind {
            kind: kind.into(),
            move_path: None,
        },
    }
}

#[test]
fn reverses_repeated_edits_and_preserves_unrelated_content() {
    let workspace = Workspace::new();
    fs::write(workspace.0.join("file.txt"), "third\nuntouched\nlocal\n").unwrap();
    let edits = vec![
        change("file.txt", "update", "@@ -1 +1 @@\n-first\n+second\n"),
        change("file.txt", "update", "@@ -1 +1 @@\n-second\n+third\n"),
    ];
    assert!(workspace.undo(edits).unwrap().undone);
    assert_eq!(
        fs::read_to_string(workspace.0.join("file.txt")).unwrap(),
        "first\nuntouched\nlocal\n"
    );
    assert!(workspace.undo(vec![]).unwrap().undone);
}

#[test]
fn add_delete_and_empty_files_are_restored() {
    let workspace = Workspace::new();
    fs::write(workspace.0.join("added.txt"), "new\n").unwrap();
    fs::write(workspace.0.join("empty.txt"), "").unwrap();
    workspace
        .undo(vec![
            change("added.txt", "add", "new\n"),
            change("deleted.txt", "delete", "old\n"),
            change("empty.txt", "add", ""),
        ])
        .unwrap();
    assert!(!workspace.0.join("added.txt").exists());
    assert!(!workspace.0.join("empty.txt").exists());
    assert_eq!(
        fs::read_to_string(workspace.0.join("deleted.txt")).unwrap(),
        "old\n"
    );
}

#[test]
fn conflict_leaves_every_original_file_untouched() {
    let workspace = Workspace::new();
    fs::write(workspace.0.join("conflict.txt"), "later edit\n").unwrap();
    fs::write(workspace.0.join("added.txt"), "new\n").unwrap();
    let result = workspace.undo(vec![
        change("conflict.txt", "update", "@@ -1 +1 @@\n-old\n+new\n"),
        change("added.txt", "add", "new\n"),
    ]);
    assert!(matches!(result, Err(UndoError::Conflict)));
    assert_eq!(
        fs::read_to_string(workspace.0.join("added.txt")).unwrap(),
        "new\n"
    );
    assert_eq!(
        fs::read_to_string(workspace.0.join("conflict.txt")).unwrap(),
        "later edit\n"
    );
}

#[test]
fn renames_and_unicode_paths_are_reversed() {
    let workspace = Workspace::new();
    fs::write(workspace.0.join("新 文件.txt"), "new\n").unwrap();
    let mut edit = change("旧 文件.txt", "update", "@@ -1 +1 @@\n-old\n+new\n");
    edit.kind.move_path = Some("新 文件.txt".into());
    workspace.undo(vec![edit]).unwrap();
    assert!(!workspace.0.join("新 文件.txt").exists());
    assert_eq!(
        fs::read_to_string(workspace.0.join("旧 文件.txt")).unwrap(),
        "old\n"
    );
}

#[test]
fn rejects_traversal_and_repository_metadata() {
    let workspace = Workspace::new();
    for path in [
        "../escape",
        ".git/config",
        "folder/../../escape",
        "file:stream",
        ".GIT/config",
    ] {
        assert!(relative_path(&workspace.0, path).is_err(), "{path}");
    }
    let path = super::super::platform::execution_path(&workspace.0.join("file.txt"));
    assert_eq!(
        relative_path(&workspace.0, &path).unwrap(),
        Path::new("file.txt")
    );
}

#[test]
fn selects_only_completed_server_edits_and_rejects_active_threads() {
    let mut thread = json!({"turns": [{"id": "turn", "status": "completed", "items": [
        {"type": "fileChange", "status": "failed", "changes": []},
        {"type": "fileChange", "status": "completed", "changes": [
            {"path": "file", "kind": {"type": "add"}, "diff": "new"}
        ]}
    ]}]});
    assert_eq!(changes(&thread, "turn").unwrap().len(), 1);
    thread["turns"][0]["status"] = json!("inProgress");
    assert!(matches!(changes(&thread, "turn"), Err(UndoError::Busy)));
}

#[test]
fn preserves_windows_line_endings() {
    let workspace = Workspace::new();
    fs::write(workspace.0.join("file.txt"), "new\r\nunchanged\r\n").unwrap();
    workspace
        .undo(vec![change(
            "file.txt",
            "update",
            "@@ -1 +1 @@\n-old\n+new\n",
        )])
        .unwrap();
    assert_eq!(
        fs::read_to_string(workspace.0.join("file.txt")).unwrap(),
        "old\r\nunchanged\r\n"
    );
}

#[test]
fn failed_receipt_restores_original_files() {
    let workspace = Workspace::new();
    fs::write(workspace.0.join("file.txt"), "new\n").unwrap();
    fs::create_dir_all(workspace.0.join("receipt/completed")).unwrap();
    let result = workspace.undo(vec![change(
        "file.txt",
        "update",
        "@@ -1 +1 @@\n-old\n+new\n",
    )]);
    assert!(matches!(result, Err(UndoError::Io)));
    assert_eq!(
        fs::read_to_string(workspace.0.join("file.txt")).unwrap(),
        "new\n"
    );
}

#[test]
fn does_not_modify_other_hard_links() {
    let workspace = Workspace::new();
    fs::write(workspace.0.join("file.txt"), "new\n").unwrap();
    fs::hard_link(workspace.0.join("file.txt"), workspace.0.join("other.txt")).unwrap();
    workspace
        .undo(vec![change(
            "file.txt",
            "update",
            "@@ -1 +1 @@\n-old\n+new\n",
        )])
        .unwrap();
    assert_eq!(
        fs::read_to_string(workspace.0.join("other.txt")).unwrap(),
        "new\n"
    );
}

#[test]
fn preserves_missing_final_newline() {
    let workspace = Workspace::new();
    fs::write(workspace.0.join("file.txt"), "new").unwrap();
    let patch =
        "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n";
    workspace
        .undo(vec![change("file.txt", "update", patch)])
        .unwrap();
    assert_eq!(
        fs::read_to_string(workspace.0.join("file.txt")).unwrap(),
        "old"
    );
}
