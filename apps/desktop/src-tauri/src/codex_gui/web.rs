//! Bounded replay for authenticated browser clients. Publishers run on background workers;
//! reads run in the web request worker and never touch files or the GUI process lock.
use std::{collections::VecDeque, sync::Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

const MAX_EVENTS: usize = 4096;
const MAX_EVENT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Cursor {
    stream_id: String,
    sequence: u64,
}

#[derive(Clone, Serialize)]
pub(crate) struct WebEvent {
    name: String,
    payload: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventBatch {
    cursor: Cursor,
    reset: bool,
    events: Vec<WebEvent>,
}

struct Entry {
    sequence: u64,
    bytes: usize,
    event: WebEvent,
}

struct EventLog {
    cursor: Cursor,
    bytes: usize,
    entries: VecDeque<Entry>,
}

impl Default for EventLog {
    fn default() -> Self {
        Self {
            cursor: Cursor {
                stream_id: uuid::Uuid::new_v4().to_string(),
                sequence: 0,
            },
            bytes: 0,
            entries: VecDeque::new(),
        }
    }
}

impl EventLog {
    fn push(&mut self, event: WebEvent, bytes: usize) {
        self.cursor.sequence += 1;
        self.bytes += bytes;
        self.entries.push_back(Entry {
            sequence: self.cursor.sequence,
            bytes,
            event,
        });
        while self.entries.len() > MAX_EVENTS || self.bytes > MAX_EVENT_BYTES {
            if let Some(entry) = self.entries.pop_front() {
                self.bytes -= entry.bytes;
            }
        }
    }

    fn read(&self, cursor: Option<Cursor>) -> EventBatch {
        let oldest = self
            .entries
            .front()
            .map_or(self.cursor.sequence, |entry| entry.sequence - 1);
        let reset = cursor.as_ref().is_some_and(|cursor| {
            cursor.stream_id != self.cursor.stream_id
                || cursor.sequence < oldest
                || cursor.sequence > self.cursor.sequence
        });
        let events = cursor.filter(|_| !reset).map_or_else(Vec::new, |cursor| {
            self.entries
                .iter()
                .filter(|entry| entry.sequence > cursor.sequence)
                .map(|entry| entry.event.clone())
                .collect()
        });
        EventBatch {
            cursor: self.cursor.clone(),
            reset,
            events,
        }
    }
}

#[derive(Default)]
pub(crate) struct WebEventState(Mutex<EventLog>);

pub(super) fn publish(app: &AppHandle, name: &str, payload: impl Serialize + Clone) {
    if app.emit_to("main", name, payload.clone()).is_err() {
        eprintln!("Codex GUI could not deliver a desktop event");
    }
    let Ok(payload) = serde_json::to_value(payload) else {
        eprintln!("Codex GUI could not serialize a browser event");
        return;
    };
    let bytes = payload.to_string().len() + name.len();
    let state = app.state::<WebEventState>();
    match state.0.lock() {
        Ok(mut log) => log.push(
            WebEvent {
                name: name.to_owned(),
                payload,
            },
            bytes,
        ),
        Err(_) => eprintln!("Codex GUI browser event log is unavailable"),
    };
}

pub(crate) fn poll(app: &AppHandle, cursor: Option<Cursor>) -> Result<EventBatch, String> {
    app.state::<WebEventState>()
        .0
        .lock()
        .map(|log| log.read(cursor))
        .map_err(|_| "暂时无法接收消息，请重新连接。".to_string())
}

#[cfg(test)]
#[path = "web_tests.rs"]
mod tests;
