//! Desktop IPC can use the privileged worker; the remote viewer keeps its existing signaling and media connection.
use super::{control, ServiceError};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

const PREFIX: &str = "service:";
pub(crate) fn delegated(id: &str) -> bool {
    id.starts_with(PREFIX)
}
fn identifier(id: &str) -> std::result::Result<&str, String> {
    id.strip_prefix(PREFIX)
        .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        .ok_or_else(|| ServiceError::Invalid.to_string())
}
pub(crate) async fn open(
    display_id: Option<String>,
    expires_at: Option<u64>,
) -> std::result::Result<Option<crate::remote_desktop::displays::Opened>, String> {
    // An optional service-manager restriction must not remove the existing user-session desktop path.
    if expires_at.is_none() || !control::running().await.unwrap_or(false) {
        return Ok(None);
    }
    let value = control::desktop(
        "remote_desktop_open",
        json!({"displayId":display_id,"expiresAt":expires_at}),
    )
    .await
    .map_err(|error| error.to_string())?;
    let mut opened: crate::remote_desktop::displays::Opened =
        serde_json::from_value(value).map_err(|_| ServiceError::Invalid.to_string())?;
    opened.id = format!("{PREFIX}{}", opened.id);
    Ok(Some(opened))
}
pub(crate) async fn call<T: DeserializeOwned>(
    command: &str,
    id: &str,
    mut args: Value,
) -> std::result::Result<T, String> {
    let id = identifier(id)?;
    if let Some(request) = args.get_mut("request") {
        request["id"] = id.into();
    } else {
        args["id"] = id.into();
    }
    serde_json::from_value(
        control::desktop(command, args)
            .await
            .map_err(|error| error.to_string())?,
    )
    .map_err(|_| ServiceError::Invalid.to_string())
}
