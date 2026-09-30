use super::*;
use std::{fs, io::Read, path::PathBuf};
use tiny_http::{Header, Method, TestRequest};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("hosted-preview-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }

    fn load(&self, name: &str, bytes: &[u8]) -> (PreviewData, server::Scope) {
        let path = self.0.join(name);
        fs::write(&path, bytes).unwrap();
        let target = serde_json::from_value(serde_json::json!({
            "path": path, "threadId": null, "line": 12, "column": 3,
        }))
        .unwrap();
        load_session(&path, &target).unwrap().unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn request(url: &str) -> TestRequest {
    TestRequest::new()
        .with_path(url)
        .with_method(Method::Get)
        .with_header(Header::from_bytes("Host", "192.168.1.20:18080").unwrap())
}

fn body(response: ResponseBox) -> String {
    let mut body = String::new();
    response.into_reader().read_to_string(&mut body).unwrap();
    body
}

#[test]
fn hosted_previews_preserve_kind_location_and_stream_from_the_listener_origin() {
    let fixture = Fixture::new();
    for (name, kind) in [
        ("说明 #1+%.md", content::PreviewKind::Markdown),
        ("index.html", content::PreviewKind::Html),
        ("code.rs", content::PreviewKind::Text),
        ("picture.svg", content::PreviewKind::Image),
        ("report.pdf", content::PreviewKind::Pdf),
        ("movie.mp4", content::PreviewKind::Video),
        ("sound.wav", content::PreviewKind::Audio),
    ] {
        let (data, scope) = fixture.load(name, b"preview contents");
        assert_eq!(data.kind, kind);
        assert_eq!((data.line, data.column), (Some(12), Some(3)));
        assert!(data.url.starts_with(PATH_PREFIX));
        assert!(!data.url.contains("localhost"));
        let response = prepare_response(&request(&data.url).into(), Some(&scope));
        assert_eq!(response.status_code(), StatusCode(200));
        assert_eq!(body(response), "preview contents");
    }
}

#[test]
fn hosted_assets_are_scoped_and_html_is_isolated_from_the_host_application() {
    let fixture = Fixture::new();
    let (data, scope) = fixture.load("index.html", b"<h1>preview</h1>");
    fixture.load("style.css", b"h1 { color: red }");
    fixture.load(".env", b"SECRET=private");
    let base = data.url.rsplit_once('/').unwrap().0;
    let page = prepare_response(&request(&data.url).into(), Some(&scope));
    assert!(page
        .headers()
        .iter()
        .any(|header| header.field.equiv("Content-Security-Policy")
            && header.value.as_str().contains("sandbox allow-scripts")));
    assert_eq!(
        body(prepare_response(
            &request(&format!("{base}/style.css")).into(),
            Some(&scope)
        )),
        "h1 { color: red }"
    );
    for url in [
        format!("{base}/.env"),
        format!("{base}/%2e%2e/style.css"),
        format!("{base}/%2fetc/passwd"),
        format!("{PATH_PREFIX}wrong/index.html"),
    ] {
        assert_eq!(
            prepare_response(&request(&url).into(), Some(&scope)).status_code(),
            StatusCode(404)
        );
    }
    let post = request(&data.url).with_method(Method::Post).into();
    assert_eq!(
        prepare_response(&post, Some(&scope)).status_code(),
        StatusCode(403)
    );
}

#[test]
fn hosted_media_preserves_range_headers_for_seeking_and_pdf_loading() {
    let fixture = Fixture::new();
    let (data, scope) = fixture.load("movie.mp4", b"0123456789");
    let ranged = request(&data.url)
        .with_header(Header::from_bytes("Range", "bytes=2-5").unwrap())
        .into();
    let response = prepare_response(&ranged, Some(&scope));
    assert_eq!(response.status_code(), StatusCode(206));
    assert!(response.headers().iter().any(
        |header| header.field.equiv("Content-Range") && header.value.as_str() == "bytes 2-5/10"
    ));
    assert_eq!(body(response), "2345");
    let invalid = request(&data.url)
        .with_header(Header::from_bytes("Range", "bytes=10-").unwrap())
        .into();
    assert_eq!(
        prepare_response(&invalid, Some(&scope)).status_code(),
        StatusCode(416)
    );
}

#[test]
fn alternate_html_and_xml_documents_cannot_gain_the_listener_origin() {
    let fixture = Fixture::new();
    for name in ["page.shtml", "page.xml", "page.xhtml", "image.svg"] {
        let (data, scope) = fixture.load(name, b"<html>preview</html>");
        let response = prepare_response(&request(&data.url).into(), Some(&scope));
        assert!(
            response
                .headers()
                .iter()
                .any(|header| header.field.equiv("Content-Security-Policy")
                    && header.value.as_str().contains("sandbox allow-scripts")),
            "{name}"
        );
    }
}

#[test]
fn missing_closed_and_expired_sessions_cannot_serve_files() {
    let fixture = Fixture::new();
    let (data, scope) = fixture.load("readme.md", b"hello");
    let mut sessions = HostedSessions::default();
    assert!(sessions.scope(&data.url).is_none());
    sessions.insert(data.session_id.clone(), scope);
    assert!(sessions.scope(&data.url).is_some());
    sessions.0.get_mut(&data.session_id).unwrap().last_used = Instant::now() - IDLE_TIMEOUT;
    assert!(sessions.scope(&data.url).is_none());
    assert!(sessions.0.is_empty());
    let (data, scope) = fixture.load("readme.md", b"hello");
    sessions.insert(data.session_id.clone(), scope);
    sessions.0.remove(&data.session_id);
    let response = prepare_response(
        &request(&data.url).into(),
        sessions.scope(&data.url).as_deref(),
    );
    assert_eq!(response.status_code(), StatusCode(404));
}

#[test]
fn abandoned_browser_sessions_remain_bounded() {
    let fixture = Fixture::new();
    let mut sessions = HostedSessions::default();
    let (oldest, scope) = fixture.load("readme.md", b"hello");
    sessions.insert(oldest.session_id.clone(), scope);
    sessions.0.get_mut(&oldest.session_id).unwrap().last_used -= Duration::from_secs(1);
    for _ in 0..MAX_SESSIONS {
        let (data, scope) = fixture.load("readme.md", b"hello");
        sessions.insert(data.session_id, scope);
    }
    assert_eq!(sessions.0.len(), MAX_SESSIONS);
    assert!(sessions.scope(&oldest.url).is_none());
}
