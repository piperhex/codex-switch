use super::*;

fn headers() -> Vec<(String, String)> {
    vec![(
        "X-OpenAI-Internal-Codex-Responses-Lite".into(),
        "true".into(),
    )]
}

#[test]
fn repairs_missing_or_conflicting_context_without_losing_reasoning_options() {
    for context in [
        Value::Null,
        json!("current_turn"),
        json!("auto"),
        json!(false),
    ] {
        let mut request = json!({"reasoning": {"effort": "xhigh", "summary": "auto"},
            "input": [{"type": "compaction", "encrypted_content": "opaque"}]});
        if !context.is_null() {
            request["reasoning"]["context"] = context;
        }
        let repaired = prepare(
            &Method::Post,
            "/v1/responses",
            &headers(),
            serde_json::to_vec(&request).unwrap(),
        )
        .unwrap();
        let actual: Value = serde_json::from_slice(&repaired).unwrap();
        request["reasoning"]["context"] = json!(ALL_TURNS);
        assert_eq!(actual, request);
        assert_eq!(
            prepare(&Method::Post, "/v1/responses", &headers(), repaired.clone()).unwrap(),
            repaired
        );
    }
}

#[test]
fn adds_reasoning_for_new_resumed_and_compaction_requests() {
    for path in [
        "/responses",
        "/v1/responses?test=1",
        "/codex-gui/v1/responses",
        "/v1/responses/compact",
        "/v1/v1/responses",
        "/codex/v1/responses/compact",
        "https://chatgpt.com/backend-api/codex/responses",
    ] {
        for body in [
            br#"{"input":[]}"#.to_vec(),
            br#"{"reasoning":null}"#.to_vec(),
        ] {
            let repaired = prepare(&Method::Post, path, &headers(), body).unwrap();
            let actual: Value = serde_json::from_slice(&repaired).unwrap();
            assert_eq!(actual["reasoning"]["context"], ALL_TURNS, "{path}");
        }
    }
}

#[test]
fn leaves_regular_requests_and_already_valid_lite_bytes_unchanged() {
    let body = br#"{ "reasoning": { "context": "all_turns", "effort": "low" } }"#.to_vec();
    assert_eq!(
        prepare(&Method::Post, "/responses", &headers(), body.clone()).unwrap(),
        body
    );
    let invalid = b"not json".to_vec();
    for (method, path, headers) in [
        (Method::Get, "/v1/models", headers()),
        (Method::Post, "/v1/chat/completions", headers()),
        (Method::Post, "/v1/responses", vec![]),
        (
            Method::Post,
            "/v1/responses",
            vec![(LITE_HEADER.into(), "false".into())],
        ),
    ] {
        assert_eq!(
            prepare(&method, path, &headers, invalid.clone()).unwrap(),
            invalid
        );
    }
}

#[test]
fn rejects_unrepairable_lite_requests() {
    for body in [
        b"invalid".as_slice(),
        b"[]",
        br#"{"reasoning":[]}"#,
        br#"{"reasoning":"high"}"#,
    ] {
        assert!(prepare(&Method::Post, "/responses", &headers(), body.to_vec()).is_err());
    }
    let mut headers = headers();
    headers.push(("content-encoding".into(), "unsupported".into()));
    assert!(prepare(&Method::Post, "/responses", &headers, b"{}".to_vec()).is_err());
}

#[test]
fn repairs_compressed_requests_without_changing_encoding() {
    for encoding in ["zstd", "gzip"] {
        let mut headers = headers();
        headers.push(("Content-Encoding".into(), encoding.into()));
        let body = encode(br#"{"reasoning":{"effort":"xhigh"}}"#, encoding).unwrap();
        let repaired = prepare(&Method::Post, "/responses", &headers, body).unwrap();
        let actual: Value = serde_json::from_slice(&decode(&repaired, encoding).unwrap()).unwrap();
        assert_eq!(
            actual,
            json!({"reasoning": {"effort": "xhigh", "context": "all_turns"}})
        );
        assert_eq!(
            prepare(&Method::Post, "/responses", &headers, repaired.clone()).unwrap(),
            repaired
        );
    }
}
