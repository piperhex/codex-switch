use super::super::{DesktopError, Result};
use std::time::Duration;
use webrtc::{
    media::Sample, track::track_local::track_local_static_sample::TrackLocalStaticSample,
};

pub(super) const VIDEO_CLOCK_RATE: u32 = 90_000;

fn timed_samples(data: Vec<u8>, elapsed: Duration) -> [Sample; 2] {
    [
        Sample {
            duration: elapsed,
            ..Default::default()
        },
        Sample {
            data: data.into(),
            ..Default::default()
        },
    ]
}

/// Advance time before the current frame. webrtc-rs applies Sample.duration after packetization;
/// putting the preceding idle interval on the frame would timestamp the next update two seconds late.
/// Empty H.264 and Opus samples advance the clock without sending RTP or consuming sequence numbers.
pub(super) async fn write_frame(
    track: &TrackLocalStaticSample,
    data: Vec<u8>,
    elapsed: Duration,
) -> Result<()> {
    for sample in timed_samples(data, elapsed) {
        track
            .write_sample(&sample)
            .await
            .map_err(|_| DesktopError::Platform)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use webrtc::rtp::{
        codecs::h264::H264Payloader,
        packetizer::{new_packetizer, Packetizer},
        sequence::new_random_sequencer,
    };

    #[test]
    fn idle_gap_precedes_resumed_frame_without_network_padding_or_sequence_gaps() {
        let mut packetizer = new_packetizer(
            1200,
            96,
            1,
            Box::<H264Payloader>::default(),
            Box::new(new_random_sequencer()),
            VIDEO_CLOCK_RATE,
        );
        let payload = vec![0, 0, 0, 1, 0x65, 7];
        let mut headers = Vec::new();
        for elapsed in [
            Duration::ZERO,
            Duration::from_secs(2),
            Duration::from_millis(20),
        ] {
            let [advance, frame] = timed_samples(payload.clone(), elapsed);
            let ticks = (advance.duration.as_secs_f64() * f64::from(VIDEO_CLOCK_RATE)) as u32;
            assert!(packetizer
                .packetize(&advance.data, ticks)
                .unwrap()
                .is_empty());
            let packets = packetizer.packetize(&frame.data, 0).unwrap();
            assert_eq!(packets.len(), 1);
            headers.push(packets[0].header.clone());
        }
        assert_eq!(
            headers[1].timestamp.wrapping_sub(headers[0].timestamp),
            180_000
        );
        assert_eq!(
            headers[2].timestamp.wrapping_sub(headers[1].timestamp),
            1_800
        );
        assert_eq!(
            headers[1]
                .sequence_number
                .wrapping_sub(headers[0].sequence_number),
            1
        );
    }
}
