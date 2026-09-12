use super::*;

const COMPLETED: &str = "event: response.completed\ndata: {\"type\":\"response.completed\"}\n\n";
const HEARTBEAT: &str = ": keep-alive\n\n";

fn delayed_response(
    content_type: &str,
    chunks: Vec<(&'static str, Duration)>,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/responses", listener.local_addr().unwrap());
    let content_type = content_type.to_string();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        read_headers(&mut socket);
        let length: usize = chunks.iter().map(|(chunk, _)| chunk.len()).sum();
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\n\r\n"
        )
        .unwrap();
        socket.flush().unwrap();
        for (chunk, delay) in chunks {
            thread::sleep(delay);
            // Timeout tests deliberately close the client before the final write.
            if socket.write_all(chunk.as_bytes()).is_err() {
                return;
            }
            if socket.flush().is_err() {
                return;
            }
        }
    });
    (url, server)
}

fn completes_after_silence(timeout: Option<Duration>) {
    let (url, server) = delayed_response(
        "text/event-stream; charset=utf-8",
        vec![(HEARTBEAT, Duration::ZERO), (COMPLETED, IDLE * 2)],
    );
    let mut request = prepared_request(url, Vec::new());
    request.timeouts.sse_response_idle = timeout;
    let bytes = request.send().unwrap().bytes().unwrap();
    assert_eq!(bytes, format!("{HEARTBEAT}{COMPLETED}").as_bytes());
    server.join().unwrap();
}

#[test]
fn disabled_sse_timeout_allows_long_silence_and_completion() {
    completes_after_silence(None);
}

#[test]
fn longer_sse_timeout_allows_long_silence_and_completion() {
    completes_after_silence(Some(IDLE * 4));
}

#[test]
fn upstream_comments_keep_sse_alive_without_deltas() {
    let mut chunks = vec![(HEARTBEAT, STEP); 8];
    chunks.push((COMPLETED, STEP));
    let (url, server) = delayed_response("text/event-stream", chunks);
    let request = prepared_request(url, Vec::new());
    let bytes = request.send().unwrap().bytes().unwrap();
    assert!(bytes.ends_with(COMPLETED.as_bytes()));
    server.join().unwrap();
}

#[test]
fn disabling_sse_timeout_preserves_json_idle_timeout() {
    let (url, server) = delayed_response("application/json", vec![("{}", IDLE * 2)]);
    let mut request = prepared_request(url, Vec::new());
    request.timeouts.sse_response_idle = None;
    let error = request.send().unwrap().bytes().unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
    server.join().unwrap();
}

#[test]
fn prepared_request_retains_scope_after_worker_returns() {
    use crate::{local_proxy::sse_idle_timeout, models::SseIdleTimeoutSettings};
    let (url, server) = delayed_response("text/event-stream", vec![(COMPLETED, IDLE * 2)]);
    let request = {
        let _scope = sse_idle_timeout::RequestScope::enter(SseIdleTimeoutSettings {
            enabled: false,
            ..Default::default()
        });
        let builder = reqwest::blocking::Client::new().get(url);
        let mut request = Request::prepare(builder).unwrap();
        request.client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert!(request.timeouts.sse_response_idle.is_none());
        request
    };
    assert!(sse_idle_timeout::current().is_some());
    assert_eq!(
        request.send().unwrap().bytes().unwrap(),
        COMPLETED.as_bytes()
    );
    server.join().unwrap();
}

#[test]
fn session_polling_remains_responsive_while_sse_waits_for_data() {
    use crate::local_proxy as proxy;
    let session_id = format!("sse-polling-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".to_string(), session_id.clone())];
    let guard = proxy::begin_proxy_session_request(&headers, None, br#"{"input":"hello"}"#, None);
    let (url, sender, server) = stream_server();
    let mut request = prepared_request(url, Vec::new());
    request.timeouts.sse_response_idle = None;
    let (reading_sender, reading_receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut response = request.send().unwrap();
        let mut heartbeat = vec![0; HEARTBEAT.len()];
        response.read_exact(&mut heartbeat).unwrap();
        reading_sender.send(()).unwrap();
        let mut completed = vec![0; COMPLETED.len()];
        response.read_exact(&mut completed).unwrap();
        completed
    });
    sender.send(Some(HEARTBEAT)).unwrap();
    reading_receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    let active = proxy::active_proxy_session_ids()
        .unwrap()
        .contains(&session_id);
    let requests = proxy::list_proxy_session_requests_blocking(&session_id).unwrap();
    let still_waiting = !reader.is_finished();
    sender.send(Some(COMPLETED)).unwrap();
    assert_eq!(reader.join().unwrap(), COMPLETED.as_bytes());
    sender.send(None).unwrap();
    server.join().unwrap();
    drop(guard);
    proxy::proxy_sessions().lock().unwrap().remove(&session_id);
    assert!(active && still_waiting);
    assert_eq!(requests.len(), 1);
    assert!(requests[0].response_time_ms.is_none());
}
