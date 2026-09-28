//! Each authenticated control connection owns its remote commands and cancels them on disconnect.
use super::{executor, state, CommandRequest, RemoteError};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};

static EXECUTING: AtomicBool = AtomicBool::new(false);

struct ExecutionGuard;
impl Drop for ExecutionGuard {
    fn drop(&mut self) {
        EXECUTING.store(false, Ordering::Release);
    }
}

pub(crate) fn enabled() -> bool {
    super::root()
        .and_then(|root| state::incoming(&root))
        .is_ok()
}

pub(crate) struct CommandHost {
    sender: mpsc::SyncSender<Value>,
    receiver: mpsc::Receiver<Value>,
    active: Option<(String, Arc<AtomicBool>)>,
}

impl CommandHost {
    pub(crate) fn new() -> Self {
        let (sender, receiver) = mpsc::sync_channel(4);
        Self {
            sender,
            receiver,
            active: None,
        }
    }

    pub(crate) fn request(&mut self, command_id: String, request: CommandRequest) {
        let grant = super::root().and_then(|root| {
            request.validate()?;
            let (id, token) = state::incoming(&root)?;
            Ok((root, id, token))
        });
        let (root, id, token) = match grant {
            Ok(grant) => grant,
            Err(error) => {
                self.reply(command_id, Err(error));
                return;
            }
        };
        if EXECUTING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            self.reply(command_id, Err(RemoteError::Busy));
            return;
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        self.active = Some((command_id.clone(), cancelled.clone()));
        let sender = self.sender.clone();
        std::thread::spawn(move || {
            let _guard = ExecutionGuard;
            let result = tauri::async_runtime::block_on(executor::execute(request, || {
                !cancelled.load(Ordering::Acquire) && state::authorized(&root, &id, &token)
            }));
            // A closed receiver belongs to a disconnected session; its output must be discarded.
            if sender.try_send(response(command_id, result)).is_err() {
                eprintln!("remote command result discarded after connection closed");
            }
        });
    }

    pub(crate) fn cancel(&self, command_id: &str) {
        if let Some((id, cancelled)) = &self.active {
            if id == command_id {
                cancelled.store(true, Ordering::Release);
            }
        }
    }

    pub(crate) fn responses(&mut self) -> Vec<Value> {
        let responses: Vec<_> = self.receiver.try_iter().collect();
        if responses.iter().any(|reply| {
            self.active
                .as_ref()
                .is_some_and(|(id, _)| reply["commandId"] == *id)
        }) {
            self.active = None;
        }
        responses
    }

    fn reply(&self, command_id: String, result: super::Result<super::protocol::CommandOutput>) {
        if self.sender.try_send(response(command_id, result)).is_err() {
            eprintln!("remote command response queue is full");
        }
    }
}

fn response(command_id: String, result: super::Result<super::protocol::CommandOutput>) -> Value {
    match result {
        Ok(data) => json!({"type":"remote-command-result", "commandId":command_id, "data":data}),
        Err(error) => {
            json!({"type":"remote-command-result", "commandId":command_id, "error":error.to_string()})
        }
    }
}

impl Drop for CommandHost {
    fn drop(&mut self) {
        if let Some((_, cancelled)) = &self.active {
            cancelled.store(true, Ordering::Release);
        }
    }
}
