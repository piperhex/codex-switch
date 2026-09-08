use std::path::Path;
use tokio::process::Command;

pub(super) fn execution_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
    }
    #[cfg(not(windows))]
    value.into_owned()
}

pub(super) fn comparable_path(path: &str) -> String {
    #[cfg(windows)]
    {
        let path = execution_path(Path::new(path)).replace('\\', "/");
        path.strip_prefix("//?/")
            .unwrap_or(&path)
            .trim_end_matches('/')
            .to_lowercase()
    }
    #[cfg(not(windows))]
    path.trim_end_matches('/').to_owned()
}

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
