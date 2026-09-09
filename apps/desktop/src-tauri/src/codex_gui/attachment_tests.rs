use super::protocol::GuiRequest;
use serde_json::{json, Value};

fn rpc(value: Value) -> super::error::Result<(&'static str, Value)> {
    serde_json::from_value::<GuiRequest>(value)
        .unwrap()
        .into_rpc()
}

#[test]
fn goal_operations_validate_thread_and_objective_without_creating_a_budget() {
    let (method, params) = rpc(json!({"operation": "goalSet", "threadId": "one",
        "objective": "  Complete the project  ", "status": "active"}))
    .unwrap();
    assert_eq!(method, "thread/goal/set");
    assert_eq!(
        params,
        json!({"threadId": "one", "objective": "Complete the project", "status": "active"})
    );
    for operation in ["goalGet", "goalClear"] {
        assert!(rpc(json!({"operation": operation, "threadId": "../bad"})).is_err());
        assert!(rpc(json!({"operation": operation, "threadId": "one"})).is_ok());
    }
    for objective in [String::new(), "x".repeat(16_001), "bad\0goal".to_string()] {
        assert!(rpc(
            json!({"operation": "goalSet", "threadId": "one", "objective": objective,
            "status": "active"})
        )
        .is_err());
    }
    let (_, paused) =
        rpc(json!({"operation": "goalSet", "threadId": "one", "status": "paused"})).unwrap();
    assert!(paused.get("objective").is_none());
}

#[test]
fn attachments_survive_single_batch_and_steering_turns() {
    let root = std::env::temp_dir().join(format!("codex-gui-attachments-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("notes.txt");
    std::fs::write(&path, "reference").unwrap();
    let attachments = json!([
        {"kind": "file", "name": "notes.txt", "path": path},
        {"kind": "folder", "name": "project", "path": root},
        {"kind": "plugin", "name": "Documents", "path": "plugin://documents@openai"}
    ]);
    let message = json!({"text": "", "images": [], "attachments": attachments});
    for operation in ["send", "steer", "sendBatch"] {
        let mut request = message.clone();
        request["operation"] = json!(operation);
        request["threadId"] = json!("one");
        request["turnId"] = json!("turn");
        request["messages"] = json!([message]);
        let (_, params) = rpc(request).unwrap();
        assert_eq!(
            params["input"][1]["text"],
            format!("文件：{}", path.display())
        );
        assert_eq!(
            params["input"][2]["text"],
            format!("文件夹：{}", root.display())
        );
        assert_eq!(params["input"][4]["type"], "mention");
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_and_excess_attachments_are_rejected() {
    for attachment in [
        json!({"kind": "file", "name": "file", "path": "relative.txt"}),
        json!({"kind": "folder", "name": "folder", "path": "missing"}),
        json!({"kind": "plugin", "name": "plugin", "path": "https://example.com"}),
        json!({"kind": "plugin", "name": "plugin", "path": "plugin://../../bad"}),
    ] {
        assert!(rpc(
            json!({"operation": "send", "threadId": "one", "text": "", "images": [],
            "attachments": [attachment]})
        )
        .is_err());
    }
    let attachments =
        vec![json!({"kind": "plugin", "name": "plugin", "path": "plugin://valid"}); 33];
    assert!(rpc(
        json!({"operation": "send", "threadId": "one", "text": "", "images": [],
        "attachments": attachments})
    )
    .is_err());
}

#[test]
fn file_picker_images_use_image_input_and_share_the_image_limit() {
    let root = std::env::temp_dir().join(format!(
        "codex-gui-image-attachment-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("image.png");
    std::fs::write(&path, include_bytes!("../../icons/32x32.png")).unwrap();
    let attachment = json!({"kind": "file", "name": "image.png", "path": path});
    let (_, params) = rpc(
        json!({"operation": "send", "threadId": "one", "text": "", "images": [],
        "attachments": [attachment]}),
    )
    .unwrap();
    assert_eq!(params["input"][1]["type"], "localImage");
    assert!(rpc(
        json!({"operation": "send", "threadId": "one", "text": "", "images": [],
        "attachments": vec![attachment; 9]})
    )
    .is_err());
    std::fs::write(&path, []).unwrap();
    assert!(
        rpc(json!({"operation": "send", "threadId": "one", "text": "", "images": [path]})).is_err()
    );
    std::fs::remove_dir_all(root).unwrap();
}
