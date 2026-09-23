use super::*;

#[test]
fn transport_messages_distinguish_failure_stages_and_causes() {
    for (detail, expected) in [
        (
            "client error (Connect): tls handshake eof",
            TransportFailure::TlsClosed,
        ),
        (
            "invalid peer certificate: UnknownIssuer",
            TransportFailure::Certificate,
        ),
        ("tls handshake failed", TransportFailure::Tls),
        (
            "dns error: failed to lookup address information",
            TransportFailure::Dns,
        ),
        ("连接被拒绝 (os error 10061)", TransportFailure::Refused),
        (
            "连接被重置 (os error 10054)",
            TransportFailure::Disconnected,
        ),
        (
            "client error (Connect): operation timed out",
            TransportFailure::ConnectTimeout,
        ),
        (
            "request timed out during request upload",
            TransportFailure::UploadTimeout,
        ),
        (
            "request timed out during response headers",
            TransportFailure::ResponseTimeout,
        ),
        ("error sending request", TransportFailure::Connection),
    ] {
        for context in ["Official Codex", "Provider"] {
            let error = format!("{context} proxy request failed: {detail}");
            assert_eq!(transport(&error), Some(expected.message()), "{error}");
            assert_eq!(gui(&error), expected.message(), "{error}");
        }
    }
}

#[test]
fn client_messages_never_include_private_error_details() {
    let details = [
        "https://user:password@example.com/responses?api_key=sk-private",
        "C:\\Users\\private\\auth.json",
        "Authorization: Bearer private-token",
    ];
    for detail in details {
        let error = format!(
            "Official Codex proxy request failed: error sending request for url ({detail}): tls handshake eof"
        );
        assert_eq!(gui(&error), TransportFailure::TlsClosed.message());
        assert!(!gui(detail).contains(detail));
    }
}

#[test]
fn account_errors_remain_actionable_without_guessing_the_cause() {
    let missing = "请先选择 Codex GUI 账户。";
    let exhausted = "暂无符合条件的账号，请调整自动切号设置或选择其他账户。";
    assert_eq!(gui(missing), missing);
    assert_eq!(gui(exhausted), exhausted);
    assert!(gui("unexpected internal failure").contains("暂时无法确认原因"));
    assert!(transport("Official Codex proxy request returned HTTP 401").is_none());
}
