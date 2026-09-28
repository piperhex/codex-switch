use super::super::{DesktopError, Result};
use super::{annex_b::AccessUnits, model::Profile, packets::Packets};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, BufReader},
    process::{Child, ChildStdout, Command},
};

const START_TIMEOUT: Duration = Duration::from_secs(3);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Copy)]
enum Backend {
    DirtyGpu,
    DirtyGdi,
    Nvenc,
    MediaFoundation,
    Software,
    GdiSoftware,
}

#[derive(Clone, Copy)]
struct Display {
    width: u32,
    height: u32,
    source_width: u32,
    source_height: u32,
    x: i32,
    y: i32,
    monitor: usize,
}

pub(super) struct Encoder {
    child: Child,
    output: BufReader<ChildStdout>,
    units: AccessUnits,
    packets: Option<Packets>,
    pub width: u32,
    pub height: u32,
    pub bitrate: u32,
}

impl Encoder {
    pub async fn open(
        path: &Path,
        profile: Profile,
        display: &super::super::monitors::Monitor,
    ) -> Result<(Self, Vec<u8>)> {
        let dimensions = dimensions(profile.width, display)?;
        for backend in [
            Backend::DirtyGpu,
            Backend::Nvenc,
            Backend::MediaFoundation,
            Backend::DirtyGdi,
            Backend::Software,
            Backend::GdiSoftware,
        ] {
            // Opt-in device tests must prove the new path rather than silently passing via compatibility capture.
            #[cfg(test)]
            if std::env::var_os("CSW_NATIVE_TEST_REQUIRE_DAMAGE").is_some()
                && !matches!(backend, Backend::DirtyGpu | Backend::DirtyGdi)
            {
                continue;
            }
            let Ok(mut encoder) = Self::spawn(path, profile, dimensions, backend) else {
                continue;
            };
            if let Ok(Ok(frame)) = tokio::time::timeout(START_TIMEOUT, encoder.next()).await {
                return Ok((encoder, frame));
            }
            encoder.stop().await;
        }
        Err(DesktopError::Platform)
    }

    fn spawn(path: &Path, profile: Profile, size: Display, backend: Backend) -> Result<Self> {
        let dirty = matches!(backend, Backend::DirtyGpu | Backend::DirtyGdi);
        let helper = path.with_file_name("desktop-video.exe");
        let mut command = Command::new(if dirty { &helper } else { path });
        command
            .args(arguments(profile, size, backend))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .creation_flags(CREATE_NO_WINDOW);
        let mut child = command.spawn().map_err(|_| DesktopError::Platform)?;
        let output = child.stdout.take().ok_or(DesktopError::Platform)?;
        Ok(Self {
            child,
            output: BufReader::new(output),
            units: AccessUnits::default(),
            packets: dirty.then(Packets::default),
            width: size.width,
            height: size.height,
            bitrate: profile.bitrate,
        })
    }

    pub async fn next(&mut self) -> Result<Vec<u8>> {
        loop {
            let next = match &mut self.packets {
                Some(packets) => packets.next()?,
                None => self.units.next(),
            };
            if let Some(frame) = next {
                return Ok(frame);
            }
            let mut buffer = [0; 32 * 1024];
            let length = self
                .output
                .read(&mut buffer)
                .await
                .map_err(|_| DesktopError::Platform)?;
            if length == 0 {
                return Err(DesktopError::Platform);
            }
            match &mut self.packets {
                Some(packets) => packets.push(&buffer[..length])?,
                None => self.units.push(&buffer[..length])?,
            }
        }
    }

    pub async fn stop(&mut self) {
        // The process may have exited by itself. kill_on_drop is the final cancellation fallback.
        if let Err(error) = self.child.kill().await {
            if error.kind() != std::io::ErrorKind::InvalidInput {
                eprintln!("desktop encoder cleanup: {error}");
            }
        }
    }
}

fn dimensions(limit: u32, display: &super::super::monitors::Monitor) -> Result<Display> {
    let display = display.refresh()?;
    let bounds = display.bounds;
    let target = limit.min(bounds.width) & !1;
    let scaled =
        ((u64::from(target) * u64::from(bounds.height) / u64::from(bounds.width)) as u32) & !1;
    if target == 0 || scaled == 0 {
        return Err(DesktopError::Platform);
    }
    Ok(Display {
        width: target,
        height: scaled,
        source_width: bounds.width,
        source_height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        monitor: display.handle,
    })
}

fn arguments(profile: Profile, size: Display, backend: Backend) -> Vec<String> {
    if matches!(backend, Backend::DirtyGpu | Backend::DirtyGdi) {
        return vec![
            size.width.to_string(),
            size.height.to_string(),
            profile.fps.to_string(),
            profile.bitrate.to_string(),
            size.monitor.to_string(),
            if matches!(backend, Backend::DirtyGdi) {
                "gdi"
            } else {
                "gpu"
            }
            .into(),
        ];
    }
    let (codec, options) = encoder_options(backend);
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin"]
        .into_iter()
        .map(String::from)
        .collect();
    args.extend(capture_arguments(profile, size, backend));
    args.extend(["-an".into(), "-c:v".into(), codec.into()]);
    args.extend(options.iter().map(|value| (*value).to_owned()));
    args.extend(rate_arguments(profile));
    args.extend(
        [
            "-bsf:v",
            "h264_metadata=aud=insert",
            "-flush_packets",
            "1",
            "-f",
            "h264",
            "pipe:1",
        ]
        .into_iter()
        .map(String::from),
    );
    args
}

