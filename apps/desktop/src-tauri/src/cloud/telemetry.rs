use super::*;

pub(super) fn installation_state_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?
        .join("installation.json"))
}

pub(super) fn read_or_create_installation_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<InstallationState, String> {
    let path = installation_state_path(app)?;
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(state) = serde_json::from_slice::<InstallationState>(&bytes) {
            if Uuid::parse_str(&state.device_id).is_ok() {
                return Ok(state);
            }
        }
    }
    let state = InstallationState {
        device_id: Uuid::new_v4().to_string(),
        platform: std::env::consts::OS.to_string(),
        reported_at: None,
        reported_version: None,
    };
    let value = serde_json::to_value(&state).map_err(|error| error.to_string())?;
    write_json_atomic(&path, &value)?;
    Ok(state)
}

pub(super) fn post_device_event<R: Runtime>(
    app: &tauri::AppHandle<R>,
    installation: &InstallationState,
    event_type: &str,
) -> Result<(), String> {
    if !telemetry_enabled() {
        return Ok(());
    }
    let client = api_client()?;
    let settings = read_app_settings(app)?;
    let app_version = app.package_info().version.to_string();
    let response = client
        .post(endpoint(&settings, "/telemetry/installations")?)
        .header("Accept", "application/json")
        .json(&json!({
            "deviceId": installation.device_id,
            "platform": installation.platform,
            "appVersion": app_version,
            "eventType": event_type,
        }))
        .send()
        .map_err(|error| request_error("Device event report", error))?;
    if !response.status().is_success() {
        return Err(response_error("Device event report", response));
    }
    Ok(())
}

pub(super) fn report_device_activity_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    if !telemetry_enabled() {
        return Ok(());
    }
    let installation = read_or_create_installation_state(app)?;
    post_device_event(app, &installation, "activity")
}

/// Marks this device active after every fixed number of completed global usage records.
/// Reporting happens in the background so it cannot delay proxy responses.
pub(crate) fn report_device_activity_after_usage<R: Runtime>(app: tauri::AppHandle<R>) {
    if !telemetry_enabled() {
        return;
    }
    let usage_count = USAGE_SINCE_LAST_ACTIVITY_REPORT.fetch_add(1, Ordering::Relaxed) + 1;
    if !usage_count.is_multiple_of(ACTIVITY_REPORT_USAGE_INTERVAL) {
        return;
    }

    std::thread::spawn(move || {
        if let Err(error) = report_device_activity_blocking(&app) {
            eprintln!("failed to report device activity: {error}");
        }
    });
}

/// Tests must never report mock installations or usage to the production service.
pub(super) fn telemetry_enabled() -> bool {
    !cfg!(test)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_app_telemetry_never_creates_an_installation_or_schedules_reports() {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        let identifier = format!("com.codex-switch.telemetry-test.{}", Uuid::new_v4());
        context.config_mut().identifier = identifier.clone();
        let app = tauri::test::mock_builder().build(context).unwrap();
        let handle = app.handle();
        let state_path = installation_state_path(handle).unwrap();
        // Even if the isolation guard regresses, this test cannot reach production.
        let settings = AppSettings {
            cloud_base_url: Some("http://127.0.0.1:9".into()),
            ..AppSettings::default()
        };
        write_app_settings(handle, &settings).unwrap();
        let count_before = USAGE_SINCE_LAST_ACTIVITY_REPORT.load(Ordering::Relaxed);

        assert!(!telemetry_enabled());
        assert!(
            !tauri::async_runtime::block_on(report_first_installation(handle.clone())).unwrap()
        );
        tauri::async_runtime::block_on(report_device_activity(handle.clone())).unwrap();
        tauri::async_runtime::block_on(report_base_url_change(handle.clone())).unwrap();
        for _ in 0..=ACTIVITY_REPORT_USAGE_INTERVAL {
            report_device_activity_after_usage(handle.clone());
        }

        assert!(!state_path.exists());
        assert_eq!(
            USAGE_SINCE_LAST_ACTIVITY_REPORT.load(Ordering::Relaxed),
            count_before
        );
        let directory = handle.path().app_data_dir().unwrap();
        assert_eq!(
            directory.file_name().unwrap().to_str(),
            Some(identifier.as_str())
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
