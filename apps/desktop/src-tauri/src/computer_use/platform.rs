use super::{assets, ComputerError, Result};
use std::process::Command;
use std::sync::{atomic::AtomicBool, Arc};

pub(super) fn shutdown_signal() -> Result<Arc<AtomicBool>> {
    let shutdown = Arc::new(AtomicBool::new(false));
    #[cfg(windows)]
    {
        let signal = shutdown.clone();
        crate::installer_lifecycle::watch(move || {
            signal.store(true, std::sync::atomic::Ordering::Release)
        })
        .map_err(|_| ComputerError::Startup)?;
    }
    Ok(shutdown)
}

pub(super) fn asset() -> Result<assets::Asset> {
    #[cfg(target_os = "macos")]
    if !super::permissions::supported_macos() {
        return Err(ComputerError::Unsupported);
    }
    assets::select(std::env::consts::OS, std::env::consts::ARCH)
}

pub(super) fn configure_driver(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    #[cfg(target_os = "macos")]
    command.env("CUA_DRIVER_HOST_BUNDLE_ID", "dev.codex.switch");
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = command; // No Windows console flags on other hosts.
}

pub(super) fn set_executable(path: &std::path::Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|_| ComputerError::Storage)?;
    }
    #[cfg(not(unix))]
    let _ = path; // Windows does not use Unix execute bits.
    Ok(())
}

pub(super) fn executable_present(path: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    path.is_file()
}
