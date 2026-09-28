//! Retain incomplete IPC frames across cancelled reads and reject unbounded input.
use super::{Result, ServiceError};
use crate::remote_desktop::service_worker::Call;

pub(crate) const MAX_FRAME: usize = 1024 * 1024;
#[derive(Default)]
pub(super) struct Frames(Vec<u8>);
impl Frames {
    pub fn append(&mut self, bytes: &[u8]) -> Result<()> {
        if self.0.len().saturating_add(bytes.len()) > MAX_FRAME {
            return Err(ServiceError::Invalid);
        }
        self.0.extend_from_slice(bytes);
        Ok(())
    }
    pub fn next(&mut self) -> Result<Option<Call>> {
        let Some(end) = self.0.iter().position(|byte| *byte == b'\n') else {
            return Ok(None);
        };
        let line: Vec<u8> = self.0.drain(..=end).collect();
        serde_json::from_slice(&line)
            .map(Some)
            .map_err(|_| ServiceError::Invalid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_partial_and_multiple_frames() {
        let mut frames = Frames::default();
        frames.append(b"{\"id\":1,\"command\":").unwrap();
        assert!(frames.next().unwrap().is_none());
        frames
            .append(b"\"one\"}\n{\"id\":2,\"command\":\"two\"}\n")
            .unwrap();
        assert_eq!(frames.next().unwrap().unwrap().id, 1);
        assert_eq!(frames.next().unwrap().unwrap().id, 2);
        assert!(frames.next().unwrap().is_none());
    }
    #[test]
    fn rejects_oversized_and_malformed_frames() {
        let mut frames = Frames::default();
        assert!(frames.append(&vec![b'x'; MAX_FRAME + 1]).is_err());
        frames.append(b"invalid\n").unwrap();
        assert!(frames.next().is_err());
    }
}
