fn export_diagnostic_logs_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
) -> Result<String, String> {
    let source = diagnostic_log_path(app).map_err(|_| "暂时无法读取诊断日志。".to_string())?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "暂时无法读取诊断日志。".to_string())?;
    let destination = PathBuf::from(path);
    validate_diagnostic_destination(&destination, &app_data)
        .map_err(|_| "请选择应用数据文件夹以外的位置保存日志。".to_string())?;
    let mut output = diagnostic_export_metadata(app);
    let logs =
        diagnostic_snapshot(&source).map_err(|_| "读取诊断日志失败，请重试。".to_string())?;
    for log in logs {
        append_export_records(&mut output, &log);
    }
    append_export_errors(&mut output);
    fs::write(&destination, output)
        .map_err(|_| "保存日志失败，请检查保存位置后重试。".to_string())?;
    Ok(destination.display().to_string())
}

fn validate_diagnostic_destination(destination: &Path, app_data: &Path) -> io::Result<()> {
    if !destination.is_absolute() || destination.file_name().is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid export path",
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    fs::create_dir_all(parent)?;
    let parent = fs::canonicalize(parent)?;
    let app_data = fs::canonicalize(app_data)?;
    let protected = parent.starts_with(&app_data)
        || (destination.exists() && fs::canonicalize(destination)?.starts_with(&app_data));
    if protected {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Protected application data",
        ));
    }
    Ok(())
}

fn diagnostic_export_metadata<R: Runtime>(app: &tauri::AppHandle<R>) -> String {
    let settings = read_app_settings(app).ok();
    let metadata = json!({
        "event": "diagnostic_export", "ts": unix_now(), "schemaVersion": DIAGNOSTIC_SCHEMA_VERSION,
        "appVersion": app.package_info().version.to_string(),
        "os": std::env::consts::OS, "arch": std::env::consts::ARCH,
        "rotationBytes": DIAGNOSTIC_LOG_MAX_BYTES,
        "retainedFiles": 2,
        "retryTimeoutSeconds": settings.as_ref().map(|value| value.upstream_429_retry_timeout_seconds),
        "sseIdleTimeout": settings.as_ref().map(|value| value.sse_idle_timeout),
        "responseIdleTimeoutSeconds": UPSTREAM_RESPONSE_IDLE_TIMEOUT.as_secs(),
        "connectTimeoutSeconds": UPSTREAM_CONNECT_TIMEOUT.as_secs()
    });
    format!("{metadata}\n")
}

fn diagnostic_snapshot(source: &Path) -> io::Result<Vec<Vec<u8>>> {
    let _guard = DIAGNOSTIC_FILE_LOCK
        .lock()
        .map_err(|_| io::Error::other("Diagnostic log lock unavailable"))?;
    let mut snapshots = Vec::new();
    for path in [source.with_extension("jsonl.old"), source.to_path_buf()] {
        match fs::read(path) {
            Ok(bytes) => snapshots.push(bytes),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(snapshots)
}

fn append_export_records(output: &mut String, bytes: &[u8]) {
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let mut entry = serde_json::from_slice::<Value>(line).unwrap_or_else(|_| json!({
            "event": "unreadable_diagnostic_record", "bytes": line.len(), "hash": short_hash_bytes(line)
        }));
        sanitize_export_errors(&mut entry);
        output.push_str(&entry.to_string());
        output.push('\n');
    }
}

fn sanitize_export_errors(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                if matches!(key.as_str(), "error" | "text" | "message") && value.is_string() {
                    *value = json!(crate::error_logs::sanitize_diagnostic_message(
                        value.as_str().unwrap_or_default()
                    ));
                } else {
                    sanitize_export_errors(value);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(sanitize_export_errors),
        _ => {}
    }
}

fn append_export_errors(output: &mut String) {
    match crate::error_logs::export_proxy_errors() {
        Ok(page) => {
            for entry in page.entries.into_iter().rev() {
                let entry = json!({ "event": "proxy_error_history", "record": entry });
                output.push_str(&entry.to_string());
                output.push('\n');
            }
        }
        Err(_) => output.push_str("{\"event\":\"proxy_error_history_unavailable\"}\n"),
    }
}
