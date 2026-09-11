use super::{platform, service::TerminalState, types::*};
use std::{
    path::PathBuf,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

#[test]
fn rejects_invalid_dimensions_paths_ids_and_oversized_input() {
    for size in [
        TerminalSize { cols: 0, rows: 24 },
        TerminalSize {
            cols: 80,
            rows: 501,
        },
    ] {
        assert!(size.validate().is_err());
    }
    assert!(platform::directory(Some("relative/path")).is_err());
    assert!(platform::directory(Some("invalid\0path")).is_err());
    let state = TerminalState::default();
    assert!(state
        .perform(TerminalRequest::Close {
            id: "untrusted".into()
        })
        .is_err());
    assert!(matches!(
        state.perform(TerminalRequest::Write {
            id: uuid::Uuid::new_v4().to_string(),
            data: "x".repeat(MAX_INPUT_BYTES + 1),
        }),
        Err(TerminalError::Invalid)
    ));
}

#[test]
fn shell_uses_a_fixed_program_and_passes_the_working_directory_as_data() {
    let cwd = std::env::temp_dir().canonicalize().expect("temp directory");
    let (command, name) = platform::shell(&cwd).expect("default shell");
    assert!(PathBuf::from(&command.get_argv()[0]).is_absolute());
    assert_eq!(
        command.get_cwd().expect("cwd").to_string_lossy(),
        platform::display_path(&cwd)
    );
    #[cfg(windows)]
    assert_eq!(name, "PowerShell");
    #[cfg(not(windows))]
    assert!(!name.is_empty());
}

struct Fixture {
    state: Arc<TerminalState>,
    directory: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("csw-terminal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).expect("test directory");
        Self {
            state: Arc::new(TerminalState::default()),
            directory,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.shutdown();
        for _ in 0..20 {
            if std::fs::remove_dir(&self.directory).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        eprintln!(
            "terminal test directory is still in use: {}",
            self.directory.display()
        );
    }
}

#[test]
fn interactive_shell_streams_unicode_resizes_and_closes_independently() {
    let fixture = Fixture::new();
    let (sender, receiver) = mpsc::channel();
    let info = fixture
        .state
        .open(
            OpenTerminal {
                cwd: Some(fixture.directory.to_string_lossy().into_owned()),
                size: TerminalSize {
                    cols: 100,
                    rows: 24,
                },
            },
            Arc::new(move |event| sender.send(event).is_ok()),
        )
        .expect("open shell");
    #[cfg(windows)]
    wait_output(
        &fixture.state,
        &info.id,
        &receiver,
        ">",
        Duration::from_secs(20),
    );
    #[cfg(windows)]
    let command = "Write-Output ('codex' + '-terminal-中文'); (Get-Location).Path\r";
    #[cfg(not(windows))]
    let command = "printf '%s%s\\n' codex '-terminal-中文'; pwd\r";
    fixture
        .state
        .perform(TerminalRequest::Write {
            id: info.id.clone(),
            data: command.into(),
        })
        .expect("write");
    let output = wait_output(
        &fixture.state,
        &info.id,
        &receiver,
        "codex-terminal-中文",
        Duration::from_secs(20),
    );
    assert!(output.contains("codex-terminal-中文"));
    fixture
        .state
        .perform(TerminalRequest::Resize {
            id: info.id.clone(),
            size: TerminalSize {
                cols: 120,
                rows: 30,
            },
        })
        .expect("resize");
    fixture
        .state
        .perform(TerminalRequest::Close {
            id: info.id.clone(),
        })
        .expect("close");
    fixture
        .state
        .perform(TerminalRequest::Close {
            id: info.id.clone(),
        })
        .expect("idempotent close");
    assert!(fixture
        .state
        .perform(TerminalRequest::Write {
            id: info.id,
            data: "late".into()
        })
        .is_err());
    let deadline = Instant::now() + Duration::from_secs(10);
    while let Ok(event) = receiver.recv_timeout(deadline.saturating_duration_since(Instant::now()))
    {
        if matches!(event, TerminalEvent::Exit { .. }) {
            return;
        }
    }
    panic!("closing the terminal did not end its output worker");
}

fn wait_output(
    state: &TerminalState,
    id: &str,
    receiver: &mpsc::Receiver<TerminalEvent>,
    text: &str,
    timeout: Duration,
) -> String {
    let deadline = Instant::now() + timeout;
    let mut bytes = Vec::new();
    let mut queries = 0;
    while Instant::now() < deadline {
        let event = match receiver.recv_timeout(Duration::from_millis(150)) {
            Ok(event) => event,
            Err(mpsc::RecvTimeoutError::Timeout)
                if String::from_utf8_lossy(&bytes).contains(text) =>
            {
                return String::from_utf8_lossy(&bytes).into_owned();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        let TerminalEvent::Output { data } = event else {
            continue;
        };
        bytes.extend(data);
        let output = String::from_utf8_lossy(&bytes);
        // ConPTY queries cursor position before starting the shell; emulate xterm's response.
        let next_queries = output.matches("\x1b[6n").count();
        if next_queries > queries {
            queries = next_queries;
            state
                .perform(TerminalRequest::Write {
                    id: id.into(),
                    data: "\x1b[1;1R".into(),
                })
                .expect("cursor reply");
        }
    }
    panic!(
        "terminal did not produce {text:?}: {}",
        String::from_utf8_lossy(&bytes)
    );
}
