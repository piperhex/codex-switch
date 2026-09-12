use bytes::{Buf, Bytes};
use std::{
    io::{self, Read},
    time::Duration,
};

/// Pulls bytes only when the downstream reader asks for them. Each upstream read has
/// its own optional idle timeout; SSE streams can wait without a deadline.
pub(in crate::local_proxy) struct Response {
    response: reqwest::Response,
    pending: Bytes,
    idle_timeout: Option<Duration>,
    finished: bool,
}

impl Response {
    pub(super) fn new(response: reqwest::Response, idle_timeout: Option<Duration>) -> Self {
        Self {
            response,
            pending: Bytes::new(),
            idle_timeout,
            finished: false,
        }
    }

    pub(in crate::local_proxy) fn status(&self) -> reqwest::StatusCode {
        self.response.status()
    }

    pub(in crate::local_proxy) fn headers(&self) -> &reqwest::header::HeaderMap {
        self.response.headers()
    }

    pub(in crate::local_proxy) fn bytes(mut self) -> io::Result<Vec<u8>> {
        let mut bytes = Vec::new();
        self.read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    fn next_chunk(&mut self) -> io::Result<Option<Bytes>> {
        tauri::async_runtime::block_on(async {
            let Some(timeout) = self.idle_timeout else {
                return self.response.chunk().await.map_err(io::Error::other);
            };
            tokio::time::timeout(timeout, self.response.chunk())
                .await
                .map_err(|_| {
                    io::Error::new(io::ErrorKind::TimedOut, "upstream response idle timeout")
                })?
                .map_err(io::Error::other)
        })
    }
}

impl Read for Response {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() || self.finished {
            return Ok(0);
        }
        while self.pending.is_empty() {
            match self.next_chunk() {
                Ok(Some(chunk)) => self.pending = chunk,
                Ok(None) => {
                    self.finished = true;
                    return Ok(0);
                }
                Err(error) => {
                    self.finished = true;
                    return Err(error);
                }
            }
        }
        let count = buffer.len().min(self.pending.len());
        buffer[..count].copy_from_slice(&self.pending[..count]);
        self.pending.advance(count);
        Ok(count)
    }
}
