fn inject_hosted_runtime_marker(bytes: &[u8]) -> Vec<u8> {
    let Ok(html) = std::str::from_utf8(bytes) else {
        return bytes.to_vec();
    };
    if html.contains(HOSTED_RUNTIME_MARKER) {
        return bytes.to_vec();
    }
    if let Some(index) = html.find("<head>") {
        let insert_at = index + "<head>".len();
        let mut output = String::with_capacity(html.len() + HOSTED_RUNTIME_MARKER.len());
        output.push_str(&html[..insert_at]);
        output.push_str(HOSTED_RUNTIME_MARKER);
        output.push_str(&html[insert_at..]);
        return output.into_bytes();
    }
    bytes.to_vec()
}

fn asset_path(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?.trim_start_matches('/');
    if path.is_empty() {
        return Some("index.html".to_string());
    }
    if path.contains('\\')
        || path
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return None;
    }
    Some(path.to_string())
}

fn respond_text(request: Request, status: StatusCode, message: &str) {
    let response = Response::from_string(message)
        .with_status_code(status)
        .with_header(header("Content-Type", "text/plain; charset=utf-8"))
        .with_header(header("Cache-Control", "no-store"));
    let _ = request.respond(response);
}

fn respond_json<T: Serialize>(request: Request, status: StatusCode, value: &T) {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| {
        serde_json::to_vec(&json!({
            "ok": false,
            "error": "Could not serialize the response"
        }))
        .expect("static JSON response must serialize")
    });
    let response = Response::from_data(body)
        .with_status_code(status)
        .with_header(header("Content-Type", "application/json; charset=utf-8"))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("X-Content-Type-Options", "nosniff"));
    let _ = request.respond(response);
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes())
        .expect("static web server headers must be valid")
}
