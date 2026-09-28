use super::super::{DesktopError, Result};
use std::time::Duration;

pub(super) const CLOCK_RATE: u32 = 48_000;
pub(super) const MAX_BACKLOG: u64 = 3 * 960;

/// Capture-clock timestamp plus one 20 ms Opus packet, independent of pipe read timing.
pub(super) struct AudioPacket {
    pub ticks: u64,
    pub data: Vec<u8>,
}

impl AudioPacket {
    pub fn parse(mut packet: Vec<u8>) -> Result<Self> {
        if !(9..=4000).contains(&packet.len()) {
            return Err(DesktopError::Platform);
        }
        let header: [u8; 8] = packet[..8].try_into().map_err(|_| DesktopError::Platform)?;
        let ticks = u64::from_le_bytes(header);
        packet.drain(..8);
        Ok(Self {
            ticks,
            data: packet,
        })
    }

    pub fn elapsed(&self, previous: u64) -> Result<Duration> {
        let ticks = self
            .ticks
            .checked_sub(previous)
            .ok_or(DesktopError::Platform)?;
        Ok(Duration::from_secs_f64(
            ticks as f64 / f64::from(CLOCK_RATE),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_clock_preserves_spacing_and_gaps_despite_coalesced_pipe_reads() {
        let mut previous = 0;
        for (ticks, millis) in [(960, 20), (1920, 20), (4800, 60)] {
            let mut wire = u64::to_le_bytes(ticks).to_vec();
            wire.extend([0xf8, 0xff, 0xfe]);
            let packet = AudioPacket::parse(wire).unwrap();
            assert_eq!(packet.data, [0xf8, 0xff, 0xfe]);
            assert_eq!(
                packet.elapsed(previous).unwrap(),
                Duration::from_millis(millis)
            );
            assert!(packet.elapsed(ticks + 1).is_err());
            previous = ticks;
        }
        assert!(AudioPacket::parse(vec![0; 8]).is_err());
        assert!(AudioPacket::parse(vec![0; 4001]).is_err());
    }
}
