use super::{ComputerError, Result};
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

pub(super) fn asset() -> Result<(&'static str, &'static str)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok((
            "windows-x86_64",
            "4ea967b72209aefa8c25126feaedaba662b8bee8cdec01f69b2ff2b19d3781e7",
        )),
        ("windows", "aarch64") => Ok((
            "windows-arm64",
            "3785beda0735bf80904ab373cd745565cbd5e79a675675916fa137a13b5b0914",
        )),
        _ => Err(ComputerError::Unsupported),
    }
}

pub(super) fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command; // No Windows console flags on other hosts.
}
