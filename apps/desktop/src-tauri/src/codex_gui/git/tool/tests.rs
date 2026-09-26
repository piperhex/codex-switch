use super::super::{output, run};
use super::*;
use std::{fs, path::PathBuf};

pub(super) struct Repo(pub(super) PathBuf);
impl Repo {
    pub(super) fn new(initial: bool) -> Self {
        let root = std::env::temp_dir().join(format!("csw-git-tool-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let repo = Self(root.canonicalize().unwrap());
        repo.git(&["init", "-b", "main"]);
        repo.git(&["config", "user.name", "Test"]);
        repo.git(&["config", "user.email", "test@example.invalid"]);
        repo.git(&["config", "core.autocrlf", "false"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        if initial {
            repo.write("one.txt", "one\n");
            repo.write("two.txt", "two\n");
            repo.git(&["add", "."]);
            repo.git(&["commit", "-m", "initial"]);
        }
        repo
    }
    pub(super) fn git(&self, args: &[&str]) {
        let result = run(&self.0, args).unwrap();
        assert!(
            result.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    pub(super) fn write(&self, path: &str, text: &str) {
        fs::write(self.0.join(path), text).unwrap();
    }
    fn commit(&self, paths: &[&str]) -> Result<String> {
        let state = changes::read(&self.0)?;
        let files = state
            .files
            .iter()
            .filter(|file| paths.contains(&file.path.as_str()))
            .map(|file| SelectedFile {
                path: file.path.clone(),
                version: file.version.clone(),
            })
            .collect::<Vec<_>>();
        commit::create(&self.0, state.head.as_deref(), "selected changes", &files)
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        if fs::remove_dir_all(&self.0).is_err() {
            eprintln!("Git test repository cleanup deferred");
        }
    }
}

#[test]
fn selected_commit_preserves_unrelated_staged_and_unstaged_content() {
    let repo = Repo::new(true);
    repo.write("one.txt", "selected\n");
    repo.write("two.txt", "staged\n");
    repo.git(&["add", "two.txt"]);
    repo.write("two.txt", "unstaged\n");
    repo.write("new [1].txt", "new file\n");
    repo.commit(&["one.txt", "new [1].txt"]).unwrap();
    assert_eq!(
        output(&repo.0, &["show", "HEAD:one.txt"]).unwrap(),
        "selected"
    );
    assert_eq!(output(&repo.0, &["show", "HEAD:two.txt"]).unwrap(), "two");
    assert_eq!(output(&repo.0, &["show", ":two.txt"]).unwrap(), "staged");
    assert_eq!(
        fs::read_to_string(repo.0.join("two.txt")).unwrap(),
        "unstaged\n"
    );
    let state = changes::read(&repo.0).unwrap();
    assert_eq!(state.files.len(), 1);
    assert_eq!(state.files[0].status, "MM");
}

#[test]
fn initial_commit_deletion_and_rename_work_with_literal_unicode_names() {
    let repo = Repo::new(false);
    repo.write("文件 [1].txt", "new\n");
    repo.write("other.txt", "keep\n");
    repo.git(&["add", "other.txt"]);
    repo.commit(&["文件 [1].txt"]).unwrap();
    assert_eq!(
        output(&repo.0, &["ls-tree", "--name-only", "HEAD"])
            .unwrap()
            .lines()
            .count(),
        1
    );
    repo.git(&["mv", "文件 [1].txt", "renamed.txt"]);
    repo.commit(&["renamed.txt"]).unwrap();
    fs::remove_file(repo.0.join("renamed.txt")).unwrap();
    repo.commit(&["renamed.txt"]).unwrap();
    assert!(output(&repo.0, &["ls-tree", "--name-only", "HEAD"])
        .unwrap()
        .is_empty());
    assert_eq!(output(&repo.0, &["show", ":other.txt"]).unwrap(), "keep");
}

#[test]
fn failed_hooks_preserve_the_index_and_worktree() {
    let repo = Repo::new(true);
    repo.write("one.txt", "selected\n");
    repo.write("two.txt", "staged\n");
    repo.git(&["add", "two.txt"]);
    let hook_dir = repo.0.join("hooks");
    fs::create_dir(&hook_dir).unwrap();
    fs::write(hook_dir.join("pre-commit"), "#!/bin/sh\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            hook_dir.join("pre-commit"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
    }
    repo.git(&["config", "core.hooksPath", hook_dir.to_str().unwrap()]);
    let head = changes::head(&repo.0);
    let staged = output(&repo.0, &["diff", "--cached"]).unwrap();
    assert!(matches!(repo.commit(&["one.txt"]), Err(GitError::Commit)));
    assert_eq!(changes::head(&repo.0), head);
    assert_eq!(output(&repo.0, &["diff", "--cached"]).unwrap(), staged);
    assert_eq!(
        fs::read_to_string(repo.0.join("one.txt")).unwrap(),
        "selected\n"
    );
    assert!(!repo.0.join(".git/index.lock").exists());
}

#[test]
fn rejects_stale_selections_paths_and_busy_index() {
    let repo = Repo::new(true);
    repo.write("one.txt", "selected\n");
    let state = changes::read(&repo.0).unwrap();
    let files = vec![SelectedFile {
        path: state.files[0].path.clone(),
        version: state.files[0].version.clone(),
    }];
    repo.write("one.txt", "changed since preview\n");
    assert!(matches!(
        commit::create(&repo.0, state.head.as_deref(), "message", &files),
        Err(GitError::Changed)
    ));
    repo.write(".git/index.lock", "owned elsewhere");
    assert!(matches!(repo.commit(&["one.txt"]), Err(GitError::Locked)));
    assert_eq!(
        fs::read_to_string(repo.0.join(".git/index.lock")).unwrap(),
        "owned elsewhere"
    );
    for path in [
        "../outside",
        "/outside",
        "C:/outside",
        ".git/config",
        "one/../../two",
        "a\\b",
    ] {
        assert!(validate_path(path).is_err());
    }
}

#[test]
fn history_contains_merge_parents_refs_and_diff() {
    let repo = Repo::new(true);
    repo.git(&["switch", "-c", "feature"]);
    repo.write("feature.txt", "feature\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-m", "feature"]);
    repo.git(&["switch", "main"]);
    repo.write("one.txt", "main\n");
    repo.git(&["commit", "-am", "main"]);
    repo.git(&["merge", "--no-ff", "feature", "-m", "merge"]);
    let history = serde_json::to_value(history::read(&repo.0, 0).unwrap()).unwrap();
    let first = &history["commits"][0];
    assert_eq!(first["subject"], "merge");
    assert_eq!(first["parents"].as_array().unwrap().len(), 2);
    assert!(first["refs"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "HEAD -> main"));
    let diff =
        serde_json::to_value(history::diff(&repo.0, "", first["hash"].as_str()).unwrap()).unwrap();
    assert!(diff["text"].as_str().unwrap().contains("+feature"));
    repo.write("新文件.txt", "new text\n");
    let diff = serde_json::to_value(history::diff(&repo.0, "新文件.txt", None).unwrap()).unwrap();
    assert!(diff["text"].as_str().unwrap().contains("+new text"));
}

#[test]
fn conflicts_cannot_be_selected_and_empty_history_is_supported() {
    let files = changes::parse(b"UU one.txt\0R  new.txt\0old.txt\0?? space name.txt\0").unwrap();
    assert!(files[0].conflict);
    assert_eq!(files[1].original_path.as_deref(), Some("old.txt"));
    assert_eq!(files[2].path, "space name.txt");
    let repo = Repo::new(false);
    let history = serde_json::to_value(history::read(&repo.0, 0).unwrap()).unwrap();
    assert_eq!(history["commits"], serde_json::json!([]));
}
