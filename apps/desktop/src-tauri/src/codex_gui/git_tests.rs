use super::*;
use std::fs;

struct Repo(PathBuf);
impl Repo {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("csw-git-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        assert!(run(&root, &["init", "-b", "main"])
            .unwrap()
            .status
            .success());
        assert!(run(&root, &["config", "user.name", "Test"])
            .unwrap()
            .status
            .success());
        assert!(
            run(&root, &["config", "user.email", "test@example.invalid"])
                .unwrap()
                .status
                .success()
        );
        fs::write(root.join("file.txt"), "base\n").unwrap();
        assert!(run(&root, &["config", "core.autocrlf", "false"])
            .unwrap()
            .status
            .success());
        assert!(run(&root, &["add", "."]).unwrap().status.success());
        assert!(run(&root, &["commit", "-m", "initial"])
            .unwrap()
            .status
            .success());
        Self(root.canonicalize().unwrap())
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        // Git's read-only object files require writable attributes before cleanup on Windows.
        if fs::remove_dir_all(&self.0).is_err() {
            eprintln!("Test repository cleanup deferred");
        }
    }
}

#[test]
fn lists_switches_and_creates_branches_without_losing_dirty_files() {
    let repo = Repo::new();
    fs::write(repo.0.join("untracked.txt"), "keep").unwrap();
    switch(&repo.0, "feature/test", true).unwrap();
    let state = status(&repo.0).unwrap();
    assert_eq!(state.branch.as_deref(), Some("feature/test"));
    assert_eq!(state.changed_files, 1);
    assert_eq!(state.branches.len(), 2);
    switch(&repo.0, "main", false).unwrap();
    assert_eq!(
        fs::read_to_string(repo.0.join("untracked.txt")).unwrap(),
        "keep"
    );
}

#[test]
fn refuses_checkout_that_would_overwrite_local_changes() {
    let repo = Repo::new();
    switch(&repo.0, "feature", true).unwrap();
    fs::write(repo.0.join("file.txt"), "branch\n").unwrap();
    run(&repo.0, &["commit", "-am", "change"]).unwrap();
    switch(&repo.0, "main", false).unwrap();
    fs::write(repo.0.join("file.txt"), "local\n").unwrap();
    assert!(matches!(
        switch(&repo.0, "feature", false),
        Err(GitError::Checkout)
    ));
    assert_eq!(
        fs::read_to_string(repo.0.join("file.txt")).unwrap(),
        "local\n"
    );
}

#[test]
fn creates_independent_worktree_and_marks_occupied_branches() {
    let repo = Repo::new();
    let storage = repo.0.join("trees");
    fs::write(repo.0.join("file.txt"), "local\n").unwrap();
    let target = create_worktree(&repo.0, &storage, "parallel").unwrap();
    assert_eq!(
        fs::read_to_string(target.join("file.txt")).unwrap(),
        "base\n"
    );
    assert_eq!(status(&repo.0).unwrap().branch.as_deref(), Some("main"));
    assert!(status(&target).unwrap().is_worktree);
    assert!(status(&repo.0)
        .unwrap()
        .branches
        .iter()
        .any(|branch| branch.name == "parallel" && branch.occupied));
    assert!(switch(&repo.0, "parallel", false).is_err());
    assert!(create_worktree(&repo.0, &storage, "parallel").is_err());
}

#[test]
fn validates_names_and_counts_renames_once() {
    let repo = Repo::new();
    for branch in ["-f", "../bad", "@{-1}", "bad\nname", "HEAD"] {
        assert!(validate_branch(&repo.0, branch).is_err(), "{branch}");
    }
    assert_eq!(count_changes(b"R  new\0old\0?? another\0 M file\0"), 3);
}

#[test]
fn inherited_checkout_environment_does_not_redirect_git_operations() {
    let result = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "codex_gui::git::tests::creates_independent_worktree_and_marks_occupied_branches",
        ])
        .env("GIT_INDEX_FILE", ".git/index")
        .env("GIT_DIR", "missing-parent-checkout")
        .env("GIT_WORK_TREE", "missing-parent-worktree")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stdout)
    );
}
