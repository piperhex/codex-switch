use super::{install, package, platform, state, ComputerError, Result};
use std::{
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};

const REVOCATION_INTERVAL: Duration = Duration::from_millis(250);

struct Driver(Child);

impl Drop for Driver {
    fn drop(&mut self) {
        if let Ok(Some(_)) = self.0.try_wait() {
            return;
        }
        if self.0.kill().is_err() {
            eprintln!("Could not stop computer-use session");
        }
        if self.0.wait().is_err() {
            eprintln!("Could not reap computer-use session");
        }
    }
}

pub(super) fn run(root: &Path, id: &str) -> Result<()> {
    let shutdown = platform::shutdown_signal()?;
    let record = state::read(root, id)?
        .filter(|record| record.enabled)
        .ok_or(ComputerError::Disabled)?;
    if !install::configured(&record.home, true)? || !package::present(root)? {
        return Err(ComputerError::Disabled);
    }
    let mut command = Command::new(package::executable(root)?);
    command
        .args(["mcp", "--direct"])
        .env("CUA_DRIVER_PERMISSION_MODE", "standard")
        .env("CUA_DRIVER_RS_TELEMETRY_ENABLED", "0")
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    platform::hide_window(&mut command);
    let mut driver = Driver(command.spawn().map_err(|_| ComputerError::Startup)?);
    loop {
        if !state::allowed(root, id, &record.generation) {
            return Ok(());
        }
        if shutdown.load(std::sync::atomic::Ordering::Acquire) {
            return Ok(());
        }
        if let Some(status) = driver.0.try_wait().map_err(|_| ComputerError::Startup)? {
            return if status.success() {
                Ok(())
            } else {
                Err(ComputerError::Startup)
            };
        }
        thread::sleep(REVOCATION_INTERVAL);
    }
}
