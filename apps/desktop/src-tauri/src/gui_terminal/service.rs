use super::{platform, types::*};
use portable_pty::{native_pty_system, Child, MasterPty};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

pub(super) type EventSink = Arc<dyn Fn(TerminalEvent) -> bool + Send + Sync>;

struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

impl Session {
    fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Err(error) = child.kill() {
                eprintln!("terminal shutdown failed: {error}");
                return;
            }
            if let Err(error) = child.wait() {
                eprintln!("terminal process cleanup failed: {error}");
            }
        }
    }
}

/// The registry owns sessions; readers never hold its lock while waiting for shell output.
#[derive(Default)]
pub(crate) struct TerminalState {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    pub(super) exiting: AtomicBool,
}

impl TerminalState {
    pub(super) fn open(
        self: &Arc<Self>,
        request: OpenTerminal,
        sink: EventSink,
    ) -> Result<TerminalInfo> {
        let size = request.size.validate()?;
        let cwd = platform::directory(request.cwd.as_deref())?;
        let (command, shell) = platform::shell(&cwd)?;
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|_| TerminalError::Start)?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|_| TerminalError::Start)?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|_| TerminalError::Start)?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|_| TerminalError::Start)?;
        drop(pair.slave);
        let session = Arc::new(Session {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
        });
        let id = uuid::Uuid::new_v4().to_string();
        // Start draining before closing ConPTY on any failure: its close waits for the output pipe.
        let output = read_output(reader, sink.clone(), self.clone(), id.clone());
        if let Err(error) = self.insert(&id, session.clone()) {
            session.stop();
            return Err(error);
        }
        watch_exit(self.clone(), id.clone(), output, sink);
        Ok(TerminalInfo {
            id,
            cwd: platform::display_path(&cwd),
            shell,
        })
    }

    fn insert(&self, id: &str, session: Arc<Session>) -> Result<()> {
        let mut sessions = self.sessions.lock().map_err(|_| TerminalError::Io)?;
        if self.exiting.load(Ordering::Acquire) {
            return Err(TerminalError::Closed);
        }
        if sessions.len() >= MAX_SESSIONS {
            return Err(TerminalError::Limit);
        }
        sessions.insert(id.to_owned(), session);
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Arc<Session>> {
        uuid::Uuid::parse_str(id).map_err(|_| TerminalError::Invalid)?;
        self.sessions
            .lock()
            .map_err(|_| TerminalError::Io)?
            .get(id)
            .cloned()
            .ok_or(TerminalError::Closed)
    }

    pub(super) fn perform(&self, request: TerminalRequest) -> Result<()> {
        match request {
            TerminalRequest::Write { id, data } => {
                if data.len() > MAX_INPUT_BYTES {
                    return Err(TerminalError::Invalid);
                }
                let session = self.get(&id)?;
                let mut writer = session.writer.lock().map_err(|_| TerminalError::Io)?;
                writer
                    .write_all(data.as_bytes())
                    .and_then(|()| writer.flush())
                    .map_err(|_| TerminalError::Io)
            }
            TerminalRequest::Resize { id, size } => {
                let size = size.validate()?;
                self.get(&id)?
                    .master
                    .lock()
                    .map_err(|_| TerminalError::Io)?
                    .resize(size)
                    .map_err(|_| TerminalError::Io)
            }
            TerminalRequest::Close { id } => self.close(&id),
        }
    }

    pub(super) fn close(&self, id: &str) -> Result<()> {
        uuid::Uuid::parse_str(id).map_err(|_| TerminalError::Invalid)?;
        let removed = self
            .sessions
            .lock()
            .map_err(|_| TerminalError::Io)?
            .remove(id);
        if let Some(session) = removed {
            session.stop();
        }
        Ok(())
    }

    pub(super) fn shutdown(&self) {
        self.exiting.store(true, Ordering::Release);
        let sessions = match self.sessions.lock() {
            Ok(mut sessions) => std::mem::take(&mut *sessions),
            Err(error) => {
                eprintln!("terminal registry unavailable: {error}");
                return;
            }
        };
        for session in sessions.into_values() {
            session.stop();
        }
    }
}

fn read_output(
    mut reader: Box<dyn Read + Send>,
    sink: EventSink,
    state: Arc<TerminalState>,
    id: String,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        const READ_BYTES: usize = 8192;
        let mut buffer = [0; READ_BYTES];
        let mut connected = true;
        loop {
            let count = match reader.read(&mut buffer) {
                Ok(0) => break,
                // Closing a PTY reports EOF or a broken pipe depending on the platform.
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::BrokenPipe | std::io::ErrorKind::UnexpectedEof
                    ) =>
                {
                    break
                }
                Err(error) => {
                    eprintln!("terminal output read failed: {error}");
                    sink(TerminalEvent::Error {
                        message: TerminalError::Io.to_string(),
                    });
                    break;
                }
                Ok(count) => count,
            };
            if connected
                && !sink(TerminalEvent::Output {
                    data: buffer[..count].to_vec(),
                })
            {
                connected = false;
                let state = state.clone();
                let id = id.clone();
                // ConPTY must be closed from a different thread while this reader drains the pipe.
                std::thread::spawn(move || {
                    if let Err(error) = state.close(&id) {
                        eprintln!("terminal disconnect cleanup failed: {error}");
                    }
                });
            }
        }
    })
}

fn watch_exit(
    state: Arc<TerminalState>,
    id: String,
    output: std::thread::JoinHandle<()>,
    sink: EventSink,
) {
    std::thread::spawn(move || {
        let code = wait_for_exit(&state, &id);
        if let Err(error) = state.close(&id) {
            eprintln!("terminal exit cleanup failed: {error}");
        }
        if output.join().is_err() {
            eprintln!("terminal output worker stopped unexpectedly");
        }
        // The frontend may already have closed this tab; no receiver is expected in that case.
        sink(TerminalEvent::Exit { code });
    });
}

fn wait_for_exit(state: &TerminalState, id: &str) -> Option<u32> {
    const EXIT_POLL: Duration = Duration::from_millis(100);
    loop {
        let session = state.get(id).ok()?;
        let status = session.child.lock().ok()?.try_wait();
        match status {
            Ok(Some(status)) => return Some(status.exit_code()),
            Err(error) => {
                eprintln!("terminal exit status unavailable: {error}");
                return None;
            }
            Ok(None) => {}
        }
        drop(session);
        std::thread::sleep(EXIT_POLL);
    }
}
