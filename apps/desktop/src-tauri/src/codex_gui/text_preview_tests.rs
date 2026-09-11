use super::*;
use std::{fs, path::PathBuf};

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
        vec![b'a'; MAX_TEXT_BYTES as usize + 1],
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
