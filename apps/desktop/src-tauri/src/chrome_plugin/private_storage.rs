use std::{fs, path::Path};

use super::{BrowserError, Result};

/// Keep credentials and atomic-write temporary files private before writing any token bytes.
pub(super) fn prepare_clients(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .map_err(|_| BrowserError::Storage)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| BrowserError::Storage)
    }
    #[cfg(not(unix))]
    {
        // Windows inherits the current user's AppData ACL.
        fs::create_dir_all(path).map_err(|_| BrowserError::Storage)
    }
}
