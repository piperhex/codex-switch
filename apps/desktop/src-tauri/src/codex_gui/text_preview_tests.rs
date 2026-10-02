use super::*;
use std::{fs, path::PathBuf};

#[test]
fn applies_configured_limit_to_utf8_bytes() {
    let fixture = Fixture::new();
    fs::write(fixture.root().join("small.txt"), "中文").unwrap();
    assert!(read_text_limited(&fixture.root(), "small.txt", 6).is_ok());
    assert!(read_text_limited(&fixture.root(), "small.txt", 5).is_err());
}

#[test]
fn reads_text_above_the_default_with_a_larger_configured_limit() {
    let fixture = Fixture::new();
    let text = "a".repeat(DEFAULT_TEXT_BYTES as usize + 1);
    fs::write(fixture.root().join("large.txt"), &text).unwrap();
    assert!(read_text(&fixture.root(), "large.txt").is_err());
    for limit in [text.len() as u64, u64::MAX] {
        assert_eq!(
            read_text_limited(&fixture.root(), "large.txt", limit)
                .unwrap()
                .text,
            text
        );
    }
}

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("csw-text-preview-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(path.join("project")).unwrap();
        Self(path)
    }
    fn root(&self) -> PathBuf {
        self.0.join("project")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.0.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn edited_thread(fixture: &Fixture, changes: Value) -> Value {
    json!({"cwd": fixture.root(), "turns": [{"items": [{
        "type": "fileChange", "status": "completed", "changes": changes
    }]}]})
}

#[test]
fn previews_exact_external_edits_without_granting_access_to_siblings_or_other_threads() {
    let fixture = Fixture::new();
    let source = fixture.0.join("legacyLinkFailures.test.ts");
    let sibling = fixture.0.join("unrelated.ts");
    let text = "const ready = true;\n";
    fs::write(&source, text).unwrap();
    fs::write(&sibling, "private").unwrap();
    let path = source.to_str().unwrap();
    let thread = edited_thread(&fixture, json!([{"path": path, "kind": {"type": "add"}}]));
    assert!(read_text(&fixture.root(), path).is_err());
    for path in [path.to_owned(), path.replace('\\', "/")] {
        assert_eq!(read_thread_text(&thread, &path, 1024).unwrap().text, text);
    }
    assert!(read_thread_text(&thread, sibling.to_str().unwrap(), 1024).is_err());
    assert!(read_thread_text(&edited_thread(&fixture, json!([])), path, 1024).is_err());
}

#[test]
fn previews_renamed_destination_and_relative_external_edits() {
    let fixture = Fixture::new();
    for name in ["before.ts", "after.ts", "updated.ts"] {
        fs::write(fixture.0.join(name), "source").unwrap();
    }
    let thread = edited_thread(
        &fixture,
        json!([
            {"path": "../before.ts", "kind": {"type": "update", "movePath": "../after.ts"}},
            {"path": "../updated.ts", "kind": {"type": "update"}}
        ]),
    );
    assert!(read_thread_text(&thread, "../before.ts", 1024).is_err());
    for path in ["../after.ts", "../updated.ts"] {
        assert_eq!(
            read_thread_text(&thread, path, 1024).unwrap().text,
            "source"
        );
    }
}

#[test]
fn ignores_failed_pending_deleted_and_unstructured_file_references() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("outside.ts"), "private").unwrap();
    let change = json!({"path": "../outside.ts", "kind": {"type": "add"}});
    let items = [
        json!({"type": "fileChange", "status": "failed", "changes": [change]}),
        json!({"type": "fileChange", "status": "inProgress", "changes": [change]}),
        json!({"type": "fileChange", "status": "completed", "changes": [
            {"path": "../outside.ts", "kind": {"type": "delete"}}
        ]}),
        json!({"type": "agentMessage", "text": "[source](../outside.ts)", "changes": [change]}),
        json!({"type": "mcpToolCall", "arguments": {"path": "../outside.ts"}}),
    ];
    for item in items {
        let thread = json!({"cwd": fixture.root(), "turns": [{"items": [item]}]});
        assert!(read_thread_text(&thread, "../outside.ts", 1024).is_err());
    }
}

#[test]
fn external_edits_still_require_readable_utf8_files_within_the_byte_limit() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("binary.ts"), [0, 1, 2]).unwrap();
    fs::write(fixture.0.join("invalid.ts"), [0xff]).unwrap();
    fs::write(fixture.0.join("large.ts"), "中文").unwrap();
    let paths = [
        "../binary.ts",
        "../invalid.ts",
        "../large.ts",
        "../missing.ts",
        "..",
    ];
    let changes: Vec<_> = paths
        .iter()
        .map(|path| json!({"path": path, "kind": {"type": "add"}}))
        .collect();
    let thread = edited_thread(&fixture, json!(changes));
    for path in paths {
        assert!(read_thread_text(&thread, path, 5).is_err(), "{path}");
    }
    assert_eq!(
        read_thread_text(&thread, "../large.ts", 6).unwrap().text,
        "中文"
    );
}

#[test]
fn reads_full_utf8_and_empty_files() {
    let fixture = Fixture::new();
    let text = "第一行\r\nconst value = 1;\n";
    fs::write(fixture.root().join("中文.txt"), text).unwrap();
    assert_eq!(read_text(&fixture.root(), "中文.txt").unwrap().text, text);
    fs::write(fixture.root().join("empty"), "").unwrap();
    assert_eq!(read_text(&fixture.root(), "empty").unwrap().text, "");
}

#[test]
fn rejects_escape_binary_large_missing_and_directory_targets() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("outside.txt"), "private").unwrap();
    fs::write(fixture.root().join("binary"), [0, 1, 2]).unwrap();
    fs::write(fixture.root().join("invalid"), [0xff]).unwrap();
    fs::write(
        fixture.root().join("large"),
        vec![b'a'; DEFAULT_TEXT_BYTES as usize + 1],
    )
    .unwrap();
    for path in [
        "../outside.txt",
        "binary",
        "invalid",
        "large",
        "missing",
        ".",
    ] {
        assert!(read_text(&fixture.root(), path).is_err(), "{path}");
    }
    assert!(read_text(
        &fixture.root(),
        fixture.0.join("outside.txt").to_str().unwrap()
    )
    .is_err());
}

#[test]
fn rejects_urls_network_shares_device_paths_and_streams() {
    for path in [
        "",
        "https://host/a",
        "file:///a",
        "//host/a",
        "\\\\host\\a",
        "\\\\?\\C:\\a",
        "C:relative",
        "C:/a:stream",
        "a\0b",
        "a\nb",
    ] {
        assert!(validate_path(path).is_err(), "{path}");
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlinks_outside_workspace() {
    let fixture = Fixture::new();
    let outside = fixture.0.join("outside.txt");
    fs::write(&outside, "private").unwrap();
    std::os::unix::fs::symlink(outside, fixture.root().join("link")).unwrap();
    assert!(read_text(&fixture.root(), "link").is_err());
}
