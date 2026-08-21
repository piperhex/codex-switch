use super::*;

#[tauri::command]
pub(crate) async fn get_cloud_auth_state<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || get_cloud_auth_state_blocking(&app))
        .await
        .map_err(|error| format!("Cloud auth state task failed: {error}"))?
}

pub(super) fn get_cloud_auth_state_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    let _credentials_guard = lock_cloud_credentials()?;
    let settings = read_app_settings(app)?;
    let credentials = read_cloud_credentials(app);
    Ok(cloud_state(&settings, &credentials))
}

#[tauri::command]
pub(crate) async fn get_saved_cloud_login<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<SavedCloudLogin>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let settings = read_app_settings(&app)?;
        read_saved_cloud_login(&settings)
    })
    .await
    .map_err(|error| format!("Saved cloud login task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_cloud_base_url<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    base_url: String,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || set_cloud_base_url_blocking(&app, base_url))
        .await
        .map_err(|error| format!("Cloud base URL task failed: {error}"))?
}

pub(super) fn set_cloud_base_url_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    base_url: String,
) -> Result<CloudAuthState, String> {
    let _credentials_guard = lock_cloud_credentials()?;
    let mut settings = read_app_settings(app)?;
    let normalized = normalize_base_url(&base_url)?;
    if settings.cloud_base_url != normalized {
        clear_cloud_profile(&mut settings);
        settings.cloud_session_expired = false;
        clear_cloud_credentials(app)?;
    }
    settings.cloud_base_url = normalized;
    if settings.cloud_base_url.is_none() {
        clear_cloud_profile(&mut settings);
        settings.cloud_session_expired = false;
        clear_cloud_credentials(app)?;
    }
    write_app_settings(app, &settings)?;
    let credentials = read_cloud_credentials(app);
    Ok(cloud_state(&settings, &credentials))
}

#[tauri::command]
pub(crate) async fn cloud_login<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
    remember_password: bool,
) -> Result<CloudAuthenticationResult, String> {
    cloud_authenticate(
        app,
        email,
        password,
        None,
        remember_password,
        "/auth/login",
        "Cloud login",
    )
    .await
}

pub(super) fn feedback_form(
    content: &str,
    version: &str,
    platform: &str,
    contact_email: Option<&str>,
    images: &[FeedbackImage],
) -> Result<multipart::Form, String> {
    let mut form = multipart::Form::new()
        .text("content", content.to_string())
        .text("version", version.to_string())
        .text("platform", platform.to_string());
    if let Some(contact_email) = contact_email {
        form = form.text("email", contact_email.to_string());
    }
    for image in images {
        let part = multipart::Part::bytes(image.data.clone())
            .file_name(image.file_name.clone())
            .mime_str(&image.mime_type)
            .map_err(|error| format!("Feedback image type is invalid: {error}"))?;
        form = form.part("images", part);
    }
    Ok(form)
}

pub(super) fn validate_feedback(
    content: &str,
    version: &str,
    platform: &str,
    contact_email: Option<&str>,
    images: &[FeedbackImage],
) -> Result<(), String> {
    if content.trim().is_empty() || content.chars().count() > 5_000 {
        return Err("Feedback must contain between 1 and 5000 characters".to_string());
    }
    if version.trim().is_empty() || version.chars().count() > 40 {
        return Err("Feedback version is invalid".to_string());
    }
    if platform.trim().is_empty() || platform.chars().count() > 500 {
        return Err("Feedback platform information is invalid".to_string());
    }
    if let Some(contact_email) = contact_email {
        if contact_email.len() > 160 || !contact_email.contains('@') {
            return Err("Feedback contact email is invalid".to_string());
        }
    }
    if images.len() > MAX_FEEDBACK_IMAGES {
        return Err(format!(
            "At most {MAX_FEEDBACK_IMAGES} feedback images are allowed"
        ));
    }
    for image in images {
        if !FEEDBACK_IMAGE_MIME_TYPES.contains(&image.mime_type.as_str()) {
            return Err("Only JPEG, PNG and WebP feedback images are supported".to_string());
        }
        if image.data.len() > MAX_FEEDBACK_IMAGE_BYTES {
            return Err("Each feedback image must not exceed 5 MB".to_string());
        }
    }
    Ok(())
}

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
        .map_err(|error| format!("Device event report failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Device event report", response));
    }
    Ok(())
}

pub(super) fn report_device_activity_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let installation = read_or_create_installation_state(app)?;
    post_device_event(app, &installation, "activity")
}

/// Marks this device active after every fixed number of completed global usage records.
/// Reporting happens in the background so it cannot delay proxy responses.
pub(crate) fn report_device_activity_after_usage<R: Runtime>(app: tauri::AppHandle<R>) {
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

#[tauri::command]
pub(crate) async fn cloud_register<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
    verification_code: String,
    remember_password: bool,
) -> Result<CloudAuthenticationResult, String> {
    cloud_authenticate(
        app,
        email,
        password,
        Some(verification_code),
        remember_password,
        "/auth/register",
        "Cloud registration",
    )
    .await
}

