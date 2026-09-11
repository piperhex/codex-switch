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
    assert_eq!(rollback_params(&source, &edit()).unwrap()["numTurns"], 2);
}

#[test]
fn rollback_keeps_the_thread_and_removes_only_the_edited_suffix() {
    assert_eq!(
        rollback_params(&history(), &edit()).unwrap(),
        json!({"threadId": "thread", "numTurns": 1})
    );
    let mut source = history();
    source["turns"].as_array_mut().unwrap().remove(0);
    source["turns"][0]["status"] = json!("interrupted");
    source["turns"][0]["items"].as_array_mut().unwrap().pop();
    assert!(edited_input(&source, &edit()).is_ok());
    assert_eq!(rollback_params(&source, &edit()).unwrap()["numTurns"], 1);
    source["turns"] = json!([]);
    assert!(rollback_params(&source, &edit()).is_err());
}

#[tokio::test]
async fn editing_resumes_rolls_back_and_sends_on_the_original_thread() {
    let mut calls = Vec::new();
    let result = replace_message(&edit(), json!({"threadId": "thread"}), |method, params| {
        calls.push((method, params));
        std::future::ready(Ok(match method {
            "thread/resume" => json!({"thread": history()}),
            "thread/rollback" => {
                json!({"thread": {"id": "thread", "turns": [history()["turns"][0]]}})
            }
            "turn/start" => json!({"turn": {"id": "replacement"}}),
            _ => panic!("unexpected operation: {method}"),
        }))
    })
    .await
    .unwrap();
    assert_eq!(
        calls.iter().map(|call| call.0).collect::<Vec<_>>(),
        ["thread/resume", "thread/rollback", "turn/start"]
    );
    assert!(calls.iter().all(|call| call.1["threadId"] == "thread"));
    assert_eq!(calls[1].1["numTurns"], 1);
    assert_eq!(calls[2].1["input"][0]["text"], edit().text);
    assert_eq!(result["thread"]["id"], "thread");
    assert_eq!(result["turn"]["id"], "replacement");
}

#[tokio::test]
async fn failed_resend_returns_rolled_back_history_without_archiving_the_thread() {
    let result = replace_message(&edit(), json!({"threadId": "thread"}), |method, _| {
        std::future::ready(match method {
            "thread/resume" => Ok(json!({"thread": history()})),
            "thread/rollback" => Ok(json!({"thread": {"id": "thread", "turns": []}})),
            "turn/start" => Err(GuiError::Timeout),
            _ => panic!("unexpected operation: {method}"),
        })
    })
    .await
    .unwrap();
    assert_eq!(result["thread"]["id"], "thread");
    assert_eq!(result["thread"]["turns"], json!([]));
    assert!(result["error"].is_string());
    assert!(result.get("turn").is_none());
}

#[tokio::test]
async fn paginated_edit_uses_revert_and_keeps_the_retained_history() {
    let mut source = history();
    source["historyMode"] = json!("paginated");
    let result = replace_message(&edit(), json!({"threadId": "thread"}), |method, params| {
        std::future::ready(Ok(match method {
            "thread/resume" => json!({"thread": source}),
            "thread/revert" => {
                assert_eq!(
                    params,
                    json!({"threadId": "thread", "beforeTurnId": "last"})
                );
                json!({"thread": {"id": "thread", "turns": []}})
            }
            "turn/start" => json!({"turn": {"id": "replacement"}}),
            _ => panic!("unexpected operation: {method}"),
        }))
    })
    .await
    .unwrap();
    assert_eq!(result["thread"]["turns"], json!([source["turns"][0]]));
    assert_eq!(result["thread"]["id"], "thread");
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
