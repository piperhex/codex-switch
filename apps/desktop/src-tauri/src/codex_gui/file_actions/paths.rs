use super::{FileError, FileTarget, Result};
use std::path::{Path, PathBuf};

pub(super) fn source(target: &FileTarget) -> Result<PathBuf> {
    let value = &target.path;
    if value.is_empty()
        || value.len() > 4096
        || value.chars().any(char::is_control)
        || target.line == Some(0)
        || target.column == Some(0)
    {
        return Err(FileError::Path);
    }
    validate_local(value)?;
    Ok(PathBuf::from(value))
}

fn validate_local(value: &str) -> Result<()> {
    let normalized = value.replace('\\', "/");
    if normalized.starts_with("//") || normalized.contains("://") {
        return Err(FileError::Path);
    }
    #[cfg(windows)]
    super::windows::validate_path(&normalized)?;
    Ok(())
}

pub(super) fn resolve(source: &Path, workspace: &Path, allow_missing: bool) -> Result<PathBuf> {
    let path = workspace.join(source);
    if !path.is_absolute() {
        return Err(FileError::Path);
    }
    let path = match path.canonicalize() {
        Ok(path) => path,
        Err(_) if allow_missing => return Ok(path),
        Err(_) => return Err(FileError::Missing),
    };
    // A local symlink must not redirect a click to a network share or a device.
    validate_local(&super::super::platform::execution_path(&path))?;
    let metadata = path.metadata().map_err(|_| FileError::Missing)?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(FileError::Path);
    }
    Ok(path)
}
