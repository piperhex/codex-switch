use std::io::{Read, Write};

use serde::{de::DeserializeOwned, Serialize};

use super::{BrowserError, Result};

pub(super) const MAX_REQUEST_BYTES: usize = 64 * 1024;
pub(super) const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

/// Chrome Native Messaging uses a little-endian byte length on the supported desktop targets.
pub(super) fn read_frame<T: DeserializeOwned>(
    reader: &mut impl Read,
    limit: usize,
) -> Result<Option<T>> {
    let mut header = [0_u8; 4];
    match reader.read(&mut header[..1]) {
        Ok(0) => return Ok(None),
        Ok(_) => {}
        Err(_) => return Err(BrowserError::Transport),
    }
    reader
        .read_exact(&mut header[1..])
        .map_err(|_| BrowserError::Transport)?;
    let size = u32::from_le_bytes(header) as usize;
    if size == 0 || size > limit {
        return Err(BrowserError::InvalidRequest);
    }
    let mut body = vec![0; size];
    reader
        .read_exact(&mut body)
        .map_err(|_| BrowserError::Transport)?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|_| BrowserError::InvalidRequest)
}

pub(super) fn write_frame(
    writer: &mut impl Write,
    value: &impl Serialize,
    limit: usize,
) -> Result<()> {
    let body = serde_json::to_vec(value).map_err(|_| BrowserError::InvalidRequest)?;
    if body.len() > limit {
        return Err(BrowserError::InvalidRequest);
    }
    writer
        .write_all(&(body.len() as u32).to_le_bytes())
        .map_err(|_| BrowserError::Transport)?;
    writer
        .write_all(&body)
        .map_err(|_| BrowserError::Transport)?;
    writer.flush().map_err(|_| BrowserError::Transport)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn frames_preserve_unicode_and_reject_unbounded_or_truncated_messages() {
        let mut bytes = Vec::new();
        let value = json!({"text":"你好\nChrome"});
        write_frame(&mut bytes, &value, 1024).unwrap();
        assert_eq!(
            read_frame::<Value>(&mut bytes.as_slice(), 1024).unwrap(),
            Some(value)
        );
        assert!(read_frame::<Value>(&mut bytes.as_slice(), 2).is_err());
        assert!(read_frame::<Value>(&mut &bytes[..bytes.len() - 1], 1024).is_err());
        assert!(read_frame::<Value>(&mut &[][..], 1024).unwrap().is_none());
    }
}
