use std::path::Path;
use tokio::process::Command;

use super::error::Result;

pub(super) fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW: CLI transport must not open a console.
    #[cfg(not(windows))]
    let _ = command;
}

pub(super) fn protect_auth(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| super::error::GuiError::Startup)?;
    }
    #[cfg(not(unix))]
    let _ = path; // Windows inherits the current user's AppData ACL.
    Ok(())
}
