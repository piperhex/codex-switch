use super::*;

fn frames(events: &[Value]) -> String {
    events
        .iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect()
}

fn reasoning_events() -> Vec<Value> {
    let item = json!({ "id": "rs_native", "type": "reasoning", "encrypted_content": "ciphertext",
        "summary": [{ "type": "summary_text", "text": "First" }, { "type": "summary_text", "text": "Second" }] });
    vec![
        json!({ "type": "response.output_item.added", "output_index": 0,
            "item": { "id": "rs_native", "type": "reasoning", "summary": [] } }),
        json!({ "type": "response.reasoning_summary_text.delta", "item_id": "rs_native", "output_index": 0,
            "summary_index": 0, "delta": "Fir" }),
        json!({ "type": "response.reasoning_summary_text.done", "item_id": "rs_native", "output_index": 0,
            "summary_index": 0, "text": "First" }),
        json!({ "type": "response.reasoning_summary_text.delta", "item_id": "rs_native", "output_index": 0,
            "summary_index": 1, "delta": "Second" }),
        json!({ "type": "response.output_item.done", "output_index": 0, "item": item }),
        json!({ "type": "response.completed", "response": { "status": "completed", "output": [item] } }),
    ]
}

#[test]
fn thinking_stream_reconciles_multiple_summaries_and_sends_signature_before_stop() {
    let source = frames(&reasoning_events());
    let mut reader = AnthropicSseReader::new(BufReader::new(source.as_bytes()), "claude");
    let mut output = String::new();
    reader.read_to_string(&mut output).unwrap();
    let values: Vec<Value> = output
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let thinking: String = values
        .iter()
        .filter_map(|value| value.pointer("/delta/thinking").and_then(Value::as_str))
        .collect();
    assert_eq!(thinking, "FirstSecond");
    let signature_index = values
        .iter()
        .position(|value| value.pointer("/delta/type") == Some(&json!("signature_delta")))
        .unwrap();
    let stop_index = values
        .iter()
        .position(|value| value["type"] == "content_block_stop")
        .unwrap();
    assert!(signature_index < stop_index);
    assert_eq!(
        values
            .iter()
            .filter(|value| value["type"] == "content_block_stop")
            .count(),
        1
    );
    let message = collect_message(source.as_bytes(), "claude").unwrap();
    let restored = super::super::anthropic_reasoning::restore(&message["content"][0]);
    assert_eq!(restored["encrypted_content"], "ciphertext");
    assert_eq!(
        restored["summary"],
        json!([
            { "type": "summary_text", "text": "First" },
            { "type": "summary_text", "text": "Second" }
        ])
    );
}

#[test]
fn thinking_stream_produces_a_delta_before_the_response_finishes() {
    let source = frames(&reasoning_events()[..2]);
    let mut reader = AnthropicSseReader::new(BufReader::new(source.as_bytes()), "claude");
    let mut bytes = [0_u8; 4096];
    let mut output = String::new();
    for _ in 0..2 {
        let count = reader.read(&mut bytes).unwrap();
        output.push_str(std::str::from_utf8(&bytes[..count]).unwrap());
    }
    assert!(output.contains("thinking_delta"));
    assert!(output.contains("Fir"));
    assert!(!output.contains("message_stop"));
    assert!(!output.contains("api_error"));
}

#[test]
fn thinking_stream_recovers_signature_only_reasoning_and_keeps_failures_as_failures() {
    let item = json!({ "id": "rs_signature", "type": "reasoning", "summary": [], "encrypted_content": "opaque" });
    let response = json!({ "status": "completed", "output": [item] });
    let message = convert_response(&response, "claude").unwrap();
    assert_eq!(message["content"][0]["thinking"], "");
    assert_eq!(
        super::super::anthropic_reasoning::restore(&message["content"][0])["encrypted_content"],
        "opaque"
    );
    let mut events = reasoning_events()[..2].to_vec();
    events.push(json!({ "type": "response.failed", "response": { "status": "failed" } }));
    let source = frames(&events);
    assert_eq!(
        collect_message(source.as_bytes(), "claude"),
        Err(ConversionError::UpstreamFailed)
    );
}
