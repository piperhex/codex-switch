use super::*;

fn edit() -> EditRequest {
    serde_json::from_value(
        json!({"threadId": "thread", "turnId": "last", "itemId": "question",
        "text": "修改后的问题", "access": "read-only"}),
    )
    .unwrap()
}

fn history() -> Value {
    json!({"id": "thread", "status": {"type": "idle"}, "turns": [
        {"id": "first", "status": "completed", "items": [
            {"id": "old", "type": "userMessage", "content": [{"type": "text", "text": "早先的问题"}]}]},
        {"id": "last", "status": "completed", "items": [
            {"id": "question", "type": "userMessage", "content": [
                {"type": "text", "text": "原问题"}, {"type": "text", "text": "更多文字"},
                {"type": "localImage", "path": "D:/photo.png"},
                {"type": "image", "url": "https://example.com/image.png"},
                {"type": "skill", "name": "skill", "path": "D:/SKILL.md"},
                {"type": "mention", "name": "plugin", "path": "plugin://example"}]},
            {"id": "answer", "type": "agentMessage", "text": "旧回复"}]}]})
}

#[test]
fn edit_replaces_all_text_and_preserves_every_attachment() {
    let source = history();
    let input = edited_input(&source, &edit()).unwrap();
    assert_eq!(input.len(), 5);
    assert_eq!(input[0]["text"], "修改后的问题");
    assert_eq!(input[0]["text_elements"], json!([]));
    assert_eq!(
        &input[1..],
        &source["turns"][1]["items"][0]["content"]
            .as_array()
            .unwrap()[2..]
    );
    assert_eq!(
        source["turns"][1]["items"][0]["content"][0]["text"],
        "原问题"
    );
}

#[test]
fn edit_rejects_stale_targets_and_running_threads() {
    let mut request = edit();
    request.item_id = "old".into();
    assert!(edited_input(&history(), &request).is_err());
    request = edit();
    request.turn_id = "first".into();
    assert!(edited_input(&history(), &request).is_err());
    let mut source = history();
    source["turns"][1]["status"] = json!("inProgress");
    assert!(edited_input(&source, &edit()).is_err());
    source = history();
    source["status"]["type"] = json!("active");
    assert!(edited_input(&source, &edit()).is_err());
}

#[test]
fn editing_a_steering_message_keeps_earlier_user_inputs() {
    let mut source = history();
    source["turns"][1]["items"]
        .as_array_mut()
        .unwrap()
        .push(json!({
        "id": "steering", "type": "userMessage", "content": [{"type": "text", "text": "补充"}]}));
    let mut request = edit();
    request.item_id = "steering".into();
    let input = edited_input(&source, &request).unwrap();
    assert_eq!(input[0]["text"], "原问题");
    assert_eq!(input.last().unwrap()["text"], "修改后的问题");
    assert!(edited_input(&source, &edit()).is_err());
}

#[test]
fn hidden_continue_instructions_do_not_replace_the_last_editable_message() {
    let mut source = history();
    source["turns"][1]["status"] = json!("interrupted");
    source["turns"].as_array_mut().unwrap().push(
        json!({"id": "continuation", "status": "completed",
        "items": [{"id": "continue", "type": "userMessage",
            "content": [{"type": "text", "text": CONTINUE_MESSAGE}]}]}),
    );
    assert!(edited_input(&source, &edit()).is_ok());
}

#[test]
fn edit_requests_validate_text_and_identifiers() {
    for text in [
        "".to_owned(),
        "  \n ".to_owned(),
        "a".repeat(MAX_EDIT_BYTES + 1),
    ] {
        let mut request = edit();
        request.text = text;
        assert!(validate(&request).is_err());
    }
    for field in ["threadId", "turnId", "itemId"] {
        let mut value = json!({"operation": "editMessage", "threadId": "thread", "turnId": "last",
            "itemId": "question", "text": "hello", "access": "read-only"});
        value[field] = json!("../invalid");
        let GuiRequest::EditMessage(request) = serde_json::from_value(value).unwrap() else {
            panic!()
        };
        assert!(validate(&request).is_err());
    }
    assert!(validate(&edit()).is_ok());
}
