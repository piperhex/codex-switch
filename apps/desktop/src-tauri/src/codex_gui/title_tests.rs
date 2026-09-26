use super::*;
use crate::codex_gui::title_worker::TitleOutput;

fn request() -> TitleRequest {
    serde_json::from_value(
        json!({"threadId": "one", "prompt": "生成一个熊骑车的 SVG 动画",
        "settings": {"model": "gpt-5.6-luna", "effort": "low"}}),
    )
    .unwrap()
}

#[test]
fn validates_model_effort_and_bounded_unicode_prompt() {
    let mut request = request();
    assert!(request.validate().is_ok());
    request.prompt = "中".repeat(MAX_PROMPT_CHARS);
    assert!(request.validate().is_ok());
    request.prompt.push('中');
    assert!(request.validate().is_err());
    request.prompt = "hello".into();
    for model in ["", "../model", "model\nsecret", "model with space"] {
        request.settings.model = model.into();
        assert!(request.validate().is_err());
    }
    assert!(
        serde_json::from_value::<TitleSettings>(json!({"model": "x", "effort": "unknown"}))
            .is_err()
    );
}

#[test]
fn uses_admin_settings_in_an_ephemeral_read_only_thread() {
    let mut request = request();
    request.settings.model = "custom-model".into();
    request.settings.effort = TitleEffort::Medium;
    let start = start_params(&request.settings, "/scratch");
    assert_eq!(start["model"], "custom-model");
    assert_eq!(start["config"]["model_reasoning_effort"], "medium");
    assert_eq!(start["ephemeral"], true);
    assert_eq!(start["sandbox"], "read-only");
    assert_eq!(start["approvalPolicy"], "never");
    assert_eq!(start["modelProvider"], "codex-switch-gui");
    assert_eq!(start["config"]["features.shell_tool"], false);
    assert_eq!(start["config"]["features.plugins"], false);
    let turn = turn_params("private", &request);
    assert_eq!(turn["threadId"], "private");
    assert_eq!(turn["model"], "custom-model");
    assert_eq!(turn["effort"], "medium");
    assert_eq!(turn["outputSchema"]["properties"]["title"]["maxLength"], 36);
}

#[test]
fn accepts_only_bounded_structured_titles() {
    assert_eq!(
        parse_title(r#"{"title":" 熊骑车 SVG 动画 "}"#).unwrap(),
        "熊骑车 SVG 动画"
    );
    for value in [
        json!({"title": ""}),
        json!({"title": "中".repeat(37)}),
        json!({"title": "title\nbody"}),
        json!({"title": 123}),
        json!({"answer": "hello"}),
    ] {
        assert!(parse_title(&value.to_string()).is_err());
    }
    assert!(parse_title("a plain reply instead of JSON").is_err());
}

#[test]
fn previews_are_not_manual_titles_and_named_threads_are_preserved() {
    assert!(explicit_title(&json!({"name": null, "preview": "User prompt"})).is_none());
    assert!(explicit_title(&json!({"name": "  "})).is_none());
    assert_eq!(
        explicit_title(&json!({"name": "My title"})),
        Some("My title")
    );
}

#[test]
fn observes_early_completion_without_duplicating_deltas_or_other_threads() {
    let mut output = TitleOutput {
        thread_id: "private".into(),
        ..Default::default()
    };
    output
        .observe(&json!({"method": "item/agentMessage/delta",
        "params": {"threadId": "other", "delta": "unrelated"}}))
        .unwrap();
    assert!(output.text.is_empty());
    output
        .observe(&json!({"method": "item/agentMessage/delta",
        "params": {"threadId": "private", "delta": "partial"}}))
        .unwrap();
    output
        .observe(
            &json!({"method": "item/completed", "params": {"threadId": "private",
        "item": {"type": "agentMessage", "text": "{\"title\":\"Short title\"}"}}}),
        )
        .unwrap();
    output
        .observe(
            &json!({"method": "turn/completed", "params": {"threadId": "private",
        "turn": {"status": "completed"}}}),
        )
        .unwrap();
    assert!(output.completed);
    assert_eq!(parse_title(&output.text).unwrap(), "Short title");
    assert!(output
        .observe(
            &json!({"method": "turn/completed", "params": {"threadId": "private",
        "turn": {"status": "failed"}}})
        )
        .is_err());
}

#[test]
fn naming_home_does_not_import_personal_tools_or_project_config() {
    let root = std::env::temp_dir().join(format!("title-home-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("config.toml"),
        "[mcp_servers.private]\ncommand = 'private-tool'\n",
    )
    .unwrap();
    let base_url = "http://127.0.0.1:54321/codex-gui/v1";
    let home = crate::codex_gui::home::prepare_title_home(&root, base_url).unwrap();
    let config = std::fs::read_to_string(home.join("config.toml")).unwrap();
    assert!(config.contains("codex-switch-gui"));
    assert!(!config.contains("private-tool"));
    assert!(!config.contains("mcp_servers"));
    let config: toml_edit::DocumentMut = config.parse().unwrap();
    assert_eq!(
        config["model_providers"]["codex-switch-gui"]["base_url"].as_str(),
        Some(base_url)
    );
    assert_eq!(
        config["model_providers"]["codex-switch-gui"]["http_headers"]
            [crate::codex_config::LOCAL_PROXY_REQUEST_PURPOSE_HEADER]
            .as_str(),
        Some(crate::codex_config::TITLE_GENERATION_REQUEST_PURPOSE)
    );
    std::fs::remove_dir_all(root).unwrap();
}
