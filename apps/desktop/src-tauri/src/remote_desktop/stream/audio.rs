use super::super::{DesktopError, Result};
use super::{
    audio_packet::{AudioPacket, CLOCK_RATE, MAX_BACKLOG},
    native::Stream,
    packets::Packets,
};
use std::{path::Path, process::Stdio, sync::Arc, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};
use webrtc::{
    api::media_engine::MIME_TYPE_OPUS,
    peer_connection::RTCPeerConnection,
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::{track_local_static_sample::TrackLocalStaticSample, TrackLocal},
};

const RETRY_INTERVAL: Duration = Duration::from_secs(2);
const READ_TIMEOUT: Duration = Duration::from_secs(3);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(super) async fn track(connection: &RTCPeerConnection) -> Result<Arc<TrackLocalStaticSample>> {
    let track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_OPUS.into(),
            clock_rate: CLOCK_RATE,
            channels: 2,
            sdp_fmtp_line: "minptime=10;useinbandfec=1;stereo=1".into(),
            ..Default::default()
        },
        "desktop-audio".into(),
        "desktop".into(),
    ));
    let sender = connection
        .add_track(Arc::clone(&track) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|_| DesktopError::Platform)?;
    tokio::spawn(async move {
        // Reading feedback keeps the default RTCP interceptors running until the peer closes.
        while sender.read_rtcp().await.is_ok() {}
    });
    Ok(track)
}

pub(super) async fn run(stream: Arc<Stream>, path: std::path::PathBuf) {
    if super::pump::wait_connected(&stream).await.is_err() {
        return;
    }
    let mut cancel = stream.cancel.subscribe();
    let mut previous = std::time::Instant::now();
    while !*cancel.borrow() {
        let result = tokio::select! {
            _ = cancel.changed() => return,
            result = capture(&stream, &path, &mut previous) => result,
        };
        if let Err(error) = result {
            eprintln!("desktop audio restarting: {error}");
        }
        *stream.audio.lock().await = super::model::AudioState::Unavailable;
        tokio::select! {
            _ = cancel.changed() => return,
            _ = tokio::time::sleep(RETRY_INTERVAL) => {},
        }
    }
}

fn spawn(path: &Path) -> Result<tokio::process::Child> {
    // Only the bundled helper is executable. Capture/encoding never runs on the UI thread.
    Command::new(path.with_file_name("desktop-video.exe"))
        .arg("audio")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| DesktopError::Platform)
}

async fn capture(stream: &Stream, path: &Path, previous: &mut std::time::Instant) -> Result<()> {
    let mut child = spawn(path)?;
    let mut output = child.stdout.take().ok_or(DesktopError::Platform)?;
    let mut packets = Packets::default();
    let mut previous_ticks = None;
    loop {
        let mut buffer = [0; 8192];
        let count = tokio::time::timeout(READ_TIMEOUT, output.read(&mut buffer))
            .await
            .map_err(|_| DesktopError::Platform)?
            .map_err(|_| DesktopError::Platform)?;
        if count == 0 {
            return Err(DesktopError::Platform);
        }
        packets.push(&buffer[..count])?;
        let mut ready = Vec::new();
        while let Some(packet) = packets.next()? {
            ready.push(AudioPacket::parse(packet)?);
        }
        let latest = ready.last().map_or(0, |packet| packet.ticks);
        for packet in ready {
            if latest.saturating_sub(packet.ticks) >= MAX_BACKLOG {
                continue;
            }
            let elapsed = match previous_ticks {
                Some(ticks) => packet.elapsed(ticks)?,
                None => previous.elapsed(),
            };
            previous_ticks = Some(packet.ticks);
            send(stream, packet.data, elapsed).await?;
            *previous = std::time::Instant::now();
        }
    }
}

async fn send(stream: &Stream, packet: Vec<u8>, elapsed: Duration) -> Result<()> {
    tokio::time::timeout(
        Duration::from_millis(250),
        super::sample::write_frame(&stream.peer.audio, packet, elapsed),
    )
    .await
    .map_err(|_| DesktopError::Platform)??;
    *stream.audio.lock().await = super::model::AudioState::Playing;
    Ok(())
}
