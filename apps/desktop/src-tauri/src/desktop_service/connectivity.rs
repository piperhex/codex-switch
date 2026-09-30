use super::{Result, ServiceError};
use serde_json::Value;

/// Scope the JSON bridge to one trusted, bundled Node service child.
pub(super) struct Lifetime;

impl Drop for Lifetime {
    fn drop(&mut self) {
        // Cancellation is synchronous so a delayed cleanup cannot cancel a replacement host's sessions.
        if let Err(error) = csw_chat_connectivity::close_native_bridges() {
            eprintln!("service connectivity cleanup: {error}");
        }
    }
}

pub(super) async fn call(args: Value) -> Result<Value> {
    let request = args
        .get("request")
        .ok_or(ServiceError::Invalid)?
        .to_string();
    let response =
        tokio::task::spawn_blocking(move || csw_chat_connectivity::bridge_call(&request))
            .await
            .map_err(|_| ServiceError::Unavailable)?;
    serde_json::from_str(&response).map_err(|_| ServiceError::Invalid)
}
