use super::types::{Result, TerminalError};
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

pub(super) fn directory(cwd: Option<&str>) -> Result<PathBuf> {
    let path = match cwd.filter(|value| !value.trim().is_empty()) {
        Some(value) if !value.contains('\0') => PathBuf::from(value),
        Some(_) => return Err(TerminalError::Directory),
        None => dirs::home_dir().ok_or(TerminalError::Directory)?,
    };
    if !path.is_absolute() || !path.is_dir() {
        return Err(TerminalError::Directory);
    }
    path.canonicalize().map_err(|_| TerminalError::Directory)
}

#[cfg(windows)]
pub(super) fn shell(cwd: &Path) -> Result<(CommandBuilder, String)> {
    // Use the installed Windows shell directly; never resolve a program from the project directory.
    let system = std::env::var_os("SystemRoot").ok_or(TerminalError::Start)?;
    let program = PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = CommandBuilder::new(program);
    command.arg("-NoLogo");
    command.cwd(display_path(cwd));
    Ok((command, "PowerShell".into()))
}

#[cfg(not(windows))]
pub(super) fn shell(cwd: &Path) -> Result<(CommandBuilder, String)> {
    let program = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_file())
        .unwrap_or_else(|| PathBuf::from("/bin/sh"));
    let name = program
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or(TerminalError::Start)?;
    let mut command = CommandBuilder::new(&program);
    command.arg("-l");
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    Ok((command, name))
}

pub(super) fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(local) = value.strip_prefix(r"\\?\") {
            return local.to_owned();
        }
    }
    value.into_owned()
}
