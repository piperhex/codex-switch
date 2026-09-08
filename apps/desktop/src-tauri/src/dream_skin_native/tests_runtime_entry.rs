//! Run the production entry point with simulated session storage and process launch.
//! No test stops or launches the user's desktop application.

use super::{NativeSessionState, RuntimePaths, SkinVerificationMode};
use std::{
    cell::RefCell,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

static OPERATION_LOCK: Mutex<()> = Mutex::new(());
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

fn restart_managed_runtime(_: &RuntimePaths, mode: SkinVerificationMode) -> Result<(), String> {
    assert!(mode == SkinVerificationMode::Background);
    with_simulation(|simulation| {
        simulation
            .launches
            .push(simulation.session.codex_executable.clone());
        if simulation.launch_fails {
            return Err("renderer failed to start".to_string());
        }
        Ok(())
    })
}

include!("runtime_entry.rs");

struct ExecutableFixture(PathBuf);

impl ExecutableFixture {
    fn new() -> Self {
        with_simulation(|simulation| *simulation = Simulation::default());
        let path = std::env::temp_dir().join(format!("csw-launch-{}.exe", uuid::Uuid::new_v4()));
        fs::write(&path, b"test fixture; never executed").unwrap();
        Self(path)
    }
}

impl Drop for ExecutableFixture {
    fn drop(&mut self) {
        fs::remove_file(&self.0).unwrap();
    }
}

#[test]
fn observed_target_replaces_the_previous_installation_before_launch() {
    let executable = ExecutableFixture::new();
    restart_runtime_session(Some(&executable.0)).unwrap();
    with_simulation(|simulation| {
        assert_eq!(
            simulation.launches,
            vec![Some(executable.0.display().to_string())]
        );
    });
}

#[test]
fn unavailable_runtime_does_not_change_the_session_or_launch() {
    let executable = ExecutableFixture::new();
    with_simulation(|simulation| simulation.ready = false);
    assert!(restart_runtime_session(Some(&executable.0)).is_err());
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
        restart_runtime_session(Some(&executable.0)),
        Err("renderer failed to start".to_string())
    );
    with_simulation(|simulation| assert_eq!(simulation.launches.len(), 1));
}

#[test]
fn invalid_target_and_failed_session_write_both_prevent_launch() {
    let executable = ExecutableFixture::new();
    let missing = executable.0.with_extension("missing");
    assert!(restart_runtime_session(Some(&missing)).is_err());
    with_simulation(|simulation| simulation.write_fails = true);
    assert!(restart_runtime_session(Some(&executable.0)).is_err());
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
fn another_runtime_operation_blocks_both_target_update_and_launch() {
    use std::{sync::mpsc, time::Duration};

    let executable = ExecutableFixture::new();
    let operation = OPERATION_LOCK.lock().unwrap();
    let (ready_send, ready_receive) = mpsc::channel();
    let (done_send, done_receive) = mpsc::channel();
    let path = executable.0.clone();
    let worker = std::thread::spawn(move || {
        ready_send.send(()).unwrap();
        let result = restart_runtime_session(Some(&path));
        let launches = with_simulation(|simulation| simulation.launches.clone());
        done_send.send((result, launches)).unwrap();
    });
    ready_receive.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(matches!(
        done_receive.recv_timeout(Duration::from_millis(50)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    drop(operation);
    let (result, launches) = done_receive.recv_timeout(Duration::from_secs(5)).unwrap();
    result.unwrap();
    assert_eq!(launches, vec![Some(executable.0.display().to_string())]);
    worker.join().unwrap();
}
