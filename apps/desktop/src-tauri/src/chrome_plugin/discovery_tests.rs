use std::{
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::Duration,
};

use serde_json::json;

use super::*;
use crate::chrome_plugin::{
    protocol::{BrowserReply, BrowserRequest, Operation},
    transport,
};

struct Registry(PathBuf);

impl Registry {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("chrome-discovery-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("endpoints")).unwrap();
        Self(root)
    }

    fn add(&self, id: u128, port: u16) -> Endpoint {
        let endpoint = Endpoint {
            id: Uuid::from_u128(id).to_string(),
            port,
            name: "Chrome".into(),
        };
        fs::write(self.path(&endpoint), serde_json::to_vec(&endpoint).unwrap()).unwrap();
        endpoint
    }

    fn path(&self, endpoint: &Endpoint) -> PathBuf {
        self.0
            .join("endpoints")
            .join(format!("{}.json", endpoint.id))
    }
}

impl Drop for Registry {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

struct FakeHost {
    port: u16,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl FakeHost {
    fn start(reply: Option<BrowserReply>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let worker = thread::spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        // Windows accepted sockets inherit the listener's nonblocking mode.
                        stream.set_nonblocking(false).unwrap();
                        stream
                            .set_read_timeout(Some(Duration::from_secs(3)))
                            .unwrap();
                        let request: BridgeRequest =
                            transport::read_frame(&mut stream, transport::MAX_REQUEST_BYTES)
                                .unwrap()
                                .unwrap();
                        assert!(matches!(request.request.operation, Operation::Status));
                        if let Some(reply) = reply.as_ref() {
                            transport::write_frame(
                                &mut stream,
                                reply,
                                transport::MAX_RESPONSE_BYTES,
                            )
                            .unwrap();
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(1))
                    }
                    Err(error) => panic!("Fake host accept failed: {error}"),
                }
            }
        });
        Self {
            port,
            stop,
            worker: Some(worker),
        }
    }

    fn ready(paused: bool) -> Self {
        Self::start(Some(BrowserReply {
            result: Some(json!({"paused":paused})),
            error: None,
        }))
    }
}

impl Drop for FakeHost {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.worker.take().unwrap().join().unwrap();
    }
}

fn request() -> BridgeRequest {
    BridgeRequest {
        client_id: "a".repeat(64),
        token: "b".repeat(64),
        request: BrowserRequest {
            operation: Operation::Status,
            args: json!({}),
        },
    }
}

#[test]
fn finds_a_live_browser_after_sixty_nine_stale_records() {
    let registry = Registry::new();
    let live = FakeHost::ready(false);
    let dead = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    for id in 1..=69 {
        registry.add(id, dead.local_addr().unwrap().port());
    }
    let expected = registry.add(1000, live.port);
    drop(dead);

    let browsers = connected(&registry.0, &request());
    assert_eq!(browsers.len(), 1);
    assert_eq!(browsers[0].0.id, expected.id);
    assert_eq!(browsers[0].1["paused"], false);
    assert!(registry.path(&expected).exists());
}

#[test]
fn scans_past_two_hundred_fifty_six_invalid_or_rejected_records() {
    let registry = Registry::new();
    let denied = FakeHost::start(Some(BrowserReply {
        result: None,
        error: Some("Unauthorized".into()),
    }));
    let live = FakeHost::ready(false);
    let paused = FakeHost::ready(true);
    for id in 1..=300 {
        registry.add(id, denied.port);
    }
    for id in 301..=600 {
        fs::write(
            registry.0.join("endpoints").join(format!("{id}.json")),
            b"invalid",
        )
        .unwrap();
    }
    let first = registry.add(1000, live.port);
    let second = registry.add(1001, paused.port);

    let browsers = connected(&registry.0, &request());
    assert_eq!(
        browsers
            .iter()
            .map(|(endpoint, _)| &endpoint.id)
            .collect::<Vec<_>>(),
        vec![&first.id, &second.id]
    );
    assert_eq!(browsers[1].1["paused"], true);
    assert_eq!(
        fs::read_dir(registry.0.join("endpoints")).unwrap().count(),
        602
    );
}

#[test]
fn limits_successful_results_but_can_address_a_browser_outside_the_list() {
    let registry = Registry::new();
    let live = FakeHost::ready(false);
    for id in 1..=40 {
        registry.add(id, live.port);
    }
    let selected = registry.add(1000, live.port);

    assert_eq!(
        connected(&registry.0, &request()).len(),
        MAX_CONNECTED_BROWSERS
    );
    let selected = endpoint(&registry.0, &selected.id).unwrap();
    assert_eq!(
        native::call(&selected, &request()).unwrap().result.unwrap()["paused"],
        false
    );
    assert!(endpoint(&registry.0, "../../clients/private").is_none());
}

#[test]
fn removes_only_unchanged_records_after_connection_refused() {
    let registry = Registry::new();
    let endpoint = registry.add(1, 12345);
    let record = Record::read(registry.path(&endpoint)).unwrap();
    for kind in [
        io::ErrorKind::TimedOut,
        io::ErrorKind::PermissionDenied,
        io::ErrorKind::ConnectionReset,
    ] {
        record.remove_if_refused(&io::Error::from(kind));
        assert!(record.path.exists());
    }
    record.remove_if_refused(&io::Error::from(io::ErrorKind::ConnectionRefused));
    assert!(!record.path.exists());

    let mut endpoint = registry.add(1, 12345);
    let record = Record::read(registry.path(&endpoint)).unwrap();
    endpoint.name = "Renamed browser".into();
    fs::write(&record.path, serde_json::to_vec(&endpoint).unwrap()).unwrap();
    record.remove_if_refused(&io::Error::from(io::ErrorKind::ConnectionRefused));
    assert!(record.path.exists());
}

#[test]
fn preserves_a_listening_host_that_closes_without_a_status_reply() {
    let registry = Registry::new();
    let host = FakeHost::start(None);
    let endpoint = registry.add(1, host.port);
    assert!(connected(&registry.0, &request()).is_empty());
    assert!(registry.path(&endpoint).exists());
}

#[test]
fn rejects_mismatched_oversized_and_non_file_records() {
    let registry = Registry::new();
    let record = registry.add(1, 12345);
    let path = registry.path(&record);
    fs::write(&path, vec![b' '; MAX_RECORD_BYTES as usize + 1]).unwrap();
    assert!(endpoint(&registry.0, &record.id).is_none());
    let other = registry.add(2, 12345);
    fs::write(&path, serde_json::to_vec(&other).unwrap()).unwrap();
    assert!(endpoint(&registry.0, &record.id).is_none());
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(endpoint(&registry.0, &record.id).is_none());
    let zero_port = registry.add(3, 0);
    assert!(endpoint(&registry.0, &zero_port.id).is_none());
}
