use super::{model::*, native::Stream};
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires an unlocked Windows desktop, prepared video runtime and Edge"]
async fn native_capture_reaches_a_real_browser_decoder() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources/remote-desktop/runtime/ffmpeg.exe");
    let id = super::super::open().expect("native input lease");
    let request = OpenRequest {
        id: id.clone(),
        profile: Profile {
            width: 1920,
            fps: 60,
            bitrate: 6_000_000,
        },
        ice_servers: std::env::var("CSW_NATIVE_TEST_ICE")
            .map(|json| serde_json::from_str(&json).expect("test ICE servers"))
            .unwrap_or_default(),
    };
    let (stream, offer) = Stream::open(path, request)
        .await
        .expect("native capture and encoder");
    let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").expect("local test bridge"));
    let endpoint = format!("http://{}", server.server_addr());
    let token = uuid::Uuid::new_v4().to_string();
    let stopped = Arc::new(AtomicBool::new(false));
    let worker = start_bridge(
        server,
        stream.clone(),
        offer,
        (token.clone(), stopped.clone()),
    );
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let result = tokio::process::Command::new("node")
        .arg(root.join("apps/desktop/e2e/native-desktop-stream.mjs"))
        .env("CSW_NATIVE_TEST_ENDPOINT", endpoint)
        .env("CSW_NATIVE_TEST_TOKEN", token)
        .output()
        .await;
    let connection = stream.stats.lock().await.connection;
    stopped.store(true, Ordering::Relaxed);
    stream.close().await;
    worker.join().expect("test bridge stopped");
    let output = result.expect("browser process");
    println!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    if std::env::var_os("CSW_NATIVE_TEST_ICE").is_some() {
        assert!(
            matches!(connection, Some(Connection::Relay)),
            "native selected relay pair"
        );
    }
}

fn start_bridge(
    server: Arc<tiny_http::Server>,
    stream: Arc<Stream>,
    offer: Offer,
    control: (String, Arc<AtomicBool>),
) -> std::thread::JoinHandle<()> {
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        while !control.1.load(Ordering::Relaxed) {
            let Ok(Some(mut request)) = server.recv_timeout(Duration::from_millis(100)) else {
                continue;
            };
            let authorized = request.headers().iter().any(|header| {
                header.field.equiv("X-Desktop-Test") && header.value.as_str() == control.0
            });
            if !authorized {
                request
                    .respond(tiny_http::Response::empty(403))
                    .expect("reject test caller");
                continue;
            }
            let mut body = String::new();
            request
                .as_reader()
                .take(128_000)
                .read_to_string(&mut body)
                .expect("test request");
            let result = if request.url() == "/offer" {
                serde_json::to_value(&offer).expect("offer JSON")
            } else {
                let mut value: serde_json::Value =
                    serde_json::from_str(&body).expect("signal JSON");
                value["id"] = stream.id.clone().into();
                let signal = serde_json::from_value(value).expect("signal request");
                serde_json::to_value(
                    runtime
                        .block_on(stream.signal(signal))
                        .expect("signal accepted"),
                )
                .expect("reply")
            };
            request
                .respond(tiny_http::Response::from_string(result.to_string()))
                .expect("test reply");
        }
    })
}
