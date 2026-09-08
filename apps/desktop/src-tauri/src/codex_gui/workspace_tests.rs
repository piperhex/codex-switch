use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("codex-gui-workspace-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self(root.canonicalize().unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self
            .0
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn prepare(value: Value, root: &Path) -> Result<Value> {
    let mut request: GuiRequest = serde_json::from_value(value).unwrap();
    prepare_request(&mut request, root)?;
    request.into_rpc().map(|(_, params)| params)
}

#[test]
fn new_projectless_chats_get_separate_workspaces() {
    let fixture = Fixture::new();
    let input = json!({"operation": "start", "access": "workspace-write"});
    let first = prepare(input.clone(), &fixture.0).unwrap();
    let second = prepare(input, &fixture.0).unwrap();
    let path = Path::new(first["cwd"].as_str().unwrap());
    assert!(path.is_dir());
    assert!(path.canonicalize().unwrap().starts_with(&fixture.0));
    assert_ne!(first["cwd"], second["cwd"]);
}

#[test]
fn removing_a_project_reuses_the_threads_scratch_folder_without_deleting_the_project() {
    let fixture = Fixture::new();
    let project = fixture.0.join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("keep.txt"), "keep me").unwrap();
    let thread_id = uuid::Uuid::new_v4().to_string();
    let input = json!({"operation": "send", "threadId": thread_id, "text": "hello", "images": [], "cwd": ""});
    let first = prepare(input.clone(), &fixture.0).unwrap();
    let second = prepare(input, &fixture.0).unwrap();
    assert_eq!(first["cwd"], second["cwd"]);
    let resumed = prepare(
        json!({"operation": "resume", "threadId": thread_id,
        "access": "workspace-write", "cwd": ""}),
        &fixture.0,
    )
    .unwrap();
    assert_eq!(resumed["cwd"], first["cwd"]);
    assert_eq!(
        Path::new(first["cwd"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        fixture.0.join(thread_id)
    );
    assert_eq!(
        fs::read_to_string(project.join("keep.txt")).unwrap(),
        "keep me"
    );
}

#[test]
fn invalid_selected_paths_are_not_silently_treated_as_projectless() {
    let fixture = Fixture::new();
    assert!(prepare(
        json!({"operation": "start", "cwd": "../project", "access": "read-only"}),
        &fixture.0
    )
    .is_err());
    assert!(prepare(
        json!({"operation": "send", "threadId": "../escape", "cwd": "",
        "text": "hello", "images": []}),
        &fixture.0
    )
    .is_err());
}

#[test]
fn private_paths_are_hidden_in_history_and_events_without_hiding_neighboring_projects() {
    let fixture = Fixture::new();
    let private = fixture.0.join("workspaces");
    let mut response = json!({"thread": {"cwd": private.join("chat"), "preview": "hello"}, "data": [
        {"cwd": private.join("chat")}, {"cwd": fixture.0.join("workspaces-other")}, {"cwd": fixture.0}
    ]});
    hide_project_paths(&mut response, &private);
    assert_eq!(response["thread"]["cwd"], "");
    assert_eq!(response["thread"]["preview"], "hello");
    assert_eq!(response["data"][0]["cwd"], "");
    assert_ne!(response["data"][1]["cwd"], "");
    assert_ne!(response["data"][2]["cwd"], "");
}

#[test]
#[cfg(windows)]
fn projection_accepts_windows_case_and_separator_variants() {
    let root = Path::new(r"\\?\C:\Users\User\AppData\codex-gui-workspaces");
    let mut event = json!({"thread": {"cwd": "c:/users/user/appdata/codex-gui-workspaces/chat"}});
    hide_project_paths(&mut event, root);
    assert_eq!(event["thread"]["cwd"], "");
}
