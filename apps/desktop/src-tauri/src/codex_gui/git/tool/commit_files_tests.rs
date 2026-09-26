use super::{changes, commit_files, history, tests::Repo, GitError};
use serde_json::{json, to_value};
use std::fs;

fn files(repo: &Repo) -> serde_json::Value {
    to_value(commit_files::read(&repo.0, &changes::head(&repo.0).unwrap()).unwrap()).unwrap()
}

fn diff(repo: &Repo, path: &str) -> String {
    to_value(history::diff(&repo.0, path, changes::head(&repo.0).as_deref()).unwrap()).unwrap()
        ["text"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn root_and_empty_commits_have_complete_file_lists() {
    let repo = Repo::new(true);
    assert_eq!(
        files(&repo),
        json!([
            { "path": "one.txt", "originalPath": null, "status": "A" },
            { "path": "two.txt", "originalPath": null, "status": "A" },
        ])
    );
    let patch = diff(&repo, "one.txt");
    assert!(patch.contains("+one"));
    assert!(!patch.contains("two.txt"));
    repo.git(&["commit", "--allow-empty", "-m", "empty"]);
    assert_eq!(files(&repo), json!([]));
}

#[test]
fn lists_modified_deleted_and_binary_files_and_filters_each_diff() {
    let repo = Repo::new(true);
    repo.write("one.txt", "modified\n");
    fs::remove_file(repo.0.join("two.txt")).unwrap();
    repo.write("新文件 [1].txt", "new text\n");
    fs::write(repo.0.join("image.bin"), [0, 1, 2, 0, 3]).unwrap();
    repo.git(&["add", "."]);
    repo.git(&["commit", "-m", "changes"]);
    let list = files(&repo);
    assert_eq!(list.as_array().unwrap().len(), 4);
    assert!(list
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == "two.txt" && file["status"] == "D"));
    let patch = diff(&repo, "新文件 [1].txt");
    assert!(patch.contains("+new text"));
    assert!(!patch.contains("modified"));
    assert!(diff(&repo, "two.txt").contains("-two"));
    assert!(diff(&repo, "image.bin").contains("Binary files"));
}

#[test]
fn rename_diff_includes_the_original_path_without_unrelated_changes() {
    let repo = Repo::new(true);
    repo.git(&["mv", "one.txt", "改名 [1].txt"]);
    repo.write("two.txt", "unrelated\n");
    repo.git(&["commit", "-am", "rename"]);
    let list = files(&repo);
    assert!(list.as_array().unwrap().iter().any(|file| file
        == &json!({
            "path": "改名 [1].txt", "originalPath": "one.txt", "status": "R"
        })));
    let patch = diff(&repo, "改名 [1].txt");
    assert!(patch.contains("rename from one.txt"));
    assert!(!patch.contains("two.txt"));
}

#[test]
fn merge_files_and_diff_use_the_same_first_parent() {
    let repo = Repo::new(true);
    repo.git(&["switch", "-c", "feature"]);
    repo.write("feature.txt", "feature\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-m", "feature"]);
    repo.git(&["switch", "main"]);
    repo.write("one.txt", "main\n");
    repo.git(&["commit", "-am", "main"]);
    repo.git(&["merge", "--no-ff", "feature", "-m", "merge"]);
    assert_eq!(
        files(&repo),
        json!([{ "path": "feature.txt", "originalPath": null, "status": "A" }])
    );
    assert!(diff(&repo, "feature.txt").contains("+feature"));
}

#[test]
fn rejects_invalid_commit_paths_and_incomplete_records() {
    let repo = Repo::new(true);
    assert!(commit_files::read(&repo.0, "--all").is_err());
    assert!(commit_files::read(&repo.0, &"0".repeat(40)).is_err());
    assert!(history::diff(&repo.0, "../outside", changes::head(&repo.0).as_deref()).is_err());
    assert!(matches!(
        history::diff(&repo.0, "missing.txt", changes::head(&repo.0).as_deref()),
        Err(GitError::File)
    ));
    assert!(commit_files::parse(b"R100\0old.txt\0").is_err());
    assert!(commit_files::parse(b"M\0../outside\0").is_err());
    let parsed = to_value(commit_files::parse(b"R100\0old\tname\0new\nname\0").unwrap()).unwrap();
    assert_eq!(parsed[0]["path"], "new\nname");
    assert_eq!(parsed[0]["originalPath"], "old\tname");
}
