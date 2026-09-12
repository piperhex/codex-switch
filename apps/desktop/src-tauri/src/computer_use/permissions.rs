//! Host-owned macOS permission UX. Polling never prompts or launches a driver.
use super::{ComputerError, Result};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
#[path = "permissions/macos.rs"]
mod macos;
#[cfg(target_os = "macos")]
pub(super) use macos::supported as supported_macos;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Permissions {
    accessibility: bool,
    screen_recording: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Permission {
    Accessibility,
    ScreenRecording,
}

pub(super) fn status() -> Option<Permissions> {
    #[cfg(target_os = "macos")]
    if macos::supported() {
        return Some(macos::status());
    }
    None
}

pub(super) fn request(permission: Permission) -> Result<()> {
    #[cfg(target_os = "macos")]
    if macos::supported() {
        return macos::request(permission);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = permission; // Only macOS has this permission flow.
    Err(ComputerError::Unsupported)
}
