use super::protocol::{approval_response, ApprovalReply, GuiEvent, GuiRequest};
use serde_json::json;

fn request(value: serde_json::Value) -> GuiRequest {
    serde_json::from_value(value).expect("valid test request")
}

#[test]
fn only_supported_operations_cross_the_boundary() {
    assert!(serde_json::from_value::<GuiRequest>(
        json!({"operation": "execute", "command": "whoami"})
    )
    .is_err());
    assert!(
        request(json!({"operation": "read", "threadId": "../../auth.json"}))
            .into_rpc()
            .is_err()
    );
}

#[test]
fn reads_include_history_and_lists_include_all_providers() {
    let (method, params) = request(json!({"operation": "read", "threadId": "thread-1"}))
        .into_rpc()
        .unwrap();
    assert_eq!(method, "thread/read");
    assert_eq!(params["includeTurns"], true);
    let (_, params) = request(json!({"operation": "list", "archived": true}))
        .into_rpc()
        .unwrap();
    assert_eq!(params["archived"], true);
    assert_eq!(params["modelProviders"], json!([]));
}

#[test]
fn empty_turns_and_invalid_image_paths_are_rejected() {
    for (text, images) in [(" ", json!([])), ("hello", json!(["relative.png"]))] {
        assert!(request(
            json!({"operation": "send", "threadId": "thread-1", "text": text,
            "images": images})
        )
        .into_rpc()
        .is_err());
    }
}

#[test]
fn user_input_stays_in_a_structured_turn() {
    let (_, params) = request(json!({"operation": "send", "threadId": "thread-1",
        "text": "$(do-not-execute)", "images": [], "effort": "high"}))
    .into_rpc()
    .unwrap();
    assert_eq!(params["input"][0]["text"], "$(do-not-execute)");
    assert_eq!(params["effort"], "high");
}

#[test]
fn pasted_images_are_sent_inline_even_without_text() {
    let image = concat!(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC",
        "AAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII="
    );
    let (method, params) = request(json!({"operation": "send", "threadId": "thread-1",
        "text": "", "images": [image]}))
    .into_rpc()
    .unwrap();
    assert_eq!(method, "turn/start");
    assert_eq!(params["input"][1], json!({"type": "image", "url": image}));
}

#[test]
fn invalid_inline_images_and_excess_attachments_are_rejected() {
    for images in [
        json!(["data:image/svg+xml;base64,PHN2Zz4="]),
        json!(["data:image/png;base64,not base64"]),
        json!(["data:image/png;base64,aGVsbG8="]),
        json!(["data:image/jpeg;base64,iVBORw0KGgo="]),
        json!(["data:image/png;base64,"]),
        json!(["https://example.com/image.png"]),
        json!(vec!["data:image/png;base64,iVBORw0KGgo="; 9]),
    ] {
        assert!(request(json!({"operation": "send", "threadId": "thread-1",
            "text": "", "images": images}))
        .into_rpc()
        .is_err());
    }
}

#[test]
fn approvals_do_not_allow_unoffered_decisions() {
    let event = GuiEvent {
        method: "item/commandExecution/requestApproval".into(),
        params: json!({"availableDecisions": ["decline", "cancel"]}),
        id: Some(json!(12)),
    };
    let reply: ApprovalReply =
        serde_json::from_value(json!({"id": 12, "decision": "accept"})).unwrap();
    assert!(approval_response(&event, reply).is_err());
}

#[test]
fn resume_explicitly_restores_user_review_and_sandbox() {
    let (method, params) = request(json!({"operation": "resume", "threadId": "thread-1",
        "access": "workspace-write"}))
    .into_rpc()
    .unwrap();
    assert_eq!(method, "thread/resume");
    assert_eq!(params["approvalPolicy"], "on-request");
    assert_eq!(params["sandbox"], "workspace-write");
}

#[test]
fn gui_home_imports_only_config_and_auth_and_preserves_its_history() {
    let root = std::env::temp_dir().join(format!("codex-gui-home-test-{}", uuid::Uuid::new_v4()));
    let source = root.join("official");
    let target = root.join("dev.codex.switch/.codex");
    std::fs::create_dir_all(source.join("sessions")).unwrap();
    std::fs::create_dir_all(target.join("sessions")).unwrap();
    std::fs::write(
        source.join("config.toml"),
        "model = 'sample'\nsqlite_home = 'C:/official'\n",
    )
    .unwrap();
    std::fs::write(source.join("auth.json"), "{\"test\":true}").unwrap();
    std::fs::write(source.join("sessions/official.jsonl"), "official").unwrap();
    std::fs::write(source.join("state_5.sqlite"), "official database").unwrap();
    std::fs::write(target.join("sessions/gui.jsonl"), "gui").unwrap();
    super::home::prepare_from(&source, &target).unwrap();
    assert!(!target.join("sessions/official.jsonl").exists());
    assert!(!target.join("state_5.sqlite").exists());
    assert_eq!(
        std::fs::read_to_string(target.join("sessions/gui.jsonl")).unwrap(),
        "gui"
    );
    let config = std::fs::read_to_string(target.join("config.toml")).unwrap();
    let document: toml_edit::DocumentMut = config.parse().unwrap();
    assert_eq!(
        std::path::Path::new(document["sqlite_home"].as_str().unwrap()),
        target.canonicalize().unwrap()
    );
    assert_eq!(
        std::fs::read_to_string(source.join("sessions/official.jsonl")).unwrap(),
        "official"
    );
    assert!(super::home::prepare_from(&source, &source).is_err());
    std::fs::remove_file(source.join("auth.json")).unwrap();
    super::home::prepare_from(&source, &target).unwrap();
    assert!(!target.join("auth.json").exists());
    assert!(root.starts_with(std::env::temp_dir()));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn permission_approval_cannot_grant_more_than_the_server_requested() {
    let event = GuiEvent {
        method: "item/permissions/requestApproval".into(),
        params: json!({"permissions": {"network": {"enabled": true}}}),
        id: Some(json!(1)),
    };
    let reply: ApprovalReply = serde_json::from_value(json!({"id": 1, "decision": "accept",
        "permissions": {"fileSystem": {"write": ["C:/"]}}}))
    .unwrap();
    assert_eq!(
        approval_response(&event, reply).unwrap(),
        json!({"permissions": {"network": {"enabled": true}}, "scope": "turn"})
    );
}
