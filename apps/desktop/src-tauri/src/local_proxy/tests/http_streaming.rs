struct SseTransportTestReader {
    chunks: mpsc::Receiver<Vec<u8>>,
    current: Cursor<Vec<u8>>,
}

impl Read for SseTransportTestReader {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        let count = self.current.read(target)?;
        if count > 0 {
            return Ok(count);
        }
        self.current = Cursor::new(
            self.chunks
                .recv_timeout(Duration::from_secs(5))
                .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "test upstream ended"))?,
        );
        self.current.read(target)
    }
}

struct SseWireClient {
    reader: BufReader<TcpStream>,
}

impl SseWireClient {
    fn new(address: SocketAddr) -> Self {
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        Self {
            reader: BufReader::new(stream),
        }
    }

    fn send(&mut self, request: &str) {
        self.reader.get_mut().write_all(request.as_bytes()).unwrap();
        self.reader.get_mut().flush().unwrap();
    }

    fn headers(&mut self) -> String {
        let mut result = String::new();
        loop {
            let mut line = String::new();
            assert!(
                self.reader.read_line(&mut line).unwrap() > 0,
                "missing headers"
            );
            result.push_str(&line);
            if line == "\r\n" {
                return result;
            }
        }
    }

    fn chunk(&mut self) -> Vec<u8> {
        let mut line = String::new();
        self.reader.read_line(&mut line).unwrap();
        let length = usize::from_str_radix(line.trim(), 16).unwrap();
        let mut data = vec![0_u8; length];
        self.reader.read_exact(&mut data).unwrap();
        let mut ending = [0_u8; 2];
        self.reader.read_exact(&mut ending).unwrap();
        assert_eq!(&ending, b"\r\n");
        data
    }

    fn remaining_chunks(&mut self) -> String {
        let mut bytes = Vec::new();
        loop {
            let chunk = self.chunk();
            if chunk.is_empty() {
                return String::from_utf8(bytes).unwrap();
            }
            bytes.extend(chunk);
        }
    }
}

fn transport_test_payload(reader: impl Read + Send + 'static) -> UpstreamPayload {
    UpstreamPayload {
        status: 201,
        content_type: Some("text/event-stream; charset=utf-8".to_string()),
        response_headers: vec![("x-request-id".to_string(), "transport-test".to_string())],
        body: UpstreamBody::Streaming(Box::new(reader)),
        token_usage_account: None,
        token_usage_service_tier: None,
    }
}

fn serve_anthropic_wire_test(
    server: Server,
    session_id: String,
    receiver: mpsc::Receiver<Vec<u8>>,
) {
    let mut request = server
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    let mut body = Vec::new();
    request.as_reader().read_to_end(&mut body).unwrap();
    let guard = tracked_anthropic_test_request(&[("thread-id".to_string(), session_id)], &body);
    let reader = SseTransportTestReader {
        chunks: receiver,
        current: Cursor::new(Vec::new()),
    };
    let payload =
        convert_responses_payload(transport_test_payload(reader), true, "claude-test").unwrap();
    respond_payload(request, payload);
    drop(guard);
    server
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap()
        .respond(Response::from_string("next response"))
        .unwrap();
}

fn transport_response_frame(value: Value) -> Vec<u8> {
    format!("data: {value}\n\n").into_bytes()
}

