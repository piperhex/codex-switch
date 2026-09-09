use std::{
    fs,
    io::{BufRead, BufReader},
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

const HELPER: &str = env!("CARGO_BIN_EXE_csw-installer-helper");

struct Fixture {
    root: PathBuf,
    children: Vec<Child>,
}

impl Fixture {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("csw-install-test-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        Self {
            root,
            children: Vec::new(),
        }
    }

    fn target(&self, name: &str) -> PathBuf {
        self.root.join(name).join("csw.exe")
    }

    fn spawn(&mut self, name: &str, behavior: &str) -> usize {
        let target = self.target(name);
        if !target.exists() {
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::copy(HELPER, &target).unwrap();
        }
        self.spawn_at(&target, behavior)
    }

    fn spawn_at(&mut self, target: &Path, behavior: &str) -> usize {
        self.children.push(
            Command::new(target)
                .args(["fixture", behavior])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        thread::sleep(Duration::from_millis(150));
        self.children.len() - 1
    }

    fn action(&self, operation: &str, name: &str) -> bool {
        Command::new(HELPER)
            .arg(operation)
            .arg(self.target(name))
            .status()
            .unwrap()
            .success()
    }

    fn wait_exit(&mut self, index: usize) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while self.children[index].try_wait().unwrap().is_none() {
            assert!(
                Instant::now() < deadline,
                "fixture {index} (pid {}) did not exit under {}",
                self.children[index].id(),
                self.root.display()
            );
            thread::sleep(Duration::from_millis(50));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for name in ["target", "other"] {
            self.action("finish", name);
        }
        for child in &mut self.children {
            if child.try_wait().unwrap().is_none() {
                child.kill().unwrap();
            }
            child.wait().unwrap();
        }
        // Every removed path is under this uniquely created test directory.
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn cooperative_shutdown_is_fast_and_does_not_touch_other_installations() {
    let mut fixture = Fixture::new();
    let target = fixture.spawn("target", "cooperative");
    let other = fixture.spawn("other", "stubborn");
    let start = Instant::now();
    assert!(fixture.action("stop", "target"));
    assert!(start.elapsed() < Duration::from_secs(5));
    fixture.wait_exit(target);
    assert!(fixture.children[other].try_wait().unwrap().is_none());
    assert!(fixture.action("finish", "target"));
    let restarted = fixture.spawn("target", "cooperative");
    assert!(fixture.children[restarted].try_wait().unwrap().is_none());
}

#[test]
fn legacy_processes_and_their_relaunches_are_stopped_until_installation_finishes() {
    let mut fixture = Fixture::new();
    let first = fixture.spawn("target", "stubborn");
    assert!(fixture.action("stop", "target"));
    fixture.wait_exit(first);
    let relaunched = fixture.spawn("target", "stubborn");
    fixture.wait_exit(relaunched);
    assert!(fixture.action("finish", "target"));
    let restarted = fixture.spawn("target", "stubborn");
    assert!(fixture.children[restarted].try_wait().unwrap().is_none());
}

fn short_path(path: &Path) -> PathBuf {
    let path: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: the input is null-terminated; a null output queries the required size.
    let capacity = unsafe { GetShortPathNameW(path.as_ptr(), std::ptr::null_mut(), 0) };
    assert_ne!(capacity, 0, "{}", std::io::Error::last_os_error());
    let mut buffer = vec![0u16; capacity as usize];
    // SAFETY: the output contains capacity writable UTF-16 units and the input remains live.
    let length = unsafe { GetShortPathNameW(path.as_ptr(), buffer.as_mut_ptr(), capacity) };
    assert!(length > 0 && length < capacity);
    PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize]))
}

#[test]
fn short_path_relaunches_are_stopped_without_touching_other_installations() {
    let mut fixture = Fixture::new();
    let other = fixture.spawn("other", "stubborn");
    let target = fixture.target("target");
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::copy(HELPER, &target).unwrap();
    let alias = short_path(&target);
    if alias == target {
        eprintln!("8.3 aliases are unavailable on this volume");
        return;
    }
    assert_eq!(
        alias.canonicalize().unwrap(),
        target.canonicalize().unwrap()
    );
    let first = fixture.spawn_at(&alias, "stubborn");
    assert!(fixture.action("stop", "target"));
    fixture.wait_exit(first);
    let relaunched = fixture.spawn_at(&alias, "stubborn");
    fixture.wait_exit(relaunched);
    assert!(fixture.children[other].try_wait().unwrap().is_none());
    assert!(fixture.action("finish", "target"));
    let restarted = fixture.spawn_at(&alias, "stubborn");
    assert!(fixture.children[restarted].try_wait().unwrap().is_none());
}

#[test]
fn a_new_installation_needs_no_running_process_and_rejects_unrelated_targets() {
    let fixture = Fixture::new();
    assert!(fixture.action("stop", "target"));
    assert!(!Command::new(HELPER)
        .args(["stop", "C:\\Windows\\notepad.exe"])
        .status()
        .unwrap()
        .success());
    assert!(!Command::new(HELPER)
        .args(["stop", "relative\\csw.exe"])
        .status()
        .unwrap()
        .success());
}

#[test]
fn a_crashed_guard_cannot_leave_startup_blocked() {
    let mut fixture = Fixture::new();
    let target = fixture.target("target");
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::copy(HELPER, &target).unwrap();
    let mut owner = Command::new(&target)
        .args(["fixture", "hold-gate"])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut ready = String::new();
    BufReader::new(owner.stdout.take().unwrap())
        .read_line(&mut ready)
        .unwrap();
    assert_eq!(ready.trim(), "ready");
    fixture.children.push(owner);
    fixture.children.push(
        Command::new(&target)
            .args(["fixture", "startup"])
            .stdout(Stdio::null())
            .spawn()
            .unwrap(),
    );
    thread::sleep(Duration::from_millis(300));
    assert!(fixture.children[1].try_wait().unwrap().is_none());
    fixture.children[0].kill().unwrap();
    fixture.children[0].wait().unwrap();
    fixture.wait_exit(1);
}