fn capture_arguments(profile: Profile, size: Display, backend: Backend) -> Vec<String> {
    if matches!(backend, Backend::GdiSoftware) {
        return vec![
            "-f".into(),
            "gdigrab".into(),
            "-draw_mouse".into(),
            "0".into(),
            "-offset_x".into(),
            size.x.to_string(),
            "-offset_y".into(),
            size.y.to_string(),
            "-video_size".into(),
            format!("{}x{}", size.source_width, size.source_height),
            "-framerate".into(),
            profile.fps.to_string(),
            "-i".into(),
            "desktop".into(),
            "-vf".into(),
            format!(
                "scale={}:{}:flags=fast_bilinear,format=yuv420p",
                size.width, size.height
            ),
        ];
    }
    vec![
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        capture_filter(profile, size, backend),
    ]
}

fn capture_filter(profile: Profile, size: Display, backend: Backend) -> String {
    let Display {
        width,
        height,
        monitor,
        ..
    } = size;
    let fps = profile.fps;
    // Oversample before selecting time buckets: a 144 Hz display throttled at 60 Hz otherwise yields 48 Hz.
    let capture_fps = fps * 2;
    let mut filter = format!(
        "gfxcapture=hmonitor={monitor}:max_framerate={capture_fps}:width={width}:height={height}"
    );
    // Viewers render an immediate local pointer, so frames must not contain a second cursor.
    filter.push_str(":resize_mode=scale_aspect:capture_cursor=0");
    filter.push_str(&format!(
        ",select='isnan(prev_selected_t)+gt(floor(t*{fps}),floor(prev_selected_t*{fps}))'"
    ));
    if matches!(backend, Backend::Software) {
        filter.push_str(",hwdownload,format=bgra,format=yuv420p");
    }
    filter
}

fn encoder_options(backend: Backend) -> (&'static str, &'static [&'static str]) {
    match backend {
        Backend::Nvenc => (
            "h264_nvenc",
            &[
                "-preset",
                "p1",
                "-tune",
                "ull",
                "-rc",
                "cbr",
                "-zerolatency",
                "1",
                "-profile:v",
                "baseline",
            ],
        ),
        Backend::MediaFoundation => (
            "h264_mf",
            &[
                "-hw_encoding",
                "1",
                "-scenario",
                "display_remoting",
                "-profile:v",
                "baseline",
            ],
        ),
        Backend::DirtyGpu | Backend::DirtyGdi | Backend::Software | Backend::GdiSoftware => (
            "libopenh264",
            &[
                "-rc_mode",
                "bitrate",
                "-allow_skip_frames",
                "1",
                "-profile:v",
                "constrained_baseline",
            ],
        ),
    }
}

fn rate_arguments(profile: Profile) -> Vec<String> {
    let mut args = Vec::new();
    for (name, value) in [
        ("-b:v", profile.bitrate),
        ("-maxrate", profile.bitrate),
        ("-bufsize", profile.bitrate / 2),
        ("-g", profile.fps),
        ("-bf", 0),
    ] {
        args.extend([name.to_owned(), value.to_string()]);
    }
    args.extend(["-fps_mode", "passthrough"].into_iter().map(String::from));
    args
}
pub(super) fn runtime_path(resource_dir: PathBuf) -> Result<PathBuf> {
    let relative = "resources/remote-desktop/runtime/ffmpeg.exe";
    let path = resource_dir.join(relative);
    if path.is_file() {
        return Ok(path);
    }
    #[cfg(debug_assertions)]
    {
        let development = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        if development.is_file() {
            return Ok(development);
        }
    }
    Err(DesktopError::Platform)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_capture_backend_excludes_the_host_cursor() {
        let profile = Profile {
            width: 1920,
            fps: 60,
            bitrate: 6_000_000,
        };
        let size = Display {
            width: 1920,
            height: 1080,
            source_width: 1920,
            source_height: 1080,
            x: -1920,
            y: -200,
            monitor: 1,
        };
        for backend in [Backend::Nvenc, Backend::MediaFoundation, Backend::Software] {
            let filter = capture_filter(profile, size, backend);
            assert!(filter.contains(":capture_cursor=0"));
        }
        let args = capture_arguments(profile, size, Backend::GdiSoftware);
        assert!(args.windows(2).any(|pair| pair == ["-draw_mouse", "0"]));
        assert!(args.windows(2).any(|pair| pair == ["-offset_x", "-1920"]));
        assert!(args.windows(2).any(|pair| pair == ["-offset_y", "-200"]));
        for backend in [Backend::DirtyGpu, Backend::DirtyGdi] {
            assert_eq!(arguments(profile, size, backend)[4], "1");
        }
    }
}