#[test]
fn anthropic_http_stream_flushes_text_before_completion_and_keeps_polling_and_connection_usable() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut client = SseWireClient::new(server.server_addr().to_ip().unwrap());
    let session_id = format!("anthropic-wire-{}", uuid::Uuid::new_v4());
    let worker_session = session_id.clone();
    let body = anthropic_session_test_body(None);
    let (sender, receiver) = mpsc::channel();
    let worker = thread::spawn(move || serve_anthropic_wire_test(server, worker_session, receiver));
    client.send(&format!(
        "POST /v1/messages HTTP/1.1\r\nHost: localhost\r\nthread-id: {session_id}\r\nContent-Length: {}\r\n\r\n{}",
        body.len(), String::from_utf8(body).unwrap()
    ));
    sender
        .send(transport_response_frame(json!({
            "type": "response.output_text.delta", "delta": "first text"
        })))
        .unwrap();
    let headers = client.headers();
    assert!(headers.starts_with("HTTP/1.1 201"));
    assert!(headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked"));
    assert!(headers
        .to_ascii_lowercase()
        .contains("x-request-id: transport-test"));
    let first = String::from_utf8(client.chunk()).unwrap();
    assert!(
        first.contains("first text"),
        "first text must arrive before completion is released"
    );
    assert!(!first.contains("message_stop"));
    for _ in 0..3 {
        assert!(active_proxy_session_ids().unwrap().contains(&session_id));
        assert_eq!(
            list_proxy_session_requests_blocking(&session_id)
                .unwrap()
                .len(),
            1
        );
    }
    sender
        .send(transport_response_frame(json!({
            "type": "response.completed", "response": { "status": "completed" }
        })))
        .unwrap();
    assert!(client.remaining_chunks().contains("message_stop"));
    client.send("GET /next HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    assert!(client.headers().starts_with("HTTP/1.1 200"));
    let mut body = [0_u8; 13];
    client.reader.read_exact(&mut body).unwrap();
    assert_eq!(&body, b"next response");
    worker.join().unwrap();
    remove_anthropic_test_sessions(&[session_id]);
}

#[test]
fn sse_transport_preserves_http_10_and_explicit_identity_framing() {
    for (version, extra_headers) in [("1.0", ""), ("1.1", "TE: identity\r\n")] {
        let server = Server::http("127.0.0.1:0").unwrap();
        let mut client = SseWireClient::new(server.server_addr().to_ip().unwrap());
        let worker = thread::spawn(move || {
            let request = server
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap();
            respond_payload(
                request,
                transport_test_payload(Cursor::new(b"data: answer\n\n")),
            );
        });
        client.send(&format!(
            "GET /stream HTTP/{version}\r\nHost: localhost\r\n{extra_headers}Connection: close\r\n\r\n"
        ));
        let headers = client.headers().to_ascii_lowercase();
        assert!(headers.starts_with(&format!("http/{version} 201")));
        assert!(headers.contains("content-length: 14"));
        assert!(!headers.contains("transfer-encoding"));
        let mut data = [0_u8; 14];
        client.reader.read_exact(&mut data).unwrap();
        assert_eq!(&data, b"data: answer\n\n");
        worker.join().unwrap();
    }
}

struct UnreadSseTestBody;

impl Read for UnreadSseTestBody {
    fn read(&mut self, _target: &mut [u8]) -> io::Result<usize> {
        panic!("HEAD and no-content responses must not send the upstream body")
    }
}

#[test]
fn sse_transport_preserves_head_and_bodyless_statuses() {
    for (method, status) in [("HEAD", 200), ("GET", 204), ("GET", 304)] {
        let server = Server::http("127.0.0.1:0").unwrap();
        let mut client = SseWireClient::new(server.server_addr().to_ip().unwrap());
        let worker = thread::spawn(move || {
            let request = server
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap();
            let mut payload = transport_test_payload(UnreadSseTestBody);
            payload.status = status;
            respond_payload(request, payload);
        });
        client.send(&format!(
            "{method} /stream HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        ));
        assert!(client.headers().starts_with(&format!("HTTP/1.1 {status}")));
        let mut remainder = Vec::new();
        client.reader.read_to_end(&mut remainder).unwrap();
        assert!(remainder.is_empty());
        worker.join().unwrap();
    }
}

#[test]
fn sse_transport_read_error_reports_failure_and_finishes_chunk_framing() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut client = SseWireClient::new(server.server_addr().to_ip().unwrap());
    let (sender, receiver) = mpsc::channel();
    sender.send(b"data: {\"unfinished\"".to_vec()).unwrap();
    drop(sender);
    let worker = thread::spawn(move || {
        let request = server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        let reader = SseTransportTestReader {
            chunks: receiver,
            current: Cursor::new(Vec::new()),
        };
        respond_payload(request, transport_test_payload(reader));
        server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap()
            .respond(Response::empty(204))
            .unwrap();
    });
    client.send("GET /stream HTTP/1.1\r\nHost: localhost\r\n\r\n");
    assert!(client.headers().contains("Transfer-Encoding: chunked"));
    let body = client.remaining_chunks();
    assert!(body.contains("data: {\"unfinished\"\n\nevent: error"));
    assert!(body.contains("event: error"));
    assert!(!body.contains("message_stop"));
    client.send("GET /next HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    assert!(client.headers().starts_with("HTTP/1.1 204"));
    worker.join().unwrap();
}
