//! Discover responding browsers without letting stale registry files consume the result limit.
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    thread,
};

use serde_json::Value;
use uuid::Uuid;

use super::{
    native,
    protocol::{BridgeRequest, Endpoint},
};

const MAX_RECORD_BYTES: u64 = 1024;
const MAX_CONNECTED_BROWSERS: usize = 32;
const PROBE_CONCURRENCY: usize = 8;

struct Record {
    path: PathBuf,
    contents: Vec<u8>,
    endpoint: Endpoint,
}

impl Record {
    fn read(path: PathBuf) -> Option<Self> {
        if !fs::symlink_metadata(&path).ok()?.is_file() {
            return None;
        }
        let mut contents = Vec::new();
        File::open(&path)
            .ok()?
            .take(MAX_RECORD_BYTES + 1)
            .read_to_end(&mut contents)
            .ok()?;
        if contents.len() as u64 > MAX_RECORD_BYTES {
            return None;
        }
        let endpoint: Endpoint = serde_json::from_slice(&contents).ok()?;
        if Uuid::parse_str(&endpoint.id).is_err()
            || endpoint.port == 0
            || path.file_name()?.to_str()? != format!("{}.json", endpoint.id)
        {
            return None;
        }
        Some(Self {
            path,
            contents,
            endpoint,
        })
    }

    fn remove_if_refused(&self, error: &io::Error) {
        if error.kind() != io::ErrorKind::ConnectionRefused {
            return;
        }
        // A timeout, protocol/authentication error, or changed record is not evidence of a dead host.
        if Self::read(self.path.clone()).is_none_or(|current| current.contents != self.contents) {
            return;
        }
        if let Err(error) = fs::remove_file(&self.path) {
            if error.kind() != io::ErrorKind::NotFound {
                eprintln!(
                    "Could not remove a stale Chrome connection record: {}",
                    error.kind()
                );
            }
        }
    }
}

/// Address a selected browser directly; it need not fit within the discovery result limit.
pub(super) fn endpoint(root: &Path, id: &str) -> Option<Endpoint> {
    Uuid::parse_str(id).ok()?;
    Record::read(root.join("endpoints").join(format!("{id}.json"))).map(|record| record.endpoint)
}

fn records(root: &Path) -> Vec<Record> {
    let Ok(entries) = fs::read_dir(root.join("endpoints")) else {
        return Vec::new();
    };
    // Do not cap candidate files: stale or invalid entries must never hide a later live browser.
    let mut records = entries
        .flatten()
        .filter_map(|entry| Record::read(entry.path()))
        .collect::<Vec<_>>();
    records.sort_unstable_by(|left, right| left.endpoint.id.cmp(&right.endpoint.id));
    records
}

fn probe(record: &Record, request: &BridgeRequest) -> Option<(Endpoint, Value)> {
    let stream = match native::connect(&record.endpoint) {
        Ok(stream) => stream,
        Err(error) => {
            record.remove_if_refused(&error);
            return None;
        }
    };
    let reply = native::exchange(stream, request).ok()?;
    if reply.error.is_some() {
        return None;
    }
    reply.result.map(|status| (record.endpoint.clone(), status))
}

fn probe_batch(batch: &[Record], request: &BridgeRequest) -> Vec<(Endpoint, Value)> {
    thread::scope(|scope| {
        let handles = batch
            .iter()
            .map(|record| scope.spawn(move || probe(record, request)))
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .filter_map(|handle| match handle.join() {
                Ok(result) => result,
                Err(_) => {
                    eprintln!("A Chrome connection probe failed unexpectedly");
                    None
                }
            })
            .collect()
    })
}

/// Probe in bounded parallel batches and count only successful status replies, including paused browsers.
pub(super) fn connected(root: &Path, request: &BridgeRequest) -> Vec<(Endpoint, Value)> {
    let mut connected = Vec::new();
    for batch in records(root).chunks(PROBE_CONCURRENCY) {
        let remaining = MAX_CONNECTED_BROWSERS - connected.len();
        connected.extend(probe_batch(batch, request).into_iter().take(remaining));
        if connected.len() == MAX_CONNECTED_BROWSERS {
            break;
        }
    }
    connected
}

#[cfg(test)]
#[path = "discovery_tests.rs"]
mod tests;
