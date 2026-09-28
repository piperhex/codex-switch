use super::display;
use serde_json::{json, Value};

const START: &str = "<codex_gui_conversation_context>";
const END: &str = "</codex_gui_conversation_context>";
const CONTINUE: &str = "请继续完成刚才中断的任务。";

fn awareness() -> String {
    format!(
        "{START}\n{}\n{END}",
        json!({"kind": "awareness", "current": "current",
        "running": [{"id": "other", "name": "后台任务", "cwd": "D:/private", "status": "running"}],
        "total": 1, "note": "运行概览"})
    )
}

fn user(text: String) -> Value {
    json!({"type": "userMessage", "content": [{"type": "text", "text": text}]})
}

#[test]
fn concatenated_continuation_is_clean_in_every_history_and_event_shape() {
    for separator in ["", " ", "\n", "\r\n"] {
        let raw = user(format!(
            "{CONTINUE}{separator}{}",
            awareness().replace('\n', separator)
        ));
        let mut envelopes = [
            json!({"item": raw}),
            json!({"turn": {"items": [raw]}}),
            json!({"thread": {"turns": [{"items": [raw]}]}}),
        ];
        for envelope in &mut envelopes {
            display(envelope);
            assert!(!envelope.to_string().contains(START));
            assert!(!envelope.to_string().contains("D:/private"));
            assert!(envelope.to_string().contains(CONTINUE));
        }
        let mut normalized = raw;
        display(&mut normalized);
        assert_eq!(normalized["content"][0]["text"], CONTINUE);
        assert_eq!(normalized["content"].as_array().unwrap().len(), 1);
        let again = normalized.clone();
        display(&mut normalized);
        assert_eq!(normalized, again);
    }
}

#[test]
fn repeated_snapshots_preserve_normal_text_and_reference_chips() {
    let reference = format!(
        "{START}{}{END}",
        json!({"kind": "reference", "id": "source",
        "name": "设计讨论", "messages": [{"role": "user", "text": format!("literal {END} and \\\"quote\\\"")}],
        "truncated": false, "note": "参考内容"})
    );
    let mut item = user(format!(
        "前文{}中间{reference}后文{}",
        awareness(),
        awareness()
    ));
    display(&mut item);
    assert_eq!(item["content"][0]["text"], "前文中间后文");
    assert_eq!(
        item["content"][1],
        json!({"type": "mention", "name": "设计讨论", "path": "codex-thread://source"})
    );
    assert_eq!(item["content"].as_array().unwrap().len(), 2);
}

#[test]
fn partial_or_malformed_private_blocks_do_not_leak_into_the_bubble() {
    for hidden in [
        format!("{START}{{\"kind\":\"awareness\",\"private\":"),
        format!("{START}not-json{END}"),
        format!("{START}{{\"kind\":\"future\"}}{END}"),
    ] {
        let mut item = user(format!("保留正文 {hidden}"));
        display(&mut item);
        assert_eq!(item["content"][0]["text"], "保留正文");
        assert!(!item.to_string().contains(START));
    }
    let mut hidden_only = user(awareness());
    display(&mut hidden_only);
    assert_eq!(hidden_only["content"], json!([]));
}

#[test]
fn references_do_not_recursively_include_concatenated_awareness() {
    let source = json!({"id": "source", "name": "参考", "turns": [{"items": [
        user(format!("原始问题{}", awareness()))
    ]}]});
    let snapshot = super::reference(&source, 1).unwrap();
    let text = snapshot["text"].as_str().unwrap();
    assert!(text.contains("原始问题"));
    assert!(!text.contains("D:/private"));
    assert!(!text.contains("awareness"));
}
