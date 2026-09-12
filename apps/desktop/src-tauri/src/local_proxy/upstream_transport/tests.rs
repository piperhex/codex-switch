use super::*;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    thread,
};

const IDLE: Duration = Duration::from_millis(300);
const STEP: Duration = Duration::from_millis(90);

fn timeouts() -> Timeouts {
    Timeouts {
        upload_idle: IDLE,
        upload_total: Duration::from_secs(5),
        response_headers: IDLE,
        response_idle: IDLE,
        sse_response_idle: Some(IDLE),
    }
}

fn echo_server(delay: Duration) -> (String, thread::JoinHandle<Vec<u8>>) {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}/responses", server.server_addr());
    let handle = thread::spawn(move || {
        let Some(mut request) = server.recv_timeout(Duration::from_secs(2)).unwrap() else {
            // tiny_http can buffer a small body before exposing the request. A cancelled
            // upload may therefore close the socket without producing a Request at all.
            return Vec::new();
        };
        let mut bytes = Vec::new();
        // Timeout tests intentionally cancel the client halfway through the upload.
        if request.as_reader().read_to_end(&mut bytes).is_ok() {
            thread::sleep(delay);
            // The timeout tests close the response before this write.
            drop(request.respond(tiny_http::Response::from_string("ok")));
        }
        bytes
    });
    (url, handle)
}

async fn delayed_upload(
    url: String,
    limits: Timeouts,
    delay: Duration,
) -> Result<reqwest::Response, Error> {
    const CHUNKS: usize = 6;
    let (sender, receiver) = watch::channel(Progress {
        sent_bytes: 0,
        updated_at: Instant::now(),
    });
    let progress = sender.clone();
    let body = stream::unfold(0, move |index| {
        let sender = progress.clone();
        async move {
            if index == CHUNKS {
                return None;
            }
            tokio::time::sleep(delay).await;
            sender.send_replace(Progress {
                sent_bytes: index + 1,
                updated_at: Instant::now(),
            });
            Some((Ok::<_, Infallible>(Bytes::from_static(b"x")), index + 1))
        }
    });
    let request = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .post(url)
        .header(header::CONTENT_LENGTH, CHUNKS)
        .body(reqwest::Body::wrap_stream(body));
    let result = wait_for_headers(request, receiver, CHUNKS, limits).await;
    drop(sender);
    result
}

#[test]
fn progressing_upload_gets_a_fresh_header_budget() {
    let (url, server) = echo_server(STEP);
    let started = std::time::Instant::now();
    let response = tauri::async_runtime::block_on(delayed_upload(url, timeouts(), STEP)).unwrap();
    assert_eq!(response.status(), 200);
    assert!(started.elapsed() > IDLE);
    assert_eq!(server.join().unwrap(), b"xxxxxx");
}

#[test]
fn stalled_upload_is_cancelled() {
    let (url, server) = echo_server(Duration::ZERO);
    let result = tauri::async_runtime::block_on(delayed_upload(url, timeouts(), IDLE * 2));
    assert!(matches!(
        result,
        Err(Error::Timeout {
            phase: Phase::Upload,
            ..
        })
    ));
    server.join().unwrap();
}

#[test]
fn progressing_upload_still_has_an_absolute_limit() {
    let (url, server) = echo_server(Duration::ZERO);
    let limits = Timeouts {
        upload_total: IDLE,
        ..timeouts()
    };
    let result = tauri::async_runtime::block_on(delayed_upload(url, limits, STEP));
    assert!(matches!(
        result,
        Err(Error::Timeout {
            phase: Phase::Upload,
            ..
        })
    ));
    assert!(!result.unwrap_err().can_retry());
    server.join().unwrap();
}

fn prepared_request(url: String, body: Vec<u8>) -> Request {
    let builder = reqwest::blocking::Client::new().post(url).body(body);
    let mut request = Request::prepare(builder).unwrap();
    request.client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    request.timeouts = timeouts();
    request
}

#[test]
fn header_timeout_does_not_replay_a_post() {
    let (url, server) = echo_server(IDLE * 2);
    let request = prepared_request(url, b"one request only".to_vec());
    let mut attempts = 0;
    let result = crate::local_proxy::retry_timeout_operation(
        || {
            attempts += 1;
            request.send()
        },
        Error::can_retry,
    );
    assert!(matches!(
        result,
        Err(Error::Timeout {
            phase: Phase::ResponseHeaders,
            ..
        })
    ));
    assert_eq!(attempts, 1);
    assert_eq!(server.join().unwrap(), b"one request only");
}

#[test]
fn upload_preserves_all_bytes_and_recomputes_content_length() {
    let (url, server) = echo_server(Duration::ZERO);
    let body = vec![b'x'; UPLOAD_CHUNK_BYTES * 3 + 7];
    let mut request = prepared_request(url, body.clone());
    request.headers.insert(header::CONTENT_LENGTH, 1.into());
    request
        .headers
        .insert(header::TRANSFER_ENCODING, "chunked".parse().unwrap());
    assert_eq!(request.send().unwrap().bytes().unwrap(), b"ok");
    assert_eq!(server.join().unwrap(), body);
}

fn read_headers(stream: &mut TcpStream) {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        stream.read_exact(&mut byte).unwrap();
        bytes.push(byte[0]);
    }
}

fn stream_server() -> (
    String,
    mpsc::Sender<Option<&'static str>>,
    thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/events", listener.local_addr().unwrap());
    let (sender, receiver) = mpsc::channel::<Option<&'static str>>();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        read_headers(&mut socket);
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
        while let Some(chunk) = receiver.recv_timeout(Duration::from_secs(5)).unwrap() {
            write!(socket, "{:x}\r\n{}\r\n", chunk.len(), chunk).unwrap();
            socket.flush().unwrap();
        }
    });
    (url, sender, server)
}

#[test]
fn active_response_outlives_header_deadline_but_idle_read_still_times_out() {
    use crate::local_proxy as proxy;
    let session_id = format!("slow-stream-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".to_string(), session_id.clone())];
    let guard = proxy::begin_proxy_session_request(&headers, None, br#"{"input":"hello"}"#, None);
    let (url, sender, server) = stream_server();
    let request = prepared_request(url, Vec::new());
    let mut response = request.send().unwrap();
    let started = std::time::Instant::now();
    for _ in 0..6 {
        thread::sleep(STEP);
        sender.send(Some("data: alive\n\n")).unwrap();
        let mut bytes = [0; 13];
        response.read_exact(&mut bytes).unwrap();
        assert_eq!(&bytes, b"data: alive\n\n");
        assert!(proxy::active_proxy_session_ids()
            .unwrap()
            .contains(&session_id));
        let requests = proxy::list_proxy_session_requests_blocking(&session_id).unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].response_time_ms.is_none());
    }
    assert!(started.elapsed() > IDLE);
    let error = response.read(&mut [0; 1]).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
    sender.send(None).unwrap();
    server.join().unwrap();
    drop(guard);
    proxy::proxy_sessions().lock().unwrap().remove(&session_id);
}

#[path = "sse_tests.rs"]
mod sse;
