use super::*;
use serde_json::json;

fn rule(text: &str) -> SystemPromptRule {
    SystemPromptRule {
        name: "Rule".into(),
        text: text.into(),
        enabled: true,
    }
}

fn settings() -> GuiSystemPromptSettings {
    GuiSystemPromptSettings {
        filter_enabled: true,
        filter_rules: vec![rule("remove me")],
        injection_enabled: true,
        injection_prompts: vec![rule("GUI instruction")],
    }
}

#[test]
fn filters_before_injecting_and_preserves_user_input() {
    let body = json!({"instructions": "remove me", "input": [
        {"role": "developer", "content": "REMOVE ME"},
        {"role": "user", "content": "remove me"},
        {"role": "system", "content": "keep me"}
    ]});
    let mut settings = settings();
    settings.filter_rules.push(rule("GUI instruction"));
    let applied: Value =
        serde_json::from_slice(&apply_settings(body.to_string().into_bytes(), &settings)).unwrap();
    assert_eq!(applied["instructions"], "GUI instruction");
    assert_eq!(
        applied["input"],
        json!([
            {"role": "user", "content": "remove me"},
            {"role": "system", "content": "keep me"}
        ])
    );
}

#[test]
fn disabled_switches_and_rules_leave_requests_unchanged() {
    let body = br#"{"instructions":"remove me","input":"hi"}"#.to_vec();
    assert_eq!(
        apply_settings(body.clone(), &GuiSystemPromptSettings::default()),
        body
    );
    let mut settings = settings();
    settings.filter_rules[0].enabled = false;
    settings.injection_prompts[0].enabled = false;
    let applied: Value = serde_json::from_slice(&apply_settings(body.clone(), &settings)).unwrap();
    assert_eq!(applied, serde_json::from_slice::<Value>(&body).unwrap());
    assert_eq!(apply_settings(b"invalid".to_vec(), &settings), b"invalid");
}

#[test]
fn validates_and_normalizes_rules_before_saving() {
    let mut settings = settings();
    settings.filter_rules = vec![rule(" Match "), rule("match")];
    settings.injection_prompts = vec![rule(" Instruction "), rule("instruction")];
    let normalized = normalize(settings.clone()).unwrap();
    assert_eq!(normalized.filter_rules, vec![rule("Match")]);
    assert_eq!(normalized.injection_prompts, vec![rule("Instruction")]);
    settings.filter_rules = vec![rule(&"x".repeat(501))];
    assert!(normalize(settings.clone()).is_err());
    settings.filter_rules = vec![rule(" ")];
    assert!(normalize(settings.clone()).is_err());
    settings.filter_rules = vec![rule("match"); 101];
    assert!(normalize(settings.clone()).is_err());
    settings.filter_rules.clear();
    settings.injection_prompts = vec![rule("instruction"); 101];
    assert!(normalize(settings).is_err());
}

#[test]
fn stores_gui_rules_separately_and_preserves_corrupt_files() {
    let root = std::env::temp_dir().join(format!("gui-prompts-{}", uuid::Uuid::new_v4()));
    let path = root.join(FILE_NAME);
    assert_eq!(
        access_path(&path, None).unwrap(),
        GuiSystemPromptSettings::default()
    );
    let saved = access_path(&path, Some(settings())).unwrap();
    assert_eq!(access_path(&path, None).unwrap(), saved);
    let original = fs::read(&path).unwrap();
    let mut invalid = settings();
    invalid.injection_prompts = vec![rule("")];
    assert!(access_path(&path, Some(invalid)).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    fs::write(&path, b"broken").unwrap();
    assert!(access_path(&path, None).is_err());
    assert!(access_path(&path, Some(settings())).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"broken");
    fs::remove_dir_all(root).unwrap();
}
