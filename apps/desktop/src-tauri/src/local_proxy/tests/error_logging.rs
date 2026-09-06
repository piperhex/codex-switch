struct CountedLogReader {
    bytes: Cursor<Vec<u8>>,
    reads: Arc<AtomicUsize>,
}

impl Read for CountedLogReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.reads.fetch_add(1, AtomicOrdering::Relaxed);
        self.bytes.read(buffer)
    }
}

#[test]
fn error_logging_preserves_stream_bytes_and_never_reads_ahead_of_the_client() {
    let expected = b"event: error\r\ndata: {\"error\":{\"message\":\"request failed\"}}\r\n\r\n";
    let reads = Arc::new(AtomicUsize::new(0));
    let mut reader = ProxyErrorCaptureReader {
        inner: Box::new(CountedLogReader {
            bytes: Cursor::new(expected.to_vec()),
            reads: reads.clone(),
        }),
        capture: error_capture::ErrorCapture::new(true, 200),
    };
    assert_eq!(reads.load(AtomicOrdering::Relaxed), 0);
    assert_eq!(reader.read(&mut []).unwrap(), 0);
    assert_eq!(reads.load(AtomicOrdering::Relaxed), 0);

    let mut actual = Vec::new();
    let mut chunk = [0; 3];
    loop {
        let count = reader.read(&mut chunk).unwrap();
        if count == 0 {
            break;
        }
        actual.extend_from_slice(&chunk[..count]);
    }
    assert_eq!(actual, expected);
    assert!(reads.load(AtomicOrdering::Relaxed) > 1);
}

#[test]
fn error_logging_keeps_buffered_error_payloads_unchanged() {
    let original = json_payload(429, json!({"error": {"message": "quota exhausted"}}));
    let UpstreamBody::Buffered(expected) = &original.body else {
        panic!("buffered response")
    };
    let expected = expected.clone();
    let captured = attach_proxy_error_capture(original);

    assert_eq!(captured.status, 429);
    assert_eq!(
        captured.content_type.as_deref(),
        Some("application/json; charset=utf-8")
    );
    let UpstreamBody::Buffered(actual) = captured.body else {
        panic!("buffered response")
    };
    assert_eq!(actual, expected);
}
