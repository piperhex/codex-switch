use super::*;
use std::{sync::mpsc, thread};
use tiny_http::{Response, Server};

fn serve(body: String, status: u16) -> (Url, thread::JoinHandle<()>) {
    let server = Server::http("127.0.0.1:0").unwrap();
    let url = settings_url(
        &format!("http://{}", server.server_addr()),
        "/chat/title-settings",
    )
    .unwrap();
    let task = thread::spawn(move || {
        let request = server
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        assert_eq!(request.url(), "/chat/title-settings");
        assert!(request.headers().iter().any(|header| {
            header.field.equiv("Cache-Control") && header.value.as_str().contains("no-store")
        }));
        assert!(!request
            .headers()
            .iter()
            .any(|header| header.field.equiv("Authorization")));
        request
            .respond(Response::from_string(body).with_status_code(status))
            .unwrap();
    });
    (url, task)
}

#[test]
fn reads_server_title_model_and_effort_without_credentials() {
    let (url, server) = serve(r#"{"model":"gpt-6-luna","effort":"low"}"#.into(), 200);
    let settings: TitleSettings =
        request_settings(&Client::builder().no_proxy().build().unwrap(), url).unwrap();
    assert!(settings.is_valid());
    assert_eq!(
        serde_json::to_value(settings).unwrap(),
        serde_json::json!({
            "model": "gpt-6-luna", "effort": "low"
        })
    );
    server.join().unwrap();
}

#[test]
fn rejects_failed_malformed_and_oversized_responses() {
    for (status, body) in [
        (404, "not deployed".to_owned()),
        (200, "<html>legacy server</html>".to_owned()),
        (200, r#"{"model":"x","effort":"unknown"}"#.to_owned()),
        (200, " ".repeat(MAX_SETTINGS_BYTES as usize + 1)),
    ] {
        let (url, server) = serve(body, status);
        let result =
            request_settings::<TitleSettings>(&Client::builder().no_proxy().build().unwrap(), url);
        assert!(result.is_err());
        server.join().unwrap();
    }
}

#[test]
fn accepts_http_server_prefixes_and_rejects_non_server_addresses() {
    assert_eq!(
        settings_url(" https://example.test/api/ ", "/chat/title-settings")
            .unwrap()
            .as_str(),
        "https://example.test/api/chat/title-settings"
    );
    for base in [
        "",
        "file:///private",
        "javascript:alert(1)",
        "ftp://host",
        "https://user:secret@host",
        "https://host?endpoint=other",
        "https://host#fragment",
    ] {
        assert!(
            settings_url(base, "/chat/title-settings").is_err(),
            "{base}"
        );
    }
    assert!(serde_json::from_str::<HomePresetPlatform>(r#""linux&path=other""#).is_err());
}

#[tokio::test(flavor = "current_thread")]
async fn preset_request_keeps_the_async_caller_responsive() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr());
    let (arrived, waiting) = tokio::sync::oneshot::channel();
    let (release, resume) = mpsc::channel();
    let worker = thread::spawn(move || {
        let request = server
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        assert_eq!(request.url(), "/codex-home-presets?platform=macos");
        arrived.send(()).unwrap();
        resume.recv_timeout(Duration::from_secs(3)).unwrap();
        request
            .respond(Response::from_string(
                r#"[{"id":"work","name":"Work","path":"/work"}]"#,
            ))
            .unwrap();
    });
    let pending = tokio::spawn(fetch_cloud_home_presets(base, HomePresetPlatform::Macos));
    tokio::time::timeout(Duration::from_secs(3), waiting)
        .await
        .unwrap()
        .unwrap();
    // The server cannot finish until this same async executor gets a turn.
    assert!(!pending.is_finished());
    release.send(()).unwrap();
    let presets = pending.await.unwrap().unwrap();
    assert_eq!(presets[0].path, "/work");
    worker.join().unwrap();
}

#[tokio::test]
async fn command_errors_do_not_expose_server_addresses_or_credentials() {
    let error = fetch_cloud_home_presets(
        "https://user:secret@private.test".into(),
        HomePresetPlatform::Windows,
    )
    .await
    .unwrap_err();
    assert_eq!(error, PRESETS_UNAVAILABLE);
}
