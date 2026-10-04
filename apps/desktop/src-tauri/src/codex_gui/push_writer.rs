//! Serialize notification persistence without backpressure on the app-server protocol reader.
use std::{io, sync::mpsc, thread};

use super::{push_notifications::Notice, push_outbox::OutboxError};
use crate::cloud::PushRoute;

const QUEUE_CAPACITY: usize = 1_024;

pub(super) struct PendingNotice {
    pub(super) route: PushRoute,
    pub(super) notice: Notice,
}

pub(super) struct PushWriter(mpsc::SyncSender<PendingNotice>);

impl PushWriter {
    pub(super) fn start(save: impl Fn(PendingNotice) + Send + 'static) -> io::Result<Self> {
        let (sender, receiver) = mpsc::sync_channel(QUEUE_CAPACITY);
        thread::Builder::new()
            .name("chat-notification-writer".into())
            .spawn(move || {
                for notice in receiver {
                    save(notice);
                }
            })?;
        Ok(Self(sender))
    }

    /// Saturation is reported to the GUI explicitly; never freeze approvals behind a stalled disk.
    pub(super) fn enqueue(&self, notice: PendingNotice) -> Result<(), OutboxError> {
        self.0.try_send(notice).map_err(|_| OutboxError::Storage)
    }
}

#[cfg(test)]
#[path = "push_writer_tests.rs"]
mod tests;
