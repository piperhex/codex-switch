//! Coordinates normal application shutdown with Windows installers.
mod protocol;

use std::{path::PathBuf, thread, time::Duration};
use tauri::{AppHandle, Runtime};

const POLL_INTERVAL_MS: u32 = 250;

fn executable() -> std::io::Result<PathBuf> {
    std::env::current_exe()?.canonicalize()
}

/// New browser/MCP connections wait until the installer has finished replacing files.
pub(crate) fn wait_before_startup() -> std::io::Result<()> {
    let executable = executable()?;
    while protocol::installation_active(&executable)? {
        thread::sleep(Duration::from_millis(POLL_INTERVAL_MS.into()));
    }
    Ok(())
}

/// The callback runs on its own thread, never on the Windows message loop.
pub(crate) fn watch(on_shutdown: impl FnOnce() + Send + 'static) -> std::io::Result<()> {
    let executable = executable()?;
    let active = protocol::Event::open(&executable, "active")?;
    thread::Builder::new()
        .name("installer-shutdown".into())
        .spawn(move || {
            loop {
                match active.wait(POLL_INTERVAL_MS) {
                    Ok(true) => match protocol::installation_active(&executable) {
                        Ok(true) => break,
                        Ok(false) => thread::sleep(Duration::from_millis(POLL_INTERVAL_MS.into())),
                        Err(error) => {
                            eprintln!("installer lease query failed: {error}");
                            return;
                        }
                    },
                    Ok(false) => continue,
                    Err(error) => {
                        eprintln!("installer shutdown watcher failed: {error}");
                        return;
                    }
                }
            }
            on_shutdown();
        })?;
    Ok(())
}

pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) -> std::io::Result<()> {
    let app = app.clone();
    watch(move || {
        crate::floating_bubble::shutdown(&app);
        app.exit(0);
    })
}
