//! Run the production entry point with simulated session storage and process launch.
//! No test stops or launches the user's desktop application.

use super::{
    CodexInstall, NativeSessionState, RuntimeLaunchReason, RuntimePaths, SkinVerificationMode,
};
use std::{
    cell::RefCell,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

static OPERATION_LOCK: Mutex<()> = Mutex::new(());
static TEST_LOCK: Mutex<()> = Mutex::new(());
static MONITOR: SimulatedMonitor = SimulatedMonitor;

struct SimulatedMonitor;

struct MonitorPaths {
    paths: Mutex<Option<RuntimePaths>>,
}

struct Simulation {
    session: NativeSessionState,
    ready: bool,
    write_fails: bool,
    launch_fails: bool,
    discovery_fails: bool,
    launches: Vec<Option<String>>,
}

impl Default for Simulation {
    fn default() -> Self {
        Self {
            session: NativeSessionState {
                codex_executable: Some("previous/ChatGPT.exe".to_string()),
                ..NativeSessionState::default()
            },
            ready: true,
            write_fails: false,
            launch_fails: false,
            discovery_fails: false,
            launches: Vec::new(),
        }
    }
}

thread_local! {
    static SIMULATION: RefCell<Simulation> = RefCell::new(Simulation::default());
}

fn with_simulation<T>(operation: impl FnOnce(&mut Simulation) -> T) -> T {
    SIMULATION.with(|simulation| operation(&mut simulation.borrow_mut()))
}

impl SimulatedMonitor {
    fn get(&self) -> Option<&MonitorPaths> {
        static PATHS: OnceLock<MonitorPaths> = OnceLock::new();
        with_simulation(|simulation| simulation.ready).then(|| {
            PATHS.get_or_init(|| MonitorPaths {
                paths: Mutex::new(Some(RuntimePaths {
                    bundled_root: PathBuf::new(),
                    codex_paths: None,
                })),
            })
        })
    }
}

fn read_session() -> NativeSessionState {
    with_simulation(|simulation| simulation.session.clone())
}

fn write_session(state: &NativeSessionState) -> Result<(), String> {
    with_simulation(|simulation| {
        if simulation.write_fails {
            return Err("session write failed".to_string());
        }
        simulation.session = state.clone();
        Ok(())
    })
}

fn find_runtime_launch_install() -> Result<CodexInstall, String> {
    with_simulation(|simulation| {
        if simulation.discovery_fails {
            return Err("installation unavailable".into());
        }
        Ok(CodexInstall {
            executable: PathBuf::from(simulation.session.codex_executable.as_ref().unwrap()),
            #[cfg(target_os = "windows")]
            app_user_model_id: None,
        })
    })
}

fn start_managed_runtime(
    _: &RuntimePaths,
    install: &CodexInstall,
    mode: SkinVerificationMode,
    _: RuntimeLaunchReason,
) -> Result<(), String> {
    assert!(mode == SkinVerificationMode::Background);
    with_simulation(|simulation| {
        simulation
            .launches
            .push(Some(install.executable.display().to_string()));
        if simulation.launch_fails {
            return Err("renderer failed to start".to_string());
        }
        Ok(())
    })
}

include!("runtime_entry.rs");

struct ExecutableFixture {
    path: PathBuf,
    _test_guard: MutexGuard<'static, ()>,
}

impl ExecutableFixture {
    fn new() -> Self {
        let guard = TEST_LOCK.lock().unwrap();
        with_simulation(|simulation| *simulation = Simulation::default());
        let path = std::env::temp_dir().join(format!("csw-launch-{}.exe", uuid::Uuid::new_v4()));
        fs::write(&path, b"test fixture; never executed").unwrap();
        Self {
            path,
            _test_guard: guard,
        }
    }
}

impl Drop for ExecutableFixture {
    fn drop(&mut self) {
        fs::remove_file(&self.path).unwrap();
    }
}

#[test]
fn observed_target_replaces_the_previous_installation_before_launch() {
    let executable = ExecutableFixture::new();
    restart_runtime_session(Some(&executable.path)).unwrap();
    with_simulation(|simulation| {
        assert_eq!(
            simulation.launches,
            vec![Some(executable.path.display().to_string())]
        );
    });
}

#[test]
fn unavailable_runtime_does_not_change_the_session_or_launch() {
    let executable = ExecutableFixture::new();
    with_simulation(|simulation| simulation.ready = false);
    assert!(restart_runtime_session(Some(&executable.path)).is_err());
    with_simulation(|simulation| {
        assert!(simulation.launches.is_empty());
        assert_eq!(
            simulation.session.codex_executable.as_deref(),
            Some("previous/ChatGPT.exe")
        );
    });
}

#[test]
fn failed_launch_is_reported_without_a_second_launch_attempt() {
    let executable = ExecutableFixture::new();
    with_simulation(|simulation| simulation.launch_fails = true);
    assert_eq!(
        restart_runtime_session(Some(&executable.path)),
        Err("renderer failed to start".to_string())
    );
    with_simulation(|simulation| assert_eq!(simulation.launches.len(), 1));
}

#[test]
fn invalid_target_and_failed_session_write_both_prevent_launch() {
    let executable = ExecutableFixture::new();
    let missing = executable.path.with_extension("missing");
    assert!(restart_runtime_session(Some(&missing)).is_err());
    with_simulation(|simulation| simulation.write_fails = true);
    assert!(restart_runtime_session(Some(&executable.path)).is_err());
    with_simulation(|simulation| assert!(simulation.launches.is_empty()));
}

#[test]
fn absent_launch_hint_keeps_the_remembered_installation() {
    let _executable = ExecutableFixture::new();
    restart_runtime_session(None).unwrap();
    with_simulation(|simulation| {
        assert_eq!(
            simulation.launches,
            vec![Some("previous/ChatGPT.exe".to_string())]
        );
    });
}

#[test]
fn a_busy_runtime_rejects_restart_without_changing_target_or_queuing_a_launch() {
    let executable = ExecutableFixture::new();
    let operation = OPERATION_LOCK.lock().unwrap();
    assert_eq!(
        restart_runtime_session(Some(&executable.path)),
        Err(crate::client_lifecycle::ClientOperationError::Busy.to_string()),
    );
    with_simulation(|simulation| {
        assert!(simulation.launches.is_empty());
        assert_eq!(
            simulation.session.codex_executable.as_deref(),
            Some("previous/ChatGPT.exe")
        );
    });
    drop(operation);
    restart_runtime_session(Some(&executable.path)).unwrap();
    with_simulation(|simulation| assert_eq!(simulation.launches.len(), 1));
}

#[test]
fn preparation_checks_installation_and_reserves_runtime_before_client_shutdown() {
    let executable = ExecutableFixture::new();
    with_simulation(|simulation| simulation.discovery_fails = true);
    assert!(prepare_runtime_session(Some(&executable.path)).is_err());
    assert!(OPERATION_LOCK.try_lock().is_ok());
    with_simulation(|simulation| simulation.discovery_fails = false);
    let prepared = prepare_runtime_session(Some(&executable.path)).unwrap();
    assert!(OPERATION_LOCK.try_lock().is_err());
    with_simulation(|simulation| assert!(simulation.launches.is_empty()));
    prepared.restart().unwrap();
    with_simulation(|simulation| assert_eq!(simulation.launches.len(), 1));
    assert!(OPERATION_LOCK.try_lock().is_ok());
}
