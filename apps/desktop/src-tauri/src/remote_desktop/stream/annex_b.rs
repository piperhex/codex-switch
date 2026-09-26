use super::super::{DesktopError, Result};

const MAX_BUFFER_BYTES: usize = 8 * 1024 * 1024;

/// Splits Annex B at access-unit delimiters inserted by the encoder, never in the middle of a frame.
#[derive(Default)]
pub(super) struct AccessUnits {
    buffer: Vec<u8>,
}

impl AccessUnits {
    pub fn push(&mut self, bytes: &[u8]) -> Result<()> {
        if self.buffer.len().saturating_add(bytes.len()) > MAX_BUFFER_BYTES {
            return Err(DesktopError::Platform);
        }
        self.buffer.extend_from_slice(bytes);
        Ok(())
    }

    pub fn next(&mut self) -> Option<Vec<u8>> {
        let mut first = false;
        let mut index = 0;
        while index + 4 <= self.buffer.len() {
            let length = start_code(&self.buffer[index..]);
            if length == 0 {
                index += 1;
                continue;
            }
            if self
                .buffer
                .get(index + length)
                .is_some_and(|value| value & 0x1f == 9)
            {
                if first {
                    return Some(self.buffer.drain(..index).collect());
                }
                first = true;
            }
            index += length;
        }
        None
    }
}

fn start_code(bytes: &[u8]) -> usize {
    if bytes.starts_with(&[0, 0, 0, 1]) {
        4
    } else if bytes.starts_with(&[0, 0, 1]) {
        3
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_complete_access_units_across_partial_reads() {
        let first = [0, 0, 0, 1, 9, 0xf0, 0, 0, 1, 0x67, 0x42, 0, 0, 1, 0x65, 7];
        let second = [0, 0, 1, 9, 0xf0, 0, 0, 1, 0x41, 8];
        let mut units = AccessUnits::default();
        for byte in first {
            units.push(&[byte]).unwrap();
            assert!(units.next().is_none());
        }
        units.push(&second[..3]).unwrap();
        assert!(units.next().is_none());
        units.push(&second[3..]).unwrap();
        assert_eq!(units.next().unwrap(), first);
        assert!(units.next().is_none());
    }

    #[test]
    fn rejects_an_unbounded_or_broken_encoder_stream() {
        let mut units = AccessUnits::default();
        assert!(units.push(&vec![1; MAX_BUFFER_BYTES + 1]).is_err());
    }
}
