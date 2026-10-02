//! Capture notification routing locally, then recheck it before delivery.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PushIdentity {
    pub(crate) base_url: String,
    pub(crate) owner_id: String,
    pub(crate) device_id: String,
}

fn identity<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
) -> Result<Option<PushIdentity>, String> {
    let Some(owner_id) = settings.cloud_user_id.clone() else {
        return Ok(None);
    };
    Ok(Some(PushIdentity {
        base_url: base_url(settings)?.trim_end_matches('/').to_owned(),
        owner_id,
        device_id: read_or_create_installation_state(app)?.device_id,
    }))
}

/// Local reads only: never require the server to be reachable before saving an event.
pub(crate) fn push_identity(app: &tauri::AppHandle) -> Result<Option<PushIdentity>, String> {
    let _guard = lock_cloud_credentials()?;
    identity(app, &read_app_settings(app)?)
}

/// Saved events must never borrow another account's credentials after logout or server switching.
pub(crate) fn push_access_token(
    app: &tauri::AppHandle,
    expected: &PushIdentity,
) -> Result<Option<String>, String> {
    let _guard = lock_cloud_credentials()?;
    let mut settings = read_app_settings(app)?;
    if identity(app, &settings)?.as_ref() != Some(expected) {
        return Ok(None);
    }
    let mut credentials = read_cloud_credentials(app);
    let Some(token) = credentials.access_token.as_ref() else {
        return Ok(None);
    };
    if access_token_expires_soon(token) {
        refresh_cloud_token(app, &api_client()?, &mut settings, &mut credentials)?;
        write_app_settings(app, &settings)?;
        write_cloud_credentials(app, &credentials)?;
    }
    Ok(credentials.access_token)
}
