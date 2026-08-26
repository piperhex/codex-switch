fn handle_request(app: AppHandle, request: Request, security: WebRequestSecurity) {
    if request.url().split('?').next() == Some(WEB_INVOKE_PATH) {
        handle_invoke_request(app, request, &security);
        return;
    }

    if !matches!(request.method(), Method::Get | Method::Head) {
        respond_text(request, StatusCode(405), "Method not allowed");
        return;
    }

    let Some(path) = asset_path(request.url()) else {
        respond_text(request, StatusCode(400), "Invalid asset path");
        return;
    };
    let is_index = path == "index.html" || !path.contains('.');
    let asset = app.asset_resolver().get(path.clone()).or_else(|| {
        (!path.contains('.'))
            .then(|| app.asset_resolver().get("index.html".into()))
            .flatten()
    });
    let Some(asset) = asset else {
        respond_text(request, StatusCode(404), "Not found");
        return;
    };

    let bytes = if is_index {
        inject_hosted_runtime_marker(asset.bytes.as_ref())
    } else {
        asset.bytes
    };
    let mut response = Response::from_data(bytes).with_status_code(StatusCode(200));
    response.add_header(header("Content-Type", &asset.mime_type));
    response.add_header(header(
        "Content-Security-Policy",
        WEB_CONTENT_SECURITY_POLICY,
    ));
    response.add_header(header("X-Content-Type-Options", "nosniff"));
    response.add_header(header("X-Frame-Options", "DENY"));
    response.add_header(header("Referrer-Policy", "no-referrer"));
    response.add_header(header(
        "Cache-Control",
        if is_index {
            "no-cache"
        } else {
            "public, max-age=31536000, immutable"
        },
    ));
    let _ = request.respond(response);
}

fn handle_invoke_request(app: AppHandle, mut request: Request, security: &WebRequestSecurity) {
    if request.method() != &Method::Post {
        respond_text(request, StatusCode(405), "Method not allowed");
        return;
    }
    let access = match security.authorize(&request) {
        Ok(access) => access,
        Err(status) => {
            let message = if status == StatusCode(403) {
                "Request origin is not allowed"
            } else {
                "A valid LAN access key is required"
            };
            respond_text(request, status, message);
            return;
        }
    };
    if !request.headers().iter().any(|header| {
        header.field.equiv("Content-Type") && header.value.as_str().starts_with("application/json")
    }) {
        respond_text(
            request,
            StatusCode(415),
            "Expected an application/json request",
        );
        return;
    }
    if request
        .body_length()
        .is_some_and(|length| length > MAX_INVOKE_BODY_BYTES)
    {
        respond_text(request, StatusCode(413), "Request body is too large");
        return;
    }

    let mut body = String::new();
    let read_result = request
        .as_reader()
        .take((MAX_INVOKE_BODY_BYTES + 1) as u64)
        .read_to_string(&mut body);
    if read_result.is_err() || body.len() > MAX_INVOKE_BODY_BYTES {
        respond_text(request, StatusCode(400), "Could not read the request body");
        return;
    }
    let invocation = match serde_json::from_str::<WebInvokeRequest>(&body) {
        Ok(invocation) => invocation,
        Err(error) => {
            respond_text(
                request,
                StatusCode(400),
                &format!("Invalid invoke request: {error}"),
            );
            return;
        }
    };
    if !access.allows_command(&invocation.command) {
        respond_text(
            request,
            StatusCode(403),
            "This action is not available over LAN access",
        );
        return;
    }
    let response = match dispatch_command(app, &invocation.command, invocation.args) {
        Ok(result) => WebInvokeResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => WebInvokeResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };
    respond_json(request, StatusCode(200), &response);
}
