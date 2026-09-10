use super::*;
use std::{fs, path::Path};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("gui-file-actions-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn target(path: &str) -> FileTarget {
    FileTarget {
        path: path.into(),
        thread_id: None,
        line: Some(12),
        column: Some(3),
    }
}

#[test]
fn rejects_network_device_url_and_control_paths() {
    for path in [
        "",
        "//server/share.txt",
        r"\\server\share.txt",
        "https://host/a.txt",
        "a\0.txt",
        "a\n.txt",
    ] {
        assert!(paths::source(&target(path)).is_err(), "{path:?}");
    }
    #[cfg(windows)]
    for path in [
        r"\\?\C:\secret.txt",
        "C:/file.txt:stream",
        "C:relative.txt",
        "NUL.txt",
        "src/COM1",
        "/root/a",
    ] {
        assert!(paths::source(&target(path)).is_err(), "{path}");
    }
    let mut invalid_line = target("readme.md");
    invalid_line.line = Some(0);
    assert!(paths::source(&invalid_line).is_err());
}

#[test]
fn resolves_relative_files_using_the_task_workspace_and_keeps_missing_paths_copyable() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("报告 space.txt"), "contents").unwrap();
    let path = paths::resolve(Path::new("报告 space.txt"), &fixture.0, false).unwrap();
    assert_eq!(read_text(&path).unwrap(), "contents");
    assert!(paths::resolve(Path::new("deleted.txt"), &fixture.0, false).is_err());
    assert!(paths::resolve(Path::new("deleted.txt"), &fixture.0, true).is_ok());
    assert!(paths::resolve(Path::new("relative.txt"), Path::new(""), true).is_err());
}

#[test]
fn copies_empty_and_utf8_text_but_rejects_binary_directories_and_large_files() {
    let fixture = Fixture::new();
    let path = fixture.0.join("file.txt");
    for content in ["", "中文\ntext"] {
        fs::write(&path, content).unwrap();
        assert_eq!(read_text(&path).unwrap(), content);
    }
    for bytes in [
        vec![0xff, 0xfe],
        b"binary\0data".to_vec(),
        vec![b'a'; 2 * 1024 * 1024 + 1],
    ] {
        fs::write(&path, bytes).unwrap();
        assert!(read_text(&path).is_err());
    }
    assert!(read_text(&fixture.0).is_err());
}

#[test]
fn only_known_applications_and_actions_cross_ipc() {
    assert!(serde_json::from_value::<FileRequest>(serde_json::json!({
        "target": {"path": "file.txt"}, "action": {"type": "open", "application": "powershell -Command bad"}
    })).is_err());
    assert!(serde_json::from_value::<FileRequest>(serde_json::json!({
        "target": {"path": "file.txt"}, "action": {"type": "saveAs", "destination": "anything"}
    }))
    .is_err());
}

#[test]
fn editor_arguments_preserve_spaces_metacharacters_and_line_numbers() {
    use apps::ApplicationId;
    let mut command = std::process::Command::new("editor");
    let path = Path::new("report space & $(value).txt");
    apps::editor_arguments(
        &mut command,
        ApplicationId::Vscode,
        path,
        &target("ignored"),
    );
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        ["--goto", "report space & $(value).txt:12:3"]
    );
    let mut command = std::process::Command::new("editor");
    apps::editor_arguments(&mut command, ApplicationId::Idea, path, &target("ignored"));
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        ["--line", "12", "report space & $(value).txt"]
    );
}

#[cfg(windows)]
#[test]
fn terminal_uses_working_directory_without_executing_the_file() {
    let fixture = Fixture::new();
    let path = fixture.0.join("report & echo dangerous.txt");
    fs::write(&path, "safe").unwrap();
    let command = windows::command(
        apps::ApplicationId::Terminal,
        Path::new("powershell.exe"),
        &path,
        &target("ignored"),
    )
    .unwrap();
    assert_eq!(command.get_current_dir(), Some(fixture.0.as_path()));
    assert_eq!(command.get_args().collect::<Vec<_>>(), ["-NoLogo"]);
}
