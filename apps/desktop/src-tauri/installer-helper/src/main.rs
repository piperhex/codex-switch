#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(target_env = "msvc", not(target_feature = "crt-static")))]
compile_error!(
    "Installer helper requires static CRT linkage; use scripts/build-installer-helper.mjs."
);

mod events;
mod logging;
mod native;
#[path = "../../src/installer_lifecycle/protocol.rs"]
mod protocol;

use protocol::Event;
use std::os::windows::process::CommandExt;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const GRACE_PERIOD: Duration = Duration::from_secs(8);
const EXIT_TIMEOUT: Duration = Duration::from_secs(3);
const GUARD_LIMIT: Duration = Duration::from_secs(600);
const READY_TIMEOUT_MS: u32 = 15_000;
const POLL_MS: u32 = 100;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error("invalid installer shutdown arguments")]
    Arguments,
    #[error("Codex Switch has not finished exiting")]
    Timeout,
    #[error(transparent)]
    Io(#[from] io::Error),
}
type Result<T> = std::result::Result<T, Error>;

fn main() {
    if let Err(error) = run() {
        logging::write(format!("failed: {error}"));
        eprintln!("Codex Switch installer shutdown: {error}");
        std::process::exit(1);
    }
}

fn target_path(value: &std::ffi::OsStr) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    if !path.is_absolute()
        || path
            .file_name()
            .is_none_or(|name| !name.eq_ignore_ascii_case("csw.exe"))
    {
        return Err(Error::Arguments);
    }
    if path
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(Error::Arguments);
    }
    if path.try_exists()? {
        return Ok(path.canonicalize()?);
    }
    Ok(path)
}

fn run() -> Result<()> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    #[cfg(debug_assertions)]
    if args.first().is_some_and(|arg| arg == "fixture") {
        return fixture(&args);
    }
    let [operation, target, rest @ ..] = args.as_slice() else {
        return Err(Error::Arguments);
    };
    let target = target_path(target)?;
    logging::write(format!(
        "{} {}",
        operation.to_string_lossy(),
        target.display()
    ));
    match (operation.to_str(), rest) {
        (Some("stop"), []) => stop(&target),
        (Some("finish"), []) => finish(&target),
        (Some("guard"), [parent]) => {
            let pid = parent
                .to_str()
                .and_then(|value| value.parse().ok())
                .ok_or(Error::Arguments)?;
            guard(&target, pid)
        }
        _ => Err(Error::Arguments),
    }
}

fn stop(target: &Path) -> Result<()> {
    if !target.try_exists()? {
        logging::write("target does not exist; no running installation to close");
        return Ok(());
    }
    let ready = Event::open(target, "ready")?;
    if !protocol::installation_active(target)? {
        ready.reset()?;
        Event::open(target, "finish")?.reset()?;
        Command::new(env::current_exe()?)
            .arg("guard")
            .arg(target)
            .arg(native::parent_pid()?.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
    }
    if !ready.wait(READY_TIMEOUT_MS)? {
        finish(target)?;
        return Err(Error::Timeout);
    }
    Ok(())
}

fn finish(target: &Path) -> Result<()> {
    Event::open(target, "finish")?.set()?;
    let deadline = Instant::now() + EXIT_TIMEOUT;
    while protocol::installation_active(target)? {
        if Instant::now() >= deadline {
            return Err(Error::Timeout);
        }
        thread::sleep(Duration::from_millis(POLL_MS.into()));
    }
    Ok(())
}

struct Guard {
    active: Event,
    ready: Event,
}

impl Drop for Guard {
    fn drop(&mut self) {
        // Clear the gate even on error so a failed/cancelled installer cannot disable startup.
        for event in [&self.active, &self.ready] {
            if let Err(error) = event.reset() {
                eprintln!("installer gate cleanup failed: {error}");
            }
        }
    }
}

fn guard(target: &Path, parent_pid: u32) -> Result<()> {
    // MSI's service process can deny user-token handle access. Its exit callbacks and the
    // bounded lease still release the gate; never require elevation just to monitor it.
    let parent = native::Process::open(parent_pid, false).ok();
    let _lease = events::Lease::acquire(target)?;
    let guard = Guard {
        active: Event::open(target, "active")?,
        ready: Event::open(target, "ready")?,
    };
    let finish = Event::open(target, "finish")?;
    let original = fs::metadata(target)?.modified()?;
    guard.active.set()?;
    close_running(target)?;
    guard.ready.set()?;
    let deadline = Instant::now() + GUARD_LIMIT;
    while !finish.wait(POLL_MS)?
        && !parent.as_ref().is_some_and(|parent| parent.exited())
        && Instant::now() < deadline
    {
        // Legacy Chrome hosts cannot observe the gate. Stop relaunches only while the old
        // file remains in place; the newly installed version waits at its startup gate.
        if fs::metadata(target).and_then(|meta| meta.modified()).ok() == Some(original) {
            for (_, process) in native::matching(target)? {
                process.terminate()?;
            }
        }
    }
    Ok(())
}

fn close_running(target: &Path) -> Result<()> {
    let processes = native::matching(target)?;
    logging::write(format!("closing {} matching processes", processes.len()));
    for (pid, _) in &processes {
        native::request_close(*pid);
    }
    let deadline = Instant::now() + GRACE_PERIOD;
    while processes.iter().any(|(_, process)| !process.exited()) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(POLL_MS.into()));
    }
    for (_, process) in &processes {
        process.terminate()?;
    }
    let deadline = Instant::now() + EXIT_TIMEOUT;
    while processes.iter().any(|(_, process)| !process.exited()) {
        if Instant::now() >= deadline {
            return Err(Error::Timeout);
        }
        thread::sleep(Duration::from_millis(POLL_MS.into()));
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn fixture(args: &[std::ffi::OsString]) -> Result<()> {
    let target = env::current_exe()?.canonicalize()?;
    let active = Event::open(&target, "active")?;
    let _lease = if args.get(1).is_some_and(|value| value == "hold-gate") {
        let lease = events::Lease::acquire(&target)?;
        active.set()?;
        println!("ready");
        Some(lease)
    } else {
        None
    };
    if args.get(1).is_some_and(|value| value == "startup") {
        while protocol::installation_active(&target)? {
            thread::sleep(Duration::from_millis(POLL_MS.into()));
        }
        println!("ready");
        return Ok(());
    }
    let cooperative = args.get(1).is_some_and(|value| value == "cooperative");
    while !cooperative || !protocol::installation_active(&target)? {
        thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}