#[tauri::command]
pub(crate) async fn cloud_change_password<R: Runtime>(
    app: tauri::AppHandle<R>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let mut credentials = read_cloud_credentials(&app);
        let remembered_new_password = new_password.clone();
        let response = cloud_request(
            &app,
            &client,
            &mut settings,
            &mut credentials,
            Method::PATCH,
            "/admin/api/profile/password",
            Some(json!({
                "currentPassword": current_password,
                "newPassword": new_password,
            })),
        )?;
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        if !response.status().is_success() {
            return Err(response_error("Cloud password change", response));
        }
        if let Ok(Some(mut saved_login)) = read_saved_cloud_login(&settings) {
            if settings.cloud_user_email.as_deref() == Some(saved_login.email.as_str()) {
                saved_login.password = remembered_new_password;
                if let Err(error) = update_saved_cloud_login(&settings, Some(&saved_login)) {
                    eprintln!("could not update saved cloud login after password change: {error}");
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Cloud password change task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_request_registration_code<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .post(endpoint(&settings, "/auth/register/code")?)
            .json(&json!({ "email": email }))
            .send()
            .map_err(|error| format!("Verification code request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("Verification code request", response));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Verification code request task failed: {error}"))?
}

pub(super) async fn cloud_authenticate<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
    verification_code: Option<String>,
    remember_password: bool,
    path: &'static str,
    action: &'static str,
) -> Result<CloudAuthenticationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let saved_login = SavedCloudLogin {
            email: email.trim().to_string(),
            password: password.clone(),
        };
        let mut payload = json!({ "email": email, "password": password });
        if let Some(code) = verification_code {
            payload["verificationCode"] = Value::String(code);
        }
        let response = client
            .post(endpoint(&settings, path)?)
            .json(&payload)
            .send()
            .map_err(|error| format!("{action} failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error(action, response));
        }
        let tokens: CloudTokenResponse = response
            .json()
            .map_err(|error| format!("{action} response is invalid: {error}"))?;
        let mut credentials = CloudCredentials {
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
            device_id: Some(read_or_create_installation_state(&app)?.device_id),
        };
        if let Some(user) = tokens.user {
            settings.cloud_user_id = Some(user.id);
            settings.cloud_user_email = Some(user.email);
        }
        settings.cloud_session_expired = false;
        // Merge cloud data before uploading so a new or returning device cannot publish an empty
        // or stale local copy over newer cloud fields during its first sync.
        let remote_accounts = get_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        for account_id in &remote_accounts.deleted_account_ids {
            apply_remote_account_deletion(&app, account_id)?;
        }
        for account in remote_accounts.accounts {
            apply_remote_account(&app, &account)?;
        }
        let remote_providers =
            get_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        for provider_id in &remote_providers.deleted_provider_ids {
            apply_remote_provider_deletion(&app, provider_id)?;
        }
        for provider in remote_providers.providers {
            apply_remote_provider(&app, &provider)?;
        }
        let _ = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        let _ = put_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        let (password_saved, credential_storage_updated) = if remember_password {
            match update_saved_cloud_login(&settings, Some(&saved_login)) {
                Ok(()) => (true, true),
                Err(error) => {
                    eprintln!("could not save cloud login: {error}");
                    (false, false)
                }
            }
        } else {
            match update_saved_cloud_login(&settings, None) {
                Ok(()) => (false, true),
                Err(error) => {
                    eprintln!("could not remove saved cloud login: {error}");
                    (false, false)
                }
            }
        };
        write_app_settings(&app, &settings)?;
        write_cloud_credentials(&app, &credentials)?;
        Ok(CloudAuthenticationResult {
            state: cloud_state(&settings, &credentials),
            password_saved,
            credential_storage_updated,
        })
    })
    .await
    .map_err(|error| format!("{action} task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_logout<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _credentials_guard = lock_cloud_credentials()?;
        let client = api_client()?;
        let mut settings = read_app_settings(&app)?;
        let credentials = read_cloud_credentials(&app);
        if credentials.refresh_token.is_some() && settings.cloud_base_url.is_some() {
            let _ = client
                .post(endpoint(&settings, "/auth/logout")?)
                .json(&json!({ "refreshToken": credentials.refresh_token.clone() }))
                .send();
        }
        clear_cloud_profile(&mut settings);
        settings.cloud_session_expired = false;
        clear_cloud_credentials(&app)?;
        write_app_settings(&app, &settings)?;
        Ok(cloud_state(&settings, &CloudCredentials::default()))
    })
    .await
    .map_err(|error| format!("Cloud logout task failed: {error}"))?
}
