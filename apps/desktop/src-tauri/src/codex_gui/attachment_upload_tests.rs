use super::*;
use serde_json::json;

#[test]
fn phone_bytes_are_saved_inside_app_storage_and_not_forwarded_as_phone_paths() {
    let root = std::env::temp_dir().join(format!("csw-upload-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let mut request: GuiRequest = serde_json::from_value(json!({
        "operation": "send", "threadId": uuid::Uuid::new_v4().to_string(), "text": "", "images": [],
        "attachments": [{ "kind": "file", "name": "../../note.txt", "path": "", "data": "aGVsbG8=" }]
    })).unwrap();
    prepare_request(&mut request, &root).unwrap();
    let GuiRequest::Send {
        ref attachments, ..
    } = request
    else {
        panic!("send")
    };
    let target = Path::new(&attachments[0].path);
    assert!(target.canonicalize().unwrap().starts_with(&root));
    assert_eq!(fs::read(target).unwrap(), b"hello");
    assert!(attachments[0].data.is_none());
    let (_, params) = request.into_rpc().unwrap();
    assert!(params["input"].to_string().contains("note.txt"));
    assert!(!params["input"].to_string().contains("aGVsbG8="));
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_invalid_uploads_before_writing() {
    let root = std::env::temp_dir().join(format!("csw-invalid-upload-{}", uuid::Uuid::new_v4()));
    for attachment in [
        json!({"kind": "plugin", "name": "plugin", "path": "plugin://demo", "data": "aGVsbG8="}),
        json!({"kind": "file", "name": "note.txt", "path": "/user/file", "data": "aGVsbG8="}),
        json!({"kind": "file", "name": "note.txt", "path": "", "data": "!invalid!"}),
        json!({"kind": "file", "name": "note.txt", "path": "", "data": ""}),
        json!({"kind": "file", "name": "note.txt", "path": "", "data": "A".repeat(MAX_TOTAL_ENCODED_BYTES + 1)}),
    ] {
        let mut request = serde_json::from_value(json!({"operation": "send", "threadId": "unused",
            "text": "", "images": [], "attachments": [attachment]}))
        .unwrap();
        assert!(prepare_request(&mut request, &root).is_err());
        assert!(!root.exists());
    }
}
